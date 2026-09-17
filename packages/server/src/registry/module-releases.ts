import { sql } from "kysely";
import { moduleStorageVersions } from "../persistence/module-storage";
import { readFile } from "node:fs/promises";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import { PLATFORM_PERMISSIONS } from "@suite/contracts";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import {
  resolveReleases,
  storageCompatibleReleases,
  satisfies,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import {
  verifyPackage,
  type SignedPackage,
} from "@suite/module-sdk/node/signing";
import { freezeContent, VerifiedContent } from "./verified-content";
import { isReadOnlyTransaction, type Tx } from "../persistence/database";
import { found, AppError } from "../errors";
const verifiedPackages = new VerifiedContent((json, key) =>
  verifyPackage(JSON.parse(json) as SignedPackage, key),
);
const contracts = new WeakMap<SignedPackage, ModuleDefinition>();
function releaseContract(pkg: SignedPackage) {
  let contract = contracts.get(pkg);
  if (!contract) {
    contract = freezeContent(
      hydrateModule(pkg.artifact as unknown as ModuleDefinition),
    );
    contracts.set(pkg, contract);
  }
  return contract;
}
export const registryPublicKey = async () =>
  process.env.MODULE_SIGNING_PUBLIC_KEY ??
  (await readFile(
    `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
    "utf8",
  ));
const snapshotPlans = new WeakMap<Tx, Map<string, Promise<SignedPackage[]>>>();
export async function resolveWorkspaceRelease(
  tx: Tx,
  workspaceId: string,
  id: string,
  allowUnpublishedBuiltin = false,
  targetVersion?: string,
  pinOverrides: Record<string, string> = {},
) {
  // Commands can observe or make changes in this transaction. Only a read-only
  // repeatable-read request has an immutable selection; never share across requests.
  if (!isReadOnlyTransaction(tx))
    return selectWorkspaceRelease(
      tx,
      workspaceId,
      id,
      allowUnpublishedBuiltin,
      targetVersion,
      pinOverrides,
    );
  let plans = snapshotPlans.get(tx);
  if (!plans) {
    plans = new Map();
    snapshotPlans.set(tx, plans);
  }
  const key = JSON.stringify([
    workspaceId.toLowerCase(),
    id,
    allowUnpublishedBuiltin,
    targetVersion,
    Object.entries(pinOverrides).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  let plan = plans.get(key);
  if (!plan) {
    plan = selectWorkspaceRelease(
      tx,
      workspaceId,
      id,
      allowUnpublishedBuiltin,
      targetVersion,
      pinOverrides,
    );
    plans.set(key, plan);
  }
  return [...(await plan)];
}
async function selectWorkspaceRelease(
  tx: Tx,
  workspaceId: string,
  id: string,
  allowUnpublishedBuiltin: boolean,
  targetVersion: string | undefined,
  pinOverrides: Record<string, string>,
) {
  const storage = await moduleStorageVersions(tx, workspaceId);
  // Resolve against every candidate in the dependency closure, without transferring
  // unrelated registry manifests. UNION terminates cycles before semver backtracking.
  const releases = (
    await sql<{
      module_id: string;
      version: string;
      manifest: Record<string, unknown>;
    }>`
    with recursive required_modules(module_id) as (
      select ${id}::text
      union
      select dependency.module_id
      from required_modules required
      join suite.module_releases release on release.module_id = required.module_id
      cross join lateral jsonb_object_keys(release.manifest->'dependencies') dependency(module_id)
    )
    select release.module_id, release.version, release.manifest
    from suite.module_releases release
    join required_modules required on required.module_id = release.module_id
  `.execute(tx)
  ).rows;
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
  Object.assign(pins, pinOverrides);
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
    .select([
      "module_id",
      "version",
      sql<string>`jsonb_build_object(
        'module_id', module_id, 'version', version, 'manifest', manifest,
        'artifact', artifact, 'digest', digest, 'signature', signature, 'key_id', key_id
      )::text`.as("content"),
    ])
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
    verifiedPackages.get(
      found(
        packages.find(
          (r) => r.module_id === item.id && r.version === item.version,
        ),
      ).content,
      publicKey,
    ),
  );
}
export async function workspaceModule(
  tx: Tx,
  workspaceId: string,
  id: string,
  catalog: ModuleCatalog,
  version?: string,
): Promise<ModuleDefinition> {
  const plan = await resolveWorkspaceRelease(
    tx,
    workspaceId,
    id,
    true,
    version,
  );
  if (!plan.length) return found(catalog.definition(id));
  return releaseContract(found(plan.find((p) => p.module_id === id)));
}

export async function workspaceDependencies(
  tx: Tx,
  workspaceId: string,
  id: string,
  catalog: ModuleCatalog,
) {
  const plan = await resolveWorkspaceRelease(tx, workspaceId, id, true);
  if (plan.length) return plan.map(releaseContract);
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
      selected.get(name) ??
      (await workspaceModule(tx, workspaceId, name, catalog));
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
  catalog: ModuleCatalog,
) {
  return (await workspaceDependencies(tx, workspaceId, id, catalog)).map(
    (module) => module.id,
  );
}

export async function registeredModuleIds(tx: Tx, catalog: ModuleCatalog) {
  const published = await tx
    .selectFrom("suite.module_releases")
    .select("module_id")
    .distinct()
    .execute();
  return [
    ...new Set([
      ...catalog.modules.map((m) => m.id),
      ...published.map((r) => r.module_id),
    ]),
  ];
}

/** Both policy editors validate against the workspace's selected signed contracts. */
export async function workspaceBusinessPermissions(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
) {
  const definitions = await Promise.all(
    (await registeredModuleIds(tx, catalog)).map((id) =>
      workspaceModule(tx, workspaceId, id, catalog),
    ),
  );
  return [...new Set(definitions.flatMap((m) => m.permissions))].filter(
    (permission) =>
      !(PLATFORM_PERMISSIONS as readonly string[]).includes(permission),
  );
}
