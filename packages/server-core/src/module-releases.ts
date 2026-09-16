import { moduleStorageVersions } from "./module-storage";
import { readFile } from "node:fs/promises";
import { moduleDefinition, moduleDefinitions } from "@suite/module-catalog";
import { PLATFORM_PERMISSIONS } from "@suite/contracts";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import {
  resolveReleases,
  storageCompatibleReleases,
  satisfies,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import { verifyPackage } from "../../module-sdk/node/signing";
import type { Tx } from "./database";
import { found, AppError } from "./errors";
export const registryPublicKey = async () =>
  process.env.MODULE_SIGNING_PUBLIC_KEY ??
  (await readFile(
    `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
    "utf8",
  ));
export async function resolveWorkspaceRelease(
  tx: Tx,
  workspaceId: string,
  id: string,
  allowUnpublishedBuiltin = false,
  targetVersion?: string,
) {
  const storage = await moduleStorageVersions(tx, workspaceId);
  const releases = await tx
    .selectFrom("suite.module_releases")
    .select(["module_id", "version", "manifest"])
    .execute();
  if (allowUnpublishedBuiltin && !releases.some((r) => r.module_id === id))
    return [];
  const rows = await tx
    .selectFrom("suite.platform_settings")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .where("key", "like", "pin:%")
    .execute();
  const pins = Object.fromEntries(
    rows
      .filter((r) => r.value.version)
      .map((r) => [r.key.slice(4), String(r.value.version)]),
  );
  if (targetVersion) pins[id] = targetVersion;
  const manifests = releases.map(
    (r) => r.manifest as unknown as ReleaseManifest,
  );
  let plan: ReleaseManifest[];
  try {
    plan = resolveReleases(
      id,
      storageCompatibleReleases(manifests, storage, pins),
      "1.0.0",
      "1.0.0",
      pins,
    );
  } catch (error) {
    throw new AppError(409, "RELEASE_INCOMPATIBLE", (error as Error).message);
  }
  // Resolve with compact metadata; unrelated executable bundles must never be
  // transferred and parsed on a business request's authorization path.
  const packages = await tx
    .selectFrom("suite.module_releases")
    .selectAll()
    .where((eb) =>
      eb.or(
        plan.map((item) =>
          eb.and([
            eb("module_id", "=", item.id),
            eb("version", "=", item.version),
          ]),
        ),
      ),
    )
    .execute();
  const publicKey = await registryPublicKey();
  return plan.map((item) =>
    verifyPackage(
      found(
        packages.find(
          (r) => r.module_id === item.id && r.version === item.version,
        ),
      ),
      publicKey,
    ),
  );
}
export async function workspaceModule(
  tx: Tx,
  workspaceId: string,
  id: string,
  version?: string,
): Promise<ModuleDefinition> {
  const plan = await resolveWorkspaceRelease(
    tx,
    workspaceId,
    id,
    true,
    version,
  );
  if (!plan.length) return found(moduleDefinition(id));
  return hydrateModule(
    found(plan.find((p) => p.module_id === id))
      .artifact as unknown as ModuleDefinition,
  );
}

export async function workspaceDependencies(
  tx: Tx,
  workspaceId: string,
  id: string,
) {
  const plan = await resolveWorkspaceRelease(tx, workspaceId, id, true);
  if (plan.length)
    return plan.map((release) =>
      hydrateModule(release.artifact as unknown as ModuleDefinition),
    );
  // An unpublished development consumer may call a published/pinned provider.
  // Resolve that provider's workspace contract, never the host's older builtin.
  const selected = new Map<string, ModuleDefinition>();
  async function visit(name: string, path: string[] = [], range?: string) {
    if (path.includes(name))
      throw new AppError(
        409,
        "RELEASE_INCOMPATIBLE",
        "Circular module dependency.",
      );
    const definition =
      selected.get(name) ?? (await workspaceModule(tx, workspaceId, name));
    if (range && !satisfies(definition.version, range))
      throw new AppError(
        409,
        "RELEASE_INCOMPATIBLE",
        `${name}@${definition.version} does not satisfy ${range}.`,
      );
    if (selected.has(name)) return;
    for (const [dependency, required] of Object.entries(
      definition.dependencies,
    ))
      await visit(dependency, [...path, name], required);
    selected.set(name, definition);
  }
  await visit(id);
  return [...selected.values()];
}
export async function workspaceDependencyIds(
  tx: Tx,
  workspaceId: string,
  id: string,
) {
  return (await workspaceDependencies(tx, workspaceId, id)).map(
    (module) => module.id,
  );
}

export async function registeredModuleIds(tx: Tx) {
  const published = await tx
    .selectFrom("suite.module_releases")
    .select("module_id")
    .distinct()
    .execute();
  return [
    ...new Set([
      ...moduleDefinitions.map((m) => m.id),
      ...published.map((r) => r.module_id),
    ]),
  ];
}

/** Both policy editors validate against the workspace's selected signed contracts. */
export async function workspaceBusinessPermissions(
  tx: Tx,
  workspaceId: string,
) {
  const definitions = await Promise.all(
    (await registeredModuleIds(tx)).map((id) =>
      workspaceModule(tx, workspaceId, id),
    ),
  );
  return [...new Set(definitions.flatMap((m) => m.permissions))].filter(
    (permission) =>
      !(PLATFORM_PERMISSIONS as readonly string[]).includes(permission),
  );
}
