import { currentPolicyModules, modulePolicyIntents } from "./module-policy";
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
export async function createInvitation(
  tx: Tx,
  ctx: Context,
  input: { email: string; roleId: string },
) {
  await lockWorkspace(tx, ctx.workspaceId);
  const role = found(
    await tx
      .selectFrom("suite.roles")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", input.roleId)
      .executeTakeFirst(),
  );
  requireCondition(
    role.name !== "Owner" || ctx.roleNames.includes("Owner"),
    403,
    "OWNER_REQUIRED",
    "Only an owner can invite another owner.",
  );
  const workspace = await tx
    .selectFrom("suite.workspaces")
    .select("kind")
    .where("id", "=", ctx.workspaceId)
    .executeTakeFirstOrThrow();
  requireCondition(
    workspace.kind === "company",
    400,
    "COMPANY_REQUIRED",
    "Invitations are available in company workspaces.",
  );
  const email = input.email.trim().toLowerCase();
  const user = await tx
    .selectFrom("suite.users")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirst();
  if (user) {
    const existing = await tx
      .selectFrom("suite.memberships")
      .select("active")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("user_id", "=", user.id)
      .executeTakeFirst();
    requireCondition(
      !existing?.active,
      409,
      "ALREADY_MEMBER",
      "This account is already an active member.",
    );
  }
  await tx
    .updateTable("suite.invitations")
    .set({ state: "revoked" })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("email", "=", email)
    .where("state", "=", "pending")
    .where("expires_at", "<=", new Date())
    .execute();
  const id = randomUUID();
  const invitation = await tx
    .insertInto("suite.invitations")
    .values({
      id,
      workspace_id: ctx.workspaceId,
      email,
      role_id: input.roleId,
      invited_by: ctx.actor.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, "invitations.created", id);
  await publish(tx, ctx, "invitation.created", { recordId: id });
  return {
    id,
    email,
    state: invitation.state,
    expiresAt: iso(invitation.expires_at),
    roleId: invitation.role_id,
  };
}
export async function acceptInvitation(
  tx: Tx,
  ctx: Context,
  id: string,
  accept = true,
) {
  requireCondition(
    ctx.actor.emailVerified,
    403,
    "EMAIL_UNVERIFIED",
    "Verify your email before responding to an invitation.",
  );
  await lockWorkspace(tx, ctx.workspaceId);
  const invitation = found(
    await tx
      .selectFrom("suite.invitations")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireCondition(
    invitation.email.toLowerCase() === ctx.actor.email.toLowerCase(),
    403,
    "WRONG_ACCOUNT",
    "Sign in with the account this invitation was sent to.",
  );
  if (invitation.state === "accepted" && accept) {
    const m = await tx
      .selectFrom("suite.memberships")
      .select("active")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("user_id", "=", ctx.actor.id)
      .executeTakeFirst();
    requireCondition(
      m?.active,
      403,
      "MEMBERSHIP_REVOKED",
      "This membership has been revoked.",
    );
    return { ok: true };
  }
  requireCondition(
    invitation.state === "pending" &&
      new Date(invitation.expires_at).getTime() > Date.now(),
    409,
    "INVITATION_EXPIRED",
    "This invitation has expired or is no longer pending.",
  );
  if (!accept) {
    await tx
      .updateTable("suite.invitations")
      .set({ state: "declined" })
      .where("id", "=", id)
      .where("workspace_id", "=", ctx.workspaceId)
      .execute();
    await audit(tx, ctx, "invitations.declined", id);
    return { ok: true };
  }
  const role = found(
    await tx
      .selectFrom("suite.roles")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", invitation.role_id)
      .executeTakeFirst(),
  );
  if (role.protected)
    requireCondition(
      ctx.actor.mfa,
      403,
      "MFA_REQUIRED",
      "Complete multi-factor authentication before accepting this administrative role.",
    );
  const w = await tx
    .selectFrom("suite.workspaces")
    .selectAll()
    .where("id", "=", ctx.workspaceId)
    .executeTakeFirstOrThrow();
  const member = await tx
    .selectFrom("suite.memberships")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("user_id", "=", ctx.actor.id)
    .executeTakeFirst();
  if (!member?.active) {
    const count = await tx
      .selectFrom("suite.memberships")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("workspace_id", "=", ctx.workspaceId)
      .where("active", "=", true)
      .executeTakeFirstOrThrow();
    requireCondition(
      Number(count.n) < w.seat_limit,
      409,
      "NO_SEATS",
      "There are no available company seats. Ask the owner to add a seat.",
    );
  }
  const previousModuleIntents = await modulePolicyIntents(tx, ctx.workspaceId);
  const membershipId = member?.id ?? randomUUID();
  if (member)
    await tx
      .updateTable("suite.memberships")
      .set({ active: true })
      .where("id", "=", member.id)
      .where("workspace_id", "=", ctx.workspaceId)
      .execute();
  else
    await tx
      .insertInto("suite.memberships")
      .values({
        id: membershipId,
        workspace_id: ctx.workspaceId,
        user_id: ctx.actor.id,
      })
      .execute();
  await tx
    .deleteFrom("suite.role_assignments")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "=", membershipId)
    .execute();
  await tx
    .insertInto("suite.role_assignments")
    .values({
      workspace_id: ctx.workspaceId,
      membership_id: membershipId,
      role_id: role.id,
    })
    .execute();
  // Existing group/tag policies apply to the accepted role under the same seat checks.
  await reconcileModulePolicies(
    tx,
    ctx.workspaceId,
    ctx.runtime.catalog,
    "strict",
    previousModuleIntents,
  );
  await tx
    .updateTable("suite.invitations")
    .set({ state: "accepted" })
    .where("id", "=", id)
    .where("workspace_id", "=", ctx.workspaceId)
    .execute();
  await audit(tx, ctx, "invitations.accepted", id);
  return { ok: true };
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
