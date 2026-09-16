import { sql } from "kysely";
import {
  assertSchema,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { canonical, satisfies } from "@suite/module-sdk/registry";
import type { Tx } from "./database";
import { found, requireCondition } from "./errors";
import { resolveWorkspaceRelease, workspaceModule } from "./module-releases";
import { assertModuleStorage } from "./module-storage";
import { stagedModuleServer } from "./staged-module-server";
import type { InstalledModuleServer } from "./module-services";
import { assertClientModuleVersion } from "./client-module-version";

import type { ModuleRollout } from "@suite/module-sdk/platform";

/** Validate an exact old release against current data, configuration and providers. */
export async function compatibleClientRelease(
  tx: Tx,
  workspaceId: string,
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
      const selected = await workspaceModule(tx, workspaceId, definition.id);
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
  if (Object.keys(module.operations).length) {
    const server = await stagedModuleServer(tx, module, servers);
    requireCondition(
      server && canonical(server.module) === canonical(module),
      409,
      "BACKEND_UNAVAILABLE",
      `Stage the exact reviewed backend for ${moduleId}@${version} before accepting this client release.`,
    );
  }
  for (const reference of Object.values(module.services ?? {})) {
    const target = await workspaceModule(tx, workspaceId, reference.moduleId);
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

/** Client version selects a reviewed contract; current authorization is still mandatory. */
export async function clientModule(
  tx: Tx,
  workspaceId: string,
  moduleId: string,
  requested: string | string[] | undefined,
  servers: readonly InstalledModuleServer[],
): Promise<ModuleDefinition> {
  const current = await workspaceModule(tx, workspaceId, moduleId);
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
  return compatibleClientRelease(tx, workspaceId, moduleId, requested, servers);
}

/** Host-owned legacy routes execute their compiled contract, not a caller-selected version. */
export async function assertHostModuleRollout(
  tx: Tx,
  workspaceId: string,
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
    await clientModule(tx, workspaceId, module.id, module.version, servers);
}

/** Administrative changes cannot silently invalidate explicitly supported client releases. */
export async function validateConfiguredRollouts(
  tx: Tx,
  workspaceId: string,
  servers: readonly InstalledModuleServer[],
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
    if (!Array.isArray(row.value.acceptedVersions)) continue;
    const current = await workspaceModule(tx, workspaceId, row.module_id);
    for (const version of new Set([
      current.version,
      ...(row.value.mandatory ? [] : (row.value.acceptedVersions as string[])),
    ]))
      await compatibleClientRelease(
        tx,
        workspaceId,
        row.module_id,
        version,
        servers,
      );
  }
}
