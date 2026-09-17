import {
  assertViewHost,
  validateViewRequirements,
  type ViewHostRequirements,
  type ViewHostCapabilities,
} from "./host-ui";
import type { ModuleDefinition } from "./index";

export interface ClientViewBundle {
  format: "suite-view-v1" | "suite-view-v2";
  javascript: string;
  css: string;
  requires?: ViewHostRequirements;
}
export type ClientBundles = Record<string, ClientViewBundle>;

/** Transported contracts exclude executable payloads when matching a staged server. */
export function moduleContract(
  artifact: Record<string, unknown>,
): ModuleDefinition {
  const { client: _client, local: _local, ...contract } = artifact;
  return contract as unknown as ModuleDefinition;
}

export function validateClientArtifacts(
  artifact: Record<string, unknown>,
): ClientBundles {
  const views = moduleContract(artifact).views ?? {};
  const client = artifact.client;
  if (client === undefined && !Object.keys(views).length) return {};
  if (!client || typeof client !== "object" || Array.isArray(client))
    throw Error(
      "Custom views require signed executable client bundles. Rebuild this module.",
    );
  const bundles = client as ClientBundles;
  if (Object.keys(bundles).length !== Object.keys(views).length)
    throw Error("Executable views do not match the declared module views.");
  let total = 0;
  for (const [name, value] of Object.entries(bundles)) {
    if (
      !Object.hasOwn(views, name) ||
      !value ||
      value.format !== (views[name]?.state ? "suite-view-v2" : "suite-view-v1")
    )
      throw Error(
        `Unsupported executable view contract: ${name}. Update the host or rebuild the module.`,
      );
    if (
      typeof value.javascript !== "string" ||
      !value.javascript.trim() ||
      typeof value.css !== "string"
    )
      throw Error(`Invalid executable view payload: ${name}`);
    if (value.requires !== undefined) validateViewRequirements(value.requires);
    const bytes = new TextEncoder().encode(value.javascript).byteLength;
    const cssBytes = new TextEncoder().encode(value.css).byteLength;
    if (bytes > 2 * 1024 * 1024 || cssBytes > 256 * 1024)
      throw Error(`View ${name} exceeds the supported bundle size.`);
    total += bytes + cssBytes;
  }
  if (total > 8 * 1024 * 1024)
    throw Error("Module client exceeds the supported package size.");
  return bundles;
}

/** Compatibility is separate from cryptographic trust and is checked before executing code. */
export function assertClientHost(
  artifact: Record<string, unknown>,
  capabilities: ViewHostCapabilities,
) {
  for (const bundle of Object.values(validateClientArtifacts(artifact)))
    if (bundle.requires) assertViewHost(bundle.requires, capabilities);
}
export function clientRequirements(artifact: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(validateClientArtifacts(artifact))
      .filter(([, bundle]) => bundle.requires !== undefined)
      .map(([name, bundle]) => [name, bundle.requires!]),
  );
}
export function verifyClientRequirements(
  artifact: Record<string, unknown>,
  manifest: Record<string, unknown>,
) {
  const actual = clientRequirements(artifact);
  const declared =
    manifest.clientRequirements === undefined
      ? {}
      : manifest.clientRequirements;
  if (
    !declared ||
    typeof declared !== "object" ||
    Array.isArray(declared) ||
    Object.keys(declared).length !== Object.keys(actual).length
  )
    throw Error("Host view requirements do not match the signed manifest.");
  for (const [name, requirements] of Object.entries(actual)) {
    const value = (declared as Record<string, unknown>)[name];
    validateViewRequirements(value);
    if (
      Object.keys(value).length !== Object.keys(requirements).length ||
      Object.entries(requirements).some(
        ([key, revision]) =>
          !Object.hasOwn(value, key) || value[key] !== revision,
      )
    )
      throw Error("Host view requirements do not match the signed manifest.");
  }
}

export function assertManifestHost(
  manifest: { clientRequirements?: unknown },
  capabilities: ViewHostCapabilities,
) {
  if (manifest.clientRequirements === undefined) return;
  const requirements = manifest.clientRequirements;
  if (
    !requirements ||
    typeof requirements !== "object" ||
    Array.isArray(requirements)
  )
    throw Error("Invalid manifest host view requirements.");
  for (const value of Object.values(requirements)) {
    validateViewRequirements(value);
    assertViewHost(value, capabilities);
  }
}
