import { assertModuleStorage } from "./module-storage";
import { assertSchema } from "@suite/module-sdk";
import { randomUUID } from "node:crypto";
import { type Bootstrap } from "@suite/contracts";
import {
  workspaceModule,
  workspaceDependencyIds,
  workspaceBusinessPermissions,
  registeredModuleIds,
} from "./module-releases";
import { type Tx } from "./database";
import { type Context, lockWorkspace } from "./authorization";
import { found, requireCondition } from "./errors";
import { audit, publish, iso } from "./transactions";
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
          ...(await registeredModuleIds(tx)),
          ...modules.map((m) => m.module_id),
        ]),
      ]
    : modules
        .filter((m) => m.state === "enabled" && m.active)
        .map((m) => m.module_id);
  const assigned = await tx
    .selectFrom("suite.module_assignments")
    .select("module_id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "=", ctx.membershipId)
    .execute();
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
    modules: visibleIds.map((id) => {
      const m = modules.find((m) => m.module_id === id);
      return {
        moduleId: id,
        state: m?.state ?? "draft",
        accessPolicy: m?.access_policy ?? "admin",
        entitled: m?.active ?? false,
        assigned: assigned.some((a) => a.module_id === id),
      };
    }) as Bootstrap["modules"],
    offlineHours: w.offline_hours,
    seatLimit: w.seat_limit,
    memberCount: Number(count.n),
    authorizedAt: new Date().toISOString(),
  };
}
export async function listMembers(tx: Tx, ctx: Context) {
  const members = await tx
    .selectFrom("suite.memberships as m")
    .innerJoin("suite.users as u", "m.user_id", "u.id")
    .select(["m.id", "m.user_id", "m.active", "u.name", "u.email"])
    .where("m.workspace_id", "=", ctx.workspaceId)
    .orderBy("u.name")
    .execute();
  const assignments = await tx
    .selectFrom("suite.role_assignments as a")
    .innerJoin("suite.roles as r", (j) =>
      j
        .onRef("a.role_id", "=", "r.id")
        .onRef("a.workspace_id", "=", "r.workspace_id"),
    )
    .select([
      "a.membership_id",
      "r.id",
      "r.name",
      "r.permissions",
      "r.protected",
    ])
    .where("a.workspace_id", "=", ctx.workspaceId)
    .execute();
  const modules = await tx
    .selectFrom("suite.module_assignments")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .execute();
  return members.map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.name,
    email: m.email,
    active: m.active,
    roles: assignments
      .filter((a) => a.membership_id === m.id)
      .map(({ id, name, permissions, protected: protectedRole }) => ({
        id,
        name,
        permissions,
        protected: protectedRole,
      })),
    modules: modules
      .filter((a) => a.membership_id === m.id)
      .map((a) => a.module_id),
  }));
}
export async function assignModules(
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleIds: string[],
) {
  const ids = [
    ...new Set(
      (
        await Promise.all(
          moduleIds.map((id) => workspaceDependencyIds(tx, workspaceId, id)),
        )
      ).flat(),
    ),
  ];
  for (const id of ids) {
    const module = await tx
      .selectFrom("suite.module_activations as m")
      .innerJoin("suite.entitlements as e", (j) =>
        j
          .onRef("m.workspace_id", "=", "e.workspace_id")
          .onRef("m.module_id", "=", "e.module_id"),
      )
      .select(["m.state", "e.active", "e.seat_limit"])
      .where("m.workspace_id", "=", workspaceId)
      .where("m.module_id", "=", id)
      .executeTakeFirst();
    if (module?.seat_limit !== null && module?.seat_limit !== undefined) {
      const count = await tx
        .selectFrom("suite.module_assignments as a")
        .innerJoin("suite.memberships as m", (j) =>
          j
            .onRef("a.membership_id", "=", "m.id")
            .onRef("a.workspace_id", "=", "m.workspace_id"),
        )
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("a.workspace_id", "=", workspaceId)
        .where("a.module_id", "=", id)
        .where("a.membership_id", "!=", membershipId)
        .where("m.active", "=", true)
        .executeTakeFirstOrThrow();
      requireCondition(
        Number(count.n) < module.seat_limit,
        409,
        "NO_MODULE_SEATS",
        `No ${id} seats are available.`,
      );
    }
    requireCondition(
      module?.active && module.state === "enabled",
      409,
      "MODULE_UNAVAILABLE",
      "Only entitled, enabled modules can be assigned.",
    );
  }
  await tx
    .deleteFrom("suite.module_assignments")
    .where("workspace_id", "=", workspaceId)
    .where("membership_id", "=", membershipId)
    .execute();
  if (ids.length)
    await tx
      .insertInto("suite.module_assignments")
      .values(
        ids.map((module_id) => ({
          workspace_id: workspaceId,
          membership_id: membershipId,
          module_id,
        })),
      )
      .execute();
}
export async function editMember(
  tx: Tx,
  ctx: Context,
  id: string,
  input: { active: boolean; roleIds: string[]; modules: string[] },
) {
  await lockWorkspace(tx, ctx.workspaceId);
  const member = found(
    await tx
      .selectFrom("suite.memberships")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .executeTakeFirst(),
  );
  const current = await tx
    .selectFrom("suite.role_assignments as a")
    .innerJoin("suite.roles as r", (j) =>
      j
        .onRef("a.role_id", "=", "r.id")
        .onRef("a.workspace_id", "=", "r.workspace_id"),
    )
    .select("r.name")
    .where("a.membership_id", "=", id)
    .where("a.workspace_id", "=", ctx.workspaceId)
    .execute();
  const roles = input.roleIds.length
    ? await tx
        .selectFrom("suite.roles")
        .selectAll()
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "in", [...new Set(input.roleIds)])
        .execute()
    : [];
  requireCondition(
    roles.length === new Set(input.roleIds).size,
    400,
    "INVALID_ROLE",
    "A selected role is not available.",
  );
  requireCondition(
    !input.active || roles.length > 0,
    400,
    "ROLE_REQUIRED",
    "Active members require at least one role.",
  );
  const wasOwner = current.some((r) => r.name === "Owner"),
    willOwn = roles.some((r) => r.name === "Owner");
  if (wasOwner || willOwn)
    requireCondition(
      ctx.roleNames.includes("Owner"),
      403,
      "OWNER_REQUIRED",
      "Only an owner can manage ownership.",
    );
  if (wasOwner && (!input.active || !willOwn)) {
    const otherOwner = await tx
      .selectFrom("suite.role_assignments as a")
      .innerJoin("suite.roles as r", (j) =>
        j
          .onRef("a.role_id", "=", "r.id")
          .onRef("a.workspace_id", "=", "r.workspace_id"),
      )
      .innerJoin("suite.memberships as m", (j) =>
        j
          .onRef("a.membership_id", "=", "m.id")
          .onRef("a.workspace_id", "=", "m.workspace_id"),
      )
      .select("m.id")
      .where("a.workspace_id", "=", ctx.workspaceId)
      .where("r.name", "=", "Owner")
      .where("m.active", "=", true)
      .where("m.id", "!=", id)
      .executeTakeFirst();
    requireCondition(
      otherOwner,
      409,
      "LAST_OWNER",
      "Assign another active owner before removing this owner.",
    );
  }
  if (input.active && !member.active) {
    const w = await tx
      .selectFrom("suite.workspaces")
      .select("seat_limit")
      .where("id", "=", ctx.workspaceId)
      .executeTakeFirstOrThrow();
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
      "No seats are available.",
    );
  }
  await tx
    .updateTable("suite.memberships")
    .set({ active: input.active })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
  await tx
    .deleteFrom("suite.role_assignments")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "=", id)
    .execute();
  if (roles.length)
    await tx
      .insertInto("suite.role_assignments")
      .values(
        roles.map((r) => ({
          workspace_id: ctx.workspaceId,
          membership_id: id,
          role_id: r.id,
        })),
      )
      .execute();
  await assignModules(
    tx,
    ctx.workspaceId,
    id,
    input.active ? input.modules : [],
  );
  await audit(
    tx,
    ctx,
    input.active ? "members.updated" : "members.removed",
    id,
  );
  return { ok: true };
}
export async function saveRole(
  tx: Tx,
  ctx: Context,
  input: { name: string; permissions: string[] },
  id?: string,
) {
  const permitted = await workspaceBusinessPermissions(tx, ctx.workspaceId);
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
  // Invitation grants membership and a role. Module assignment is a separate administrative action.
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
  const definition = await workspaceModule(tx, ctx.workspaceId, id);
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
  if (input.state === "enabled") {
    await assertModuleStorage(tx, ctx.workspaceId, definition);
    assertSchema(definition.configuration, config);
    requireCondition(
      entitlement?.active,
      409,
      "NOT_ENTITLED",
      "This module is not included in the workspace entitlement.",
    );
    for (const dependency of (
      await workspaceDependencyIds(tx, ctx.workspaceId, id)
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
  const required = await workspaceDependencyIds(tx, ctx.workspaceId, moduleId);
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
      .where("workspace_id", "=", ctx.workspaceId)
      .where("membership_id", "=", ctx.membershipId)
      .execute();
    await assignModules(tx, ctx.workspaceId, ctx.membershipId, [
      ...current.map((m) => m.module_id),
      moduleId,
    ]);
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
      .where("workspace_id", "=", ctx.workspaceId)
      .where("membership_id", "=", request.membership_id)
      .execute();
    await assignModules(tx, ctx.workspaceId, request.membership_id, [
      ...current.map((m) => m.module_id),
      request.module_id,
    ]);
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
