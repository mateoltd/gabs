import { requiresServer } from "@suite/module-sdk/local-artifact";
import { verifyPackage } from "@suite/module-sdk/node/signing";
import { sql } from "kysely";
import {
  assertSchema,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { canonical, satisfies } from "@suite/module-sdk/registry";
import type { Tx } from "../persistence/database";
import { found, requireCondition } from "../errors";
import {
  registryPublicKey,
  resolveWorkspaceRelease,
  workspaceModule,
  workspaceModuleSelections,
  isUnavailableRelease,
} from "./module-releases";
import { assertModuleStorage } from "../persistence/module-storage";
import { stagedModuleServer } from "./staged-module-server";
import type { InstalledModuleServer } from "../runtime/services";
import { assertClientModuleVersion } from "./client-module-version";

import type { ModuleRollout } from "@suite/module-sdk/platform";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";

/** Validate an exact old release against current data, configuration and providers. */
export async function compatibleClientRelease(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  moduleId: string,
  version: string,
  servers: readonly InstalledModuleServer[],
): Promise<ModuleDefinition> {
  const plan = await resolveWorkspaceRelease(
    tx,
    workspaceId,
    moduleId,
    false,
    version,
  );
  const definitions = plan.map((pkg) =>
    hydrateModule(pkg.artifact as unknown as ModuleDefinition),
  );
  for (const definition of definitions) {
    await assertModuleStorage(tx, workspaceId, definition);
    if (definition.id !== moduleId) {
      const selected = await workspaceModule(
        tx,
        workspaceId,
        definition.id,
        catalog,
      );
      requireCondition(
        selected.version === definition.version,
        409,
        "DEPENDENCY_POLICY_CONFLICT",
        `${moduleId}@${version} requires ${definition.id}@${definition.version}, but the workspace selects ${selected.version}.`,
      );
    }
  }
  const module = found(
    definitions.find((definition) => definition.id === moduleId),
  );
  const activation = found(
    await tx
      .selectFrom("suite.module_activations")
      .select("config")
      .where("workspace_id", "=", workspaceId)
      .where("module_id", "=", moduleId)
      .executeTakeFirst(),
  );
  assertSchema(module.configuration, activation.config);
  if (requiresServer(module)) {
    const server = await stagedModuleServer(tx, module, servers);
    requireCondition(
      server && canonical(server.module) === canonical(module),
      409,
      "BACKEND_UNAVAILABLE",
      `Stage the exact reviewed backend for ${moduleId}@${version} before accepting this client release.`,
    );
  }
  for (const reference of Object.values(module.services ?? {})) {
    const target = await workspaceModule(
      tx,
      workspaceId,
      reference.moduleId,
      catalog,
    );
    const contract = target.operations[reference.operation];
    requireCondition(
      module.dependencies[target.id] &&
        satisfies(target.version, module.dependencies[target.id]) &&
        contract?.public &&
        canonical(contract) === canonical(reference.contract),
      409,
      "SERVICE_CONTRACT_MISMATCH",
      `${moduleId}@${version} does not match the selected ${target.id}.${reference.operation} service contract.`,
    );
  }
  return module;
}

/** Resolve historical permissions for receipt recovery, never authority to execute. */
export async function receiptContract(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  moduleId: string,
  requested: string | string[] | undefined,
) {
  const current = await workspaceModule(tx, workspaceId, moduleId, catalog);
  if (requested === undefined || requested === current.version)
    return { current, original: current };
  requireCondition(
    typeof requested === "string" &&
      /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(requested),
    400,
    "INVALID_MODULE_VERSION",
    "Provide one valid module release version.",
  );
  const release = await tx
    .selectFrom("suite.module_releases")
    .selectAll()
    .where("module_id", "=", moduleId)
    .where("version", "=", requested)
    .executeTakeFirst();
  requireCondition(
    release,
    409,
    "MODULE_UPDATE_REQUIRED",
    `This module release is unavailable. Update ${current.name} before retrying.`,
  );
  verifyPackage(release, await registryPublicKey());
  return {
    current,
    original: hydrateModule(release.artifact as unknown as ModuleDefinition),
  };
}

/** Client version selects a reviewed contract; current authorization is still mandatory. */
export async function clientModule(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  moduleId: string,
  requested: string | string[] | undefined,
  servers: readonly InstalledModuleServer[],
): Promise<ModuleDefinition> {
  const current = await workspaceModule(tx, workspaceId, moduleId, catalog);
  const row = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", workspaceId)
    .where("key", "=", `pin:${moduleId}`)
    .executeTakeFirst();
  // Historical version pins did not declare a client rollout. Preserve their retry protocol.
  if (!Array.isArray(row?.value.acceptedVersions)) {
    assertClientModuleVersion(current, requested);
    return current;
  }
  const policy = row.value as unknown as ModuleRollout;
  requireCondition(
    typeof requested === "string" &&
      /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(requested),
    409,
    "MODULE_UPDATE_REQUIRED",
    `Update ${current.name} before retrying. This workspace requires an identified module release. Pending work is preserved.`,
  );
  requireCondition(
    requested === current.version ||
      (!policy.mandatory && policy.acceptedVersions.includes(requested)),
    409,
    "MODULE_UPDATE_REQUIRED",
    `${current.name} ${requested} is no longer accepted. Update to ${current.version}; pending work is preserved.`,
  );
  return compatibleClientRelease(
    tx,
    workspaceId,
    catalog,
    moduleId,
    requested,
    servers,
  );
}

/** Host-owned legacy routes execute their compiled contract, not a caller-selected version. */
export async function assertHostModuleRollout(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  module: ModuleDefinition,
  servers: readonly InstalledModuleServer[],
) {
  const policy = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", workspaceId)
    .where("key", "=", `pin:${module.id}`)
    .executeTakeFirst();
  if (Array.isArray(policy?.value.acceptedVersions))
    await clientModule(
      tx,
      workspaceId,
      catalog,
      module.id,
      module.version,
      servers,
    );
}

/** Administrative changes cannot silently invalidate explicitly supported client releases. */
export async function validateConfiguredRollouts(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  servers: readonly InstalledModuleServer[],
  moduleIds?: ReadonlySet<string>,
) {
  const rows = await tx
    .selectFrom("suite.platform_settings as p")
    .innerJoin("suite.module_activations as a", (j) =>
      j
        .onRef("a.workspace_id", "=", "p.workspace_id")
        .on((eb) =>
          eb("p.key", "=", sql<string>`'pin:' || ${eb.ref("a.module_id")}`),
        ),
    )
    .select(["a.module_id", "p.value"])
    .where("p.workspace_id", "=", workspaceId)
    .where("a.state", "=", "enabled")
    .execute();
  for (const row of rows) {
    if (moduleIds && !moduleIds.has(row.module_id)) continue;
    if (!Array.isArray(row.value.acceptedVersions)) continue;
    const current = await workspaceModule(
      tx,
      workspaceId,
      row.module_id,
      catalog,
    );
    for (const version of new Set([
      current.version,
      ...(row.value.mandatory ? [] : (row.value.acceptedVersions as string[])),
    ]))
      await compatibleClientRelease(
        tx,
        workspaceId,
        catalog,
        row.module_id,
        version,
        servers,
      );
  }
}

/** Preserve pre-existing selection failures while an administrator repairs one module. */
export async function releasePolicySnapshot(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  moduleId: string,
) {
  const active = await tx
    .selectFrom("suite.module_activations")
    .select("module_id")
    .where("workspace_id", "=", workspaceId)
    .where("state", "=", "enabled")
    .execute();
  const moduleIds = [...new Set([moduleId, ...active.map((m) => m.module_id)])];
  const { unavailableModules } = await workspaceModuleSelections(
    tx,
    workspaceId,
    catalog,
    moduleIds,
  );
  return {
    moduleId,
    moduleIds,
    unavailable: new Set(unavailableModules.map((m) => m.moduleId)),
  };
}
export type ReleasePolicySnapshot = Awaited<
  ReturnType<typeof releasePolicySnapshot>
>;

/** A repaired target must work; previously healthy dependants and client releases stay compatible. */
export async function validateReleasePolicyChange(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  servers: readonly InstalledModuleServer[],
  previous: ReleasePolicySnapshot,
) {
  const { moduleId } = previous;
  const compatible = new Set<string>();
  for (const root of previous.moduleIds) {
    let plan: Awaited<ReturnType<typeof resolveWorkspaceRelease>>;
    try {
      plan = await resolveWorkspaceRelease(tx, workspaceId, root);
    } catch (error) {
      if (
        root !== moduleId &&
        previous.unavailable.has(root) &&
        isUnavailableRelease(error)
      )
        continue;
      throw error;
    }
    compatible.add(root);
    if (!plan.some((release) => release.module_id === moduleId)) continue;
    for (const release of plan) {
      await assertModuleStorage(
        tx,
        workspaceId,
        hydrateModule(release.artifact as unknown as ModuleDefinition),
      );
      const selected = await workspaceModule(
        tx,
        workspaceId,
        release.module_id,
        catalog,
      );
      requireCondition(
        selected.version === release.version,
        409,
        "DEPENDENCY_POLICY_CONFLICT",
        `${root} requires ${release.module_id}@${release.version}, but the workspace selects ${selected.version}. Choose compatible version pins.`,
      );
    }
  }
  const rollout = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", workspaceId)
    .where("key", "=", `pin:${moduleId}`)
    .executeTakeFirstOrThrow();
  if (Array.isArray(rollout.value.acceptedVersions)) {
    const current = await workspaceModule(tx, workspaceId, moduleId, catalog);
    for (const version of new Set([
      current.version,
      ...(rollout.value.acceptedVersions as string[]),
    ]))
      await compatibleClientRelease(
        tx,
        workspaceId,
        catalog,
        moduleId,
        version,
        servers,
      );
  }
  compatible.delete(moduleId);
  await validateConfiguredRollouts(
    tx,
    workspaceId,
    catalog,
    servers,
    compatible,
  );
}
