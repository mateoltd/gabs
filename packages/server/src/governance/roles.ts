import { createHash, randomUUID } from "node:crypto";
import type { RoleCreate, RoleEdit, RoleDetails } from "@suite/contracts";
import { found, requireCondition } from "../errors";
import {
  authorize,
  lockWorkspace,
  type Context,
} from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { audit } from "../persistence/transactions";
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
        .select(["id", "name", "permissions", "protected"])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "=", id)
        .executeTakeFirst(),
    ),
  );
}
