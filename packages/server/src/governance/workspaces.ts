import { currentPolicyModules } from "./module-policy";
import { assignModules, reconcileModulePolicies } from "./module-assignments";
export { assignModules } from "./module-assignments";
import { assertModuleStorage } from "../persistence/module-storage";
import { assertSchema } from "@suite/module-sdk";
import { randomUUID } from "node:crypto";
import { type Bootstrap } from "@suite/contracts";
import {
  workspaceModule,
  workspaceDependencyIds,
  workspaceBusinessPermissions,
  registeredModuleIds,
  isUnavailableRelease,
} from "../registry/module-releases";
import { type Tx } from "../persistence/database";
import {
  type Context,
  lockWorkspace,
  authorize,
} from "../identity/authorization";
import { found, requireCondition } from "../errors";
import { audit, publish, iso } from "../persistence/transactions";
export async function bootstrap(tx: Tx, ctx: Context): Promise<Bootstrap> {
  const w = found(
    await tx
      .selectFrom("suite.workspaces")
      .selectAll()
      .where("id", "=", ctx.workspaceId)
      .executeTakeFirst(),
  );
  const [activations, entitlements] = await Promise.all([
    tx
      .selectFrom("suite.module_activations")
      .select(["module_id", "state", "access_policy"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute(),
    tx
      .selectFrom("suite.entitlements")
      .select(["module_id", "active"])
      .where("workspace_id", "=", ctx.workspaceId)
      .execute(),
  ]);
  const modules = [
    ...new Set([
      ...activations.map((m) => m.module_id),
      ...entitlements.map((m) => m.module_id),
    ]),
  ].map((id) => ({
    module_id: id,
    state: activations.find((m) => m.module_id === id)?.state ?? "draft",
    access_policy:
      activations.find((m) => m.module_id === id)?.access_policy ?? "admin",
    active: entitlements.find((m) => m.module_id === id)?.active ?? false,
  }));
  const admin = ctx.permissions.includes("modules.manage");
  const visibleIds = admin
    ? [
        ...new Set([
          ...(await registeredModuleIds(tx, ctx.runtime.catalog)),
          ...modules.map((m) => m.module_id),
        ]),
      ]
    : modules
        .filter((m) => m.state === "enabled" && m.active)
        .map((m) => m.module_id);
  const releasePolicies = await tx
    .selectFrom("suite.platform_settings")
    .select(["key", "value"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("key", "like", "pin:%")
    .execute();
  const assigned = await tx
    .selectFrom("suite.module_assignments")
    .select(["module_id", "direct"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "=", ctx.membershipId)
    .execute();
  const policyModules = assigned.some((a) => !a.direct)
    ? await currentPolicyModules(
        tx,
        ctx.workspaceId,
        ctx.membershipId,
        ctx.runtime.catalog,
      )
    : [];
  const count = await tx
    .selectFrom("suite.memberships")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("workspace_id", "=", ctx.workspaceId)
    .where("active", "=", true)
    .executeTakeFirstOrThrow();
  return {
    workspace: {
      id: w.id,
      name: w.name,
      kind: w.kind,
      currency: w.currency,
      accent: w.accent,
      logoDataUrl: w.logo_data_url,
    },
    permissions: ctx.permissions,
    roleNames: ctx.roleNames,
    modules: (await Promise.all(
      visibleIds.map(async (id) => {
        const m = modules.find((m) => m.module_id === id);
        const rollout = releasePolicies.find(
          (p) => p.key === `pin:${id}`,
        )?.value;
        const configuredSelection = typeof rollout?.version === "string";
        let selectedVersion: string | undefined;
        if (configuredSelection) {
          try {
            selectedVersion = (
              await workspaceModule(
                tx,
                ctx.workspaceId,
                id,
                ctx.runtime.catalog,
              )
            ).version;
          } catch (error) {
            if (!isUnavailableRelease(error)) throw error;
            // Keep workspace recovery reachable without asserting an accepted release.
          }
        }
        const acceptedVersions = selectedVersion
          ? [
              ...new Set([
                selectedVersion,
                ...(rollout?.mandatory === false &&
                Array.isArray(rollout.acceptedVersions)
                  ? rollout.acceptedVersions.filter(
                      (v): v is string => typeof v === "string",
                    )
                  : []),
              ]),
            ]
          : configuredSelection
            ? []
            : undefined;
        return {
          moduleId: id,
          state: m?.state ?? "draft",
          accessPolicy: m?.access_policy ?? "admin",
          entitled: m?.active ?? false,
          assigned: assigned.some(
            (a) =>
              a.module_id === id && (a.direct || policyModules.includes(id)),
          ),
          ...(acceptedVersions !== undefined ? { acceptedVersions } : {}),
        };
      }),
    )) as Bootstrap["modules"],
    offlineHours: w.offline_hours,
    seatLimit: w.seat_limit,
    memberCount: Number(count.n),
    authorizedAt: new Date().toISOString(),
    policyRevision:
      (
        await tx
          .selectFrom("suite.workspace_policy")
          .select("revision")
          .where("workspace_id", "=", ctx.workspaceId)
          .executeTakeFirst()
      )?.revision ?? "0",
  };
}
export async function saveRole(
  tx: Tx,
  ctx: Context,
  input: { name: string; permissions: string[] },
  id?: string,
) {
  const permitted = await workspaceBusinessPermissions(
    tx,
    ctx.workspaceId,
    ctx.runtime.catalog,
  );
  requireCondition(
    input.permissions.every((p) => permitted.includes(p)),
    400,
    "INVALID_PERMISSION",
    "Custom roles can grant registered business permissions only.",
  );
  requireCondition(
    !["owner", "administrator"].includes(input.name.trim().toLowerCase()),
    400,
    "PROTECTED_ROLE",
    "This role name is reserved.",
  );
  if (id) {
    const role = found(
      await tx
        .selectFrom("suite.roles")
        .selectAll()
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst(),
    );
    requireCondition(
      !role.protected,
      403,
      "PROTECTED_ROLE",
      "Protected platform roles cannot be edited.",
    );
    await tx
      .updateTable("suite.roles")
      .set({
        name: input.name.trim(),
        permissions: [...new Set(input.permissions)],
      })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .execute();
  } else {
    id = randomUUID();
    await tx
      .insertInto("suite.roles")
      .values({
        id,
        workspace_id: ctx.workspaceId,
        name: input.name.trim(),
        permissions: [...new Set(input.permissions)],
      })
      .execute();
  }
  await audit(tx, ctx, "roles.saved", id);
  return found(
    await tx
      .selectFrom("suite.roles")
      .select(["id", "name", "permissions", "protected"])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .executeTakeFirst(),
  );
}
export async function configureModule(
  tx: Tx,
  ctx: Context,
  id: string,
  input: {
    state: string;
    accessPolicy: string;
    config?: Record<string, unknown>;
  },
) {
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "modules.manage",
  );
  const entitlement = await tx
    .selectFrom("suite.entitlements")
    .select("active")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("module_id", "=", id)
    .executeTakeFirst();
  const existing = await tx
    .selectFrom("suite.module_activations")
    .select("config")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("module_id", "=", id)
    .executeTakeFirst();
  const config = input.config ?? existing?.config ?? {};
  requireCondition(
    existing ||
      (await registeredModuleIds(tx, ctx.runtime.catalog)).includes(id),
    404,
    "NOT_FOUND",
    "This module is not registered.",
  );
  const definition =
    input.state === "enabled" || input.config !== undefined
      ? await workspaceModule(tx, ctx.workspaceId, id, ctx.runtime.catalog)
      : undefined;
  if (definition) assertSchema(definition.configuration, config);
  if (input.state === "enabled") {
    await assertModuleStorage(tx, ctx.workspaceId, found(definition));
    requireCondition(
      entitlement?.active,
      409,
      "NOT_ENTITLED",
      "This module is not included in the workspace entitlement.",
    );
    for (const dependency of (
      await workspaceDependencyIds(tx, ctx.workspaceId, id, ctx.runtime.catalog)
    ).filter((dependency) => dependency !== id)) {
      const inventory = await tx
        .selectFrom("suite.module_activations as m")
        .innerJoin("suite.entitlements as e", (j) =>
          j
            .onRef("m.workspace_id", "=", "e.workspace_id")
            .onRef("m.module_id", "=", "e.module_id"),
        )
        .select(["m.state", "e.active"])
        .where("m.workspace_id", "=", ctx.workspaceId)
        .where("m.module_id", "=", dependency)
        .executeTakeFirst();
      requireCondition(
        inventory?.state === "enabled" && inventory.active,
        409,
        "DEPENDENCY_UNAVAILABLE",
        `Enable ${dependency} before enabling ${id}.`,
      );
    }
  }
  await tx
    .insertInto("suite.module_activations")
    .values({
      workspace_id: ctx.workspaceId,
      module_id: id,
      state: input.state,
      access_policy: input.accessPolicy,
      config,
    })
    .onConflict((oc) =>
      oc.columns(["workspace_id", "module_id"]).doUpdateSet({
        state: input.state,
        access_policy: input.accessPolicy,
        config,
      }),
    )
    .execute();
  await reconcileModulePolicies(
    tx,
    ctx.workspaceId,
    ctx.runtime.catalog,
    "available",
  );
  await audit(tx, ctx, "modules.configured", id);
  return { ok: true };
}
export async function requestAccess(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  reason: string,
) {
  await lockWorkspace(tx, ctx.workspaceId);
  const store = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("key", "=", "store-policy")
    .executeTakeFirst();
  requireCondition(
    store?.value.mode !== "blocked",
    403,
    "STORE_BLOCKED",
    "The corporate store is blocked. Ask an administrator for assignment.",
  );
  const module = found(
    await tx
      .selectFrom("suite.module_activations")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("module_id", "=", moduleId)
      .executeTakeFirst(),
  );
  requireCondition(
    module.access_policy !== "admin",
    403,
    "ADMIN_ASSIGNMENT_REQUIRED",
    "An administrator must assign this module.",
  );
  // Validate readiness without granting access yet.
  const required = await workspaceDependencyIds(
    tx,
    ctx.workspaceId,
    moduleId,
    ctx.runtime.catalog,
  );
  for (const id of required) {
    const m = await tx
      .selectFrom("suite.module_activations as m")
      .innerJoin("suite.entitlements as e", (j) =>
        j
          .onRef("m.workspace_id", "=", "e.workspace_id")
          .onRef("m.module_id", "=", "e.module_id"),
      )
      .select(["m.state", "e.active"])
      .where("m.workspace_id", "=", ctx.workspaceId)
      .where("m.module_id", "=", id)
      .executeTakeFirst();
    requireCondition(
      m?.active && m.state === "enabled",
      409,
      "MODULE_UNAVAILABLE",
      "The module or a dependency is unavailable.",
    );
  }
  if (module.access_policy === "self" && store?.value.mode !== "approval") {
    // Dependencies must also allow self-service; approval cannot be bypassed via a dependent module.
    for (const id of required) {
      const dependency = await tx
        .selectFrom("suite.module_activations")
        .select("access_policy")
        .where("workspace_id", "=", ctx.workspaceId)
        .where("module_id", "=", id)
        .executeTakeFirstOrThrow();
      const granted = await tx
        .selectFrom("suite.module_assignments")
        .select("module_id")
        .where("workspace_id", "=", ctx.workspaceId)
        .where("membership_id", "=", ctx.membershipId)
        .where("module_id", "=", id)
        .executeTakeFirst();
      requireCondition(
        granted || dependency.access_policy === "self",
        409,
        "DEPENDENCY_ACCESS_REQUIRED",
        "Request or obtain access to the required dependency first.",
      );
    }
    const current = await tx
      .selectFrom("suite.module_assignments")
      .select("module_id")
      .where("direct", "=", true)
      .where("workspace_id", "=", ctx.workspaceId)
      .where("membership_id", "=", ctx.membershipId)
      .execute();
    await assignModules(
      tx,
      ctx.workspaceId,
      ctx.membershipId,
      [...current.map((m) => m.module_id), moduleId],
      ctx.runtime.catalog,
    );
    await audit(tx, ctx, "modules.self_assigned", moduleId);
    return { ok: true };
  }
  const id = randomUUID();
  await tx
    .insertInto("suite.access_requests")
    .values({
      id,
      workspace_id: ctx.workspaceId,
      membership_id: ctx.membershipId,
      module_id: moduleId,
      reason,
    })
    .execute();
  await audit(tx, ctx, "modules.access_requested", id);
  await publish(tx, ctx, "access.requested", { recordId: id });
  return { ok: true };
}
export async function resolveAccess(
  tx: Tx,
  ctx: Context,
  id: string,
  state: "approved" | "denied" | "cancelled",
) {
  await lockWorkspace(tx, ctx.workspaceId);
  const request = found(
    await tx
      .selectFrom("suite.access_requests")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireCondition(
    request.state === "pending",
    409,
    "REQUEST_RESOLVED",
    "This request is no longer pending.",
  );
  if (state === "cancelled")
    requireCondition(
      request.membership_id === ctx.membershipId ||
        ctx.permissions.includes("modules.manage"),
      403,
      "FORBIDDEN",
      "You cannot cancel this request.",
    );
  else
    requireCondition(
      ctx.permissions.includes("modules.manage"),
      403,
      "FORBIDDEN",
      "An administrator must resolve this request.",
    );
  if (state === "approved") {
    const member = await tx
      .selectFrom("suite.memberships")
      .select("active")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", request.membership_id)
      .executeTakeFirst();
    requireCondition(
      member?.active,
      409,
      "MEMBER_INACTIVE",
      "This member is no longer active.",
    );
    const current = await tx
      .selectFrom("suite.module_assignments")
      .select("module_id")
      .where("direct", "=", true)
      .where("workspace_id", "=", ctx.workspaceId)
      .where("membership_id", "=", request.membership_id)
      .execute();
    await assignModules(
      tx,
      ctx.workspaceId,
      request.membership_id,
      [...current.map((m) => m.module_id), request.module_id],
      ctx.runtime.catalog,
    );
  }
  await tx
    .updateTable("suite.access_requests")
    .set({ state })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
  await audit(tx, ctx, `modules.access_${state}`, id);
  await publish(tx, ctx, "access.resolved", {
    recordId: id,
    membershipId: request.membership_id,
    state,
  });
  return { ok: true };
}
