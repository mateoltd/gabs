import type { ModuleArtifactKey, Platform, Scope } from "./index";
import type { ModuleStorage } from "./module-storage";
import type { SignedArtifact } from "@suite/module-sdk/platform";

interface ArtifactReference {
  digest: string;
  chunks: number;
}
type Installed = ModuleStorage["installed"][string];
export interface StoredModuleState extends Omit<
  ModuleStorage,
  "installed" | "downloads" | "responseContracts"
> {
  installed: Record<
    string,
    Omit<Installed, "artifact"> & {
      artifact?: unknown;
      signedRef?: ArtifactReference;
    }
  >;
  responseContractRefs?: Record<
    string,
    { signedRef: ArtifactReference; publicKey: string }
  >;
  responseContracts?: ModuleStorage["responseContracts"];
  downloads?: Record<string, SignedArtifact>;
  downloadRefs?: Record<string, ArtifactReference>;
}
const chunkSize = 256 * 1024;
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function keys(ref: ArtifactReference): ModuleArtifactKey[] {
  if (
    !/^[a-f0-9]{64}$/.test(ref.digest) ||
    !Number.isInteger(ref.chunks) ||
    ref.chunks < 1 ||
    ref.chunks > 256
  )
    throw Error("Invalid stored module artifact reference.");
  return Array.from(
    { length: ref.chunks },
    (_, i) => `module-artifact/${ref.digest}/${i}` as const,
  );
}
export function retainedArtifactKeys(
  state: StoredModuleState,
): ModuleArtifactKey[] {
  return [
    ...new Set([
      ...Object.values(state.installed).flatMap((entry) =>
        entry.signedRef ? keys(entry.signedRef) : [],
      ),
      ...Object.values(state.downloadRefs ?? {}).flatMap(keys),
      ...Object.values(state.responseContractRefs ?? {}).flatMap((entry) =>
        keys(entry.signedRef),
      ),
    ]),
  ];
}
export async function hydrateModuleArtifacts(
  platform: Platform,
  scope: Scope,
  stored: StoredModuleState,
): Promise<ModuleStorage> {
  const packages = new Map<string, SignedArtifact | undefined>();
  const load = async (ref: ArtifactReference) => {
    if (packages.has(ref.digest)) return packages.get(ref.digest);
    const chunks = await Promise.all(
      keys(ref).map((key) => platform.load<string>(scope, key)),
    );
    // Missing/corrupt executable bytes can be repaired. Keep the user's drafts and journal readable.
    let value: SignedArtifact | undefined;
    if (chunks.every((c) => typeof c === "string")) {
      const serialized = chunks.join("");
      if ((await hash(serialized)) === ref.digest)
        value = JSON.parse(serialized) as SignedArtifact;
    }
    packages.set(ref.digest, value);
    return value;
  };
  const { downloadRefs, responseContractRefs, ...state } = stored;
  const installed: ModuleStorage["installed"] = {};
  for (const [id, entry] of Object.entries(stored.installed)) {
    const { signedRef, ...rest } = entry;
    const signed = signedRef ? await load(signedRef) : entry.signed;
    installed[id] = {
      ...rest,
      signed,
      artifact: signed?.artifact ?? entry.artifact,
    };
  }
  const downloads = { ...stored.downloads };
  for (const [id, ref] of Object.entries(downloadRefs ?? {})) {
    const pkg = await load(ref);
    if (pkg) downloads[id] = pkg;
  }
  const responseContracts = { ...stored.responseContracts };
  for (const [key, entry] of Object.entries(responseContractRefs ?? {})) {
    const signed = await load(entry.signedRef);
    if (signed) responseContracts[key] = { signed, publicKey: entry.publicKey };
  }
  return { ...state, installed, downloads, responseContracts };
}
export async function persistModuleArtifacts(
  platform: Platform,
  scope: Scope,
  state: ModuleStorage,
): Promise<StoredModuleState> {
  const written = new Map<string, ArtifactReference>();
  const save = async (pkg: SignedArtifact) => {
    const serialized = JSON.stringify(pkg);
    if (new TextEncoder().encode(serialized).byteLength > chunkSize * 256)
      throw Error("Module package exceeds the 64 MiB local artifact limit.");
    const digest = await hash(serialized);
    const existing = written.get(digest);
    if (existing) return existing;
    const ref = { digest, chunks: Math.ceil(serialized.length / chunkSize) };
    const paths = keys(ref);
    for (let i = 0; i < paths.length; i++) {
      const chunk = serialized.slice(i * chunkSize, (i + 1) * chunkSize);
      if ((await platform.load(scope, paths[i])) !== chunk)
        await platform.save(scope, paths[i], chunk);
    }
    written.set(digest, ref);
    return ref;
  };
  const { downloads, responseContracts, ...rest } = state;
  const stored: StoredModuleState = {
    ...rest,
    installed: {},
    downloadRefs: {},
    responseContractRefs: {},
  };
  for (const [id, entry] of Object.entries(state.installed)) {
    const { signed, artifact, ...metadata } = entry;
    stored.installed[id] = signed
      ? { ...metadata, signedRef: await save(signed) }
      : { ...metadata, artifact };
  }
  for (const [id, pkg] of Object.entries(downloads ?? {}))
    stored.downloadRefs![id] = await save(pkg);
  const retained = new Set(
    state.journal
      .filter((entry) => entry.state !== "accepted" && !entry.supersededBy)
      .map(
        (entry) => `${entry.call.moduleId}@${entry.call.moduleVersion ?? ""}`,
      ),
  );
  for (const [key, entry] of Object.entries(responseContracts ?? {}))
    if (retained.has(key))
      stored.responseContractRefs![key] = {
        signedRef: await save(entry.signed),
        publicKey: entry.publicKey,
      };
  return stored;
}
