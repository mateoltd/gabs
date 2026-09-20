import { currentPolicyModules } from "../governance/module-policy";
import {
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import { sql } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type { Tx } from "../persistence/database";
import { requireCondition } from "../errors";
import { workspaceDependencies } from "../registry/module-releases";
import {
  assertModuleStorage,
  lockModuleStorage,
} from "../persistence/module-storage";
import type { Permission, ModuleId, ProfileRecovery } from "@suite/contracts";
import type { ServerRuntime } from "../runtime/host";
export interface Actor {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  mfa: boolean;
  csrfToken?: string;
  authentication?: Pick<ProfileRecovery, "sessionId" | "authenticatedAt"> & {
    observedAt?: number;
  };
}
export interface Context {
  actor: Actor;
  workspaceId: string;
  requestId: string;
  membershipId: string;
  permissions: string[];
  roleNames: string[];
  runtime: ServerRuntime;
}
export async function authorize(
  tx: Tx,
  actor: Actor,
  workspaceId: string,
  requestId: string,
  runtime: ServerRuntime,
  permission?: Permission,
  moduleId?: ModuleId,
): Promise<Context> {
  // PostgreSQL UUIDs are case-insensitive; capability lock/cache keys must be too.
  workspaceId = workspaceId.toLowerCase();
  // One statement reads the current identity, membership and complete grant graph.
  // Nothing is cached across requests; explicit denials still see all workspace roles.
  const membership = await tx
    .selectFrom("suite.users as u")
    .leftJoin("suite.memberships as m", (j) =>
      j
        .onRef("m.user_id", "=", "u.id")
        .on("m.workspace_id", "=", workspaceId)
        .on("m.active", "=", true),
    )
    .leftJoin("suite.workspaces as w", "w.id", "m.workspace_id")
    .leftJoin("suite.platform_settings as p", (j) =>
      j
        .onRef("p.workspace_id", "=", "m.workspace_id")
        .on("p.key", "=", "organization"),
    )
    .select(["u.active", "m.id", "w.kind", "p.value as policy"])
    .select((eb) =>
      jsonArrayFrom(
        eb
          .selectFrom("suite.roles as r")
          .leftJoin("suite.role_assignments as a", (j) =>
            j
              .onRef("a.role_id", "=", "r.id")
              .onRef("a.workspace_id", "=", "r.workspace_id")
              .onRef("a.membership_id", "=", "m.id"),
          )
          .select(["r.id", "r.name", "r.permissions", "a.membership_id"])
          .where("r.workspace_id", "=", workspaceId),
      ).as("roles"),
    )
    .where("u.id", "=", actor.id)
    .executeTakeFirst();
  requireCondition(
    membership?.active,
    401,
    "UNAUTHENTICATED",
    "Sign in to continue.",
  );
  requireCondition(
    membership.id && membership.kind,
    403,
    "MEMBERSHIP_REVOKED",
    "You no longer have access to this workspace.",
  );
  const allRoles = membership.roles;
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
  if (moduleId)
    await checkModule(tx, workspaceId, membership.id, moduleId, runtime);
  return {
    actor,
    workspaceId,
    requestId,
    membershipId: membership.id,
    permissions,
    roleNames,
    runtime,
  };
}
export async function checkModule(
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleId: ModuleId,
  runtime: ServerRuntime,
) {
  const definitions = await workspaceDependencies(
    tx,
    workspaceId,
    moduleId,
    runtime.catalog,
  );
  const ids = definitions.map((module) => module.id);
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
    .select([
      "m.module_id",
      "m.state",
      "e.active",
      "a.membership_id",
      "a.direct",
    ])
    .where("m.workspace_id", "=", workspaceId)
    .where("m.module_id", "in", ids)
    .execute();
  const policyModules = modules.some((m) => m.membership_id && !m.direct)
    ? await currentPolicyModules(tx, workspaceId, membershipId, runtime.catalog)
    : [];
  for (const definition of definitions) {
    const id = definition.id;
    await assertModuleStorage(tx, workspaceId, definition);
    const module = modules.find((m) => m.module_id === id);
    requireCondition(
      module?.active && module.state === "enabled",
      403,
      "MODULE_UNAVAILABLE",
      `${runtime.catalog.definition(id)?.name ?? id} must be enabled for this action.`,
    );
    requireCondition(
      module.membership_id && (module.direct || policyModules.includes(id)),
      403,
      "MODULE_NOT_ASSIGNED",
      `Request access to ${id} before using this action.`,
    );
  }
}
export async function lockWorkspace(tx: Tx, id: string) {
  await lockModuleStorage(tx, id);
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
