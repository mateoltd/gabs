import {
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import { moduleDependencies, moduleDefinition } from "@suite/module-catalog";
import { sql } from "kysely";
import type { Tx } from "./database";
import { requireCondition } from "./errors";
import { resolveWorkspaceRelease } from "./module-releases";
import type { Permission, ModuleId } from "@suite/contracts";
export interface Actor {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  mfa: boolean;
  csrfToken?: string;
}
export interface Context {
  actor: Actor;
  workspaceId: string;
  requestId: string;
  membershipId: string;
  permissions: string[];
  roleNames: string[];
}
export async function authorize(
  tx: Tx,
  actor: Actor,
  workspaceId: string,
  requestId: string,
  permission?: Permission,
  moduleId?: ModuleId,
): Promise<Context> {
  const user = await tx
    .selectFrom("suite.users")
    .select("active")
    .where("id", "=", actor.id)
    .executeTakeFirst();
  requireCondition(
    user?.active,
    401,
    "UNAUTHENTICATED",
    "Sign in to continue.",
  );
  const membership = await tx
    .selectFrom("suite.memberships as m")
    .innerJoin("suite.workspaces as w", "w.id", "m.workspace_id")
    .leftJoin("suite.platform_settings as p", (j) =>
      j
        .onRef("p.workspace_id", "=", "m.workspace_id")
        .on("p.key", "=", "organization"),
    )
    .select(["m.id", "w.kind", "p.value as policy"])
    .where("m.workspace_id", "=", workspaceId)
    .where("m.user_id", "=", actor.id)
    .where("m.active", "=", true)
    .executeTakeFirst();
  requireCondition(
    membership,
    403,
    "MEMBERSHIP_REVOKED",
    "You no longer have access to this workspace.",
  );
  // Read grants and assignments together, with no cross-request permission cache.
  const allRoles = await tx
    .selectFrom("suite.roles as r")
    .leftJoin("suite.role_assignments as a", (j) =>
      j
        .onRef("a.role_id", "=", "r.id")
        .onRef("a.workspace_id", "=", "r.workspace_id")
        .on("a.membership_id", "=", membership.id),
    )
    .select(["r.id", "r.name", "r.permissions", "a.membership_id"])
    .where("r.workspace_id", "=", workspaceId)
    .execute();
  const roles = allRoles.filter((r) => r.membership_id !== null);
  const permissions = effectivePermissions(
    roles.map((r) => r.id),
    Object.fromEntries(allRoles.map((r) => [r.id, r.permissions])),
    membership.policy as unknown as OrganizationPolicy | undefined,
  ).permissions;
  const roleNames = roles.map((r) => r.name);
  if (
    membership.kind === "company" &&
    roleNames.some((n) => n === "Owner" || n === "Administrator")
  )
    requireCondition(
      actor.mfa,
      403,
      "MFA_REQUIRED",
      "Use multi-factor authentication to access this company as an administrator.",
    );
  if (permission)
    requireCondition(
      permissions.includes(permission),
      403,
      "FORBIDDEN",
      "Your role does not allow this action.",
    );
  if (moduleId) await checkModule(tx, workspaceId, membership.id, moduleId);
  return {
    actor,
    workspaceId,
    requestId,
    membershipId: membership.id,
    permissions,
    roleNames,
  };
}
export async function checkModule(
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleId: ModuleId,
) {
  const releases = await resolveWorkspaceRelease(
    tx,
    workspaceId,
    moduleId,
    true,
  );
  const ids = releases.length
    ? releases.map((r) => r.module_id)
    : moduleDependencies(moduleId);
  const modules = await tx
    .selectFrom("suite.module_activations as m")
    .innerJoin("suite.entitlements as e", (j) =>
      j
        .onRef("m.workspace_id", "=", "e.workspace_id")
        .onRef("m.module_id", "=", "e.module_id"),
    )
    .leftJoin("suite.module_assignments as a", (j) =>
      j
        .onRef("a.workspace_id", "=", "m.workspace_id")
        .onRef("a.module_id", "=", "m.module_id")
        .on("a.membership_id", "=", membershipId),
    )
    .select(["m.module_id", "m.state", "e.active", "a.membership_id"])
    .where("m.workspace_id", "=", workspaceId)
    .where("m.module_id", "in", ids)
    .execute();
  for (const id of ids) {
    const module = modules.find((m) => m.module_id === id);
    requireCondition(
      module?.active && module.state === "enabled",
      403,
      "MODULE_UNAVAILABLE",
      `${moduleDefinition(id)?.name ?? id} must be enabled for this action.`,
    );
    requireCondition(
      module.membership_id,
      403,
      "MODULE_NOT_ASSIGNED",
      `Request access to ${id} before using this action.`,
    );
  }
}
export async function lockWorkspace(tx: Tx, id: string) {
  await tx
    .selectFrom("suite.workspaces")
    .select("id")
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirstOrThrow();
}
export async function lockKey(tx: Tx, key: string) {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(
    tx,
  );
}

/** Notification routing uses the same inheritance and deny rules as requests. */
export async function permissionRecipients(
  tx: Tx,
  workspaceId: string,
  permission: string,
): Promise<string[]> {
  const [roles, assignments, policy] = await Promise.all([
    tx
      .selectFrom("suite.roles")
      .select(["id", "permissions"])
      .where("workspace_id", "=", workspaceId)
      .execute(),
    tx
      .selectFrom("suite.role_assignments as a")
      .innerJoin("suite.memberships as m", (j) =>
        j
          .onRef("m.id", "=", "a.membership_id")
          .onRef("m.workspace_id", "=", "a.workspace_id"),
      )
      .innerJoin("suite.users as u", "u.id", "m.user_id")
      .select(["m.user_id", "a.role_id"])
      .where("a.workspace_id", "=", workspaceId)
      .where("m.active", "=", true)
      .where("u.active", "=", true)
      .execute(),
    tx
      .selectFrom("suite.platform_settings")
      .select("value")
      .where("workspace_id", "=", workspaceId)
      .where("key", "=", "organization")
      .executeTakeFirst(),
  ]);
  const byUser = new Map<string, string[]>();
  for (const assignment of assignments)
    byUser.set(assignment.user_id, [
      ...(byUser.get(assignment.user_id) ?? []),
      assignment.role_id,
    ]);
  const grants = Object.fromEntries(
    roles.map((role) => [role.id, role.permissions]),
  );
  return [...byUser]
    .filter(([, selected]) =>
      effectivePermissions(
        selected,
        grants,
        policy?.value as unknown as OrganizationPolicy | undefined,
      ).permissions.includes(permission),
    )
    .map(([userId]) => userId);
}
