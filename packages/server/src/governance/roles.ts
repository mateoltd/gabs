import {
  validateOrganization,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import { createHash, randomUUID } from "node:crypto";
import type {
  RoleCreate,
  RoleEdit,
  RoleDetails,
  RoleRemove,
} from "@suite/contracts";
import { found, requireCondition } from "../errors";
import {
  authorize,
  lockWorkspace,
  type Context,
} from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { audit, publish } from "../persistence/transactions";
import { workspaceBusinessPermissions } from "../registry/module-releases";

/** Revision describes the returned role fields, never an authorization grant. */
export function roleSnapshot(
  workspaceId: string,
  role: Omit<RoleDetails, "revision">,
): RoleDetails {
  const { id, name, permissions, protected: protectedRole } = role;
  return {
    id,
    name,
    permissions,
    protected: protectedRole,
    revision: createHash("sha256")
      .update(
        JSON.stringify([
          "role-v1",
          workspaceId.toLowerCase(),
          id,
          name,
          protectedRole,
          [...new Set(permissions)].sort(),
        ]),
      )
      .digest("hex"),
  };
}
export async function listRoles(tx: Tx, ctx: Context) {
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "roles.manage",
  );
  const roles = await tx
    .selectFrom("suite.roles")
    .where("retired_at", "is", null)
    .select(["id", "name", "permissions", "protected"])
    .where("workspace_id", "=", ctx.workspaceId)
    .orderBy("name")
    .execute();
  return roles.map((role) => roleSnapshot(ctx.workspaceId, role));
}
export function saveRole(
  tx: Tx,
  ctx: Context,
  input: RoleCreate,
): Promise<RoleDetails>;
export function saveRole(
  tx: Tx,
  ctx: Context,
  input: RoleEdit,
  id: string,
): Promise<RoleDetails>;
export async function saveRole(
  tx: Tx,
  ctx: Context,
  input: RoleCreate | RoleEdit,
  id?: string,
) {
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "roles.manage",
  );
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
        .where("retired_at", "is", null)
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
    requireCondition(
      "revision" in input &&
        input.revision === roleSnapshot(ctx.workspaceId, role).revision,
      409,
      "ROLE_CHANGED",
      "This role changed. Reload its current permissions before saving.",
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
  return roleSnapshot(
    ctx.workspaceId,
    found(
      await tx
        .selectFrom("suite.roles")
        .where("retired_at", "is", null)
        .select(["id", "name", "permissions", "protected"])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "=", id)
        .executeTakeFirst(),
    ),
  );
}

/** Retire an unassigned leaf while retaining historical identity and atomic receipts. */
export async function removeRole(
  tx: Tx,
  ctx: Context,
  id: string,
  input: RoleRemove,
) {
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "roles.manage",
  );
  id = id.toLowerCase();
  const role = found(
    await tx
      .selectFrom("suite.roles")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .where("retired_at", "is", null)
      .forUpdate()
      .executeTakeFirst(),
  );
  requireCondition(
    !role.protected,
    403,
    "PROTECTED_ROLE",
    "Protected platform roles cannot be removed.",
  );
  requireCondition(
    input.revision === roleSnapshot(ctx.workspaceId, role).revision,
    409,
    "ROLE_CHANGED",
    "This role changed. Reload it before reviewing removal.",
  );
  const stored = await tx
    .selectFrom("suite.platform_settings")
    .select(["value", "version"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("key", "=", "organization")
    .executeTakeFirst();
  requireCondition(
    input.organizationVersion === (stored?.version ?? 0),
    412,
    "VERSION_CONFLICT",
    "The organization changed. Reload it before reviewing removal.",
  );
  const policy = stored?.value as unknown as OrganizationPolicy | undefined;
  requireCondition(
    policy?.rootId !== id,
    403,
    "PROTECTED_ROLE",
    "The Administrador root cannot be removed.",
  );
  requireCondition(
    !policy?.ranks.some((rank) => rank.parents.includes(id)),
    409,
    "ROLE_HAS_CHILDREN",
    "Reassign this role's reporting relationships in Organization before removing it.",
  );
  const assigned = await tx
    .selectFrom("suite.role_assignments")
    .select("membership_id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("role_id", "=", id)
    .limit(1)
    .executeTakeFirst();
  requireCondition(
    !assigned,
    409,
    "ROLE_ASSIGNED",
    "Reassign this role's members in People before removing it, including inactive members.",
  );
  const pending = await tx
    .selectFrom("suite.invitations")
    .select("id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("role_id", "=", id)
    .where("state", "=", "pending")
    .where("expires_at", ">", new Date())
    .limit(1)
    .executeTakeFirst();
  requireCondition(
    !pending,
    409,
    "ROLE_INVITED",
    "Revoke pending invitations for this role in People before removing it.",
  );
  if (policy && stored) {
    const assignments = [...policy.groups, ...(policy.tags ?? [])];
    requireCondition(
      !assignments.some(
        (item) => item.rankIds.includes(id) && item.modules?.length,
      ) || ctx.permissions.includes("modules.manage"),
      403,
      "MODULE_POLICY_FORBIDDEN",
      "Manage modules permission is required to remove a role from module assignment policies.",
    );
    const next: OrganizationPolicy = {
      ...policy,
      ranks: policy.ranks.filter((rank) => rank.id !== id),
      groups: policy.groups.map((group) => ({
        ...group,
        rankIds: group.rankIds.filter((roleId) => roleId !== id),
      })),
      ...(policy.tags
        ? {
            tags: policy.tags.map((tag) => ({
              ...tag,
              rankIds: tag.rankIds.filter((roleId) => roleId !== id),
            })),
          }
        : {}),
    };
    validateOrganization(next);
    await tx
      .updateTable("suite.platform_settings")
      .set({ value: next, version: stored.version + 1 })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("key", "=", "organization")
      .execute();
  }
  // No member or descendant can derive module access from this role. Other grants remain untouched.
  await tx
    .updateTable("suite.roles")
    .set({ retired_at: new Date() })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
  await audit(tx, ctx, "roles.removed", id);
  await publish(tx, ctx, "roles.removed", { roleId: id, name: role.name });
  return { ok: true };
}
