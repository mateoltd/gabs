import { randomUUID } from "node:crypto";
import type { InvitationPage, InvitationQuery } from "@suite/contracts";
import { sql } from "kysely";
import type { Tx } from "../persistence/database";
import {
  type Context,
  authorize,
  lockWorkspace,
} from "../identity/authorization";
import { audit, publish, iso } from "../persistence/transactions";
import { found, requireCondition } from "../errors";
import { modulePolicyIntents } from "./module-policy";
import { reconcileModulePolicies } from "./module-assignments";

/** Requires a freshly authorized context while the caller holds the workspace lock. */
export async function requireInvitationRoleAuthority(
  tx: Tx,
  ctx: Context,
  roleId: string,
) {
  const role = found(
    await tx
      .selectFrom("suite.roles")
      .where("retired_at", "is", null)
      .select("name")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", roleId)
      .executeTakeFirst(),
  );
  requireCondition(
    role.name !== "Owner" || ctx.roleNames.includes("Owner"),
    403,
    "OWNER_REQUIRED",
    "Only an owner can invite another owner.",
  );
}

export async function createInvitation(
  tx: Tx,
  ctx: Context,
  input: { email: string; roleId: string },
) {
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "members.manage",
  );
  await requireInvitationRoleAuthority(tx, ctx, input.roleId);
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
  if (invitation.state === "declined" && !accept) return { ok: true };
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
      .where("retired_at", "is", null)
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
export async function revokeInvitation(tx: Tx, ctx: Context, id: string) {
  // Acceptance, decline and administrator revocation share one serialization boundary.
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "members.manage",
  );
  const invitation = found(
    await tx
      .selectFrom("suite.invitations")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst(),
  );
  const role = found(
    await tx
      .selectFrom("suite.roles")
      .select("name")
      .where("workspace_id", "=", ctx.workspaceId)
      .where("id", "=", invitation.role_id)
      .executeTakeFirst(),
  );
  requireCondition(
    role.name !== "Owner" || ctx.roleNames.includes("Owner"),
    403,
    "OWNER_REQUIRED",
    "Only owners can manage ownership invitations.",
  );
  if (invitation.state === "revoked") return { ok: true };
  requireCondition(
    invitation.state === "pending",
    409,
    "INVITATION_RESOLVED",
    "This invitation is no longer pending.",
  );
  await tx
    .updateTable("suite.invitations")
    .set({ state: "revoked" })
    .where("id", "=", id)
    .where("workspace_id", "=", ctx.workspaceId)
    .execute();
  await audit(tx, ctx, "invitations.revoked", id);
  return { ok: true };
}

/** One authorized snapshot supplies a bounded page and workspace-wide summary. */
export async function listInvitations(
  tx: Tx,
  ctx: Context,
  query: InvitationQuery,
): Promise<InvitationPage> {
  await lockWorkspace(tx, ctx.workspaceId);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "members.manage",
  );
  const now = new Date();
  const limit = query.limit ?? 20;
  const scope = tx
    .selectFrom("suite.invitations")
    .where("workspace_id", "=", ctx.workspaceId);
  const summary = await scope
    .select((eb) => [
      eb.fn.countAll<string>().as("total"),
      sql<string>`count(*) filter (where state = 'pending' and expires_at > ${now})`.as(
        "pending",
      ),
    ])
    .executeTakeFirstOrThrow();
  let matching = scope;
  const search = query.search?.trim();
  if (search)
    matching = matching.where(
      "email",
      "ilike",
      `%${search.replace(/[\\%_]/g, "\\$&")}%`,
    );
  const count = search
    ? await matching
        .select((eb) => eb.fn.countAll<string>().as("total"))
        .executeTakeFirstOrThrow()
    : summary;
  if (query.cursor) {
    const anchor = await scope
      .select("id")
      .where("id", "=", query.cursor)
      .executeTakeFirst();
    requireCondition(
      anchor,
      400,
      "INVALID_CURSOR",
      "This invitation page is no longer available. Return to the first page.",
    );
    // Compare in PostgreSQL to preserve timestamp microseconds and tie ordering.
    matching = matching.where(sql<boolean>`(created_at, id) < (
      select created_at, id from suite.invitations
      where workspace_id = ${ctx.workspaceId} and id = ${query.cursor}
    )`);
  }
  const rows = await matching
    .selectAll()
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1)
    .execute();
  // Historical role identities remain readable after retirement, never assignable.
  const roleIds = [...new Set(rows.slice(0, limit).map((row) => row.role_id))];
  const roles = roleIds.length
    ? await tx
        .selectFrom("suite.roles")
        .select(["id", "name"])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "in", roleIds)
        .execute()
    : [];
  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      email: row.email,
      roleId: row.role_id,
      roleName: roleNames.get(row.role_id),
      state:
        row.state === "pending" && new Date(row.expires_at) <= now
          ? "expired"
          : row.state,
      expiresAt: iso(row.expires_at),
    })),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    total: Number(count.total),
    workspaceTotal: Number(summary.total),
    pendingTotal: Number(summary.pending),
  };
}
