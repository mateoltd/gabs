import { createHash } from "node:crypto";
import { sql } from "kysely";
import type {
  Member,
  MemberEdit,
  MemberPage,
  MemberQuery,
} from "@suite/contracts";
import { found, requireCondition } from "../errors";
import {
  authorize,
  type Context,
  lockWorkspace,
} from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { audit } from "../persistence/transactions";
import { assignModules } from "./module-assignments";
import {
  modulePolicyIntents,
  organizationPolicy,
  policyModuleSourceResolver,
} from "./module-policy";

interface EditableMemberAccess {
  id: string;
  userId: string;
  active: boolean;
  roleIds: readonly string[];
  directModules: readonly string[];
}

/** A precondition over editable access, including changes made outside the editor. */
function memberRevision(workspaceId: string, member: EditableMemberAccess) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "member-access-v1",
        workspaceId,
        member.id,
        member.userId,
        member.active,
        [...member.roleIds].sort(),
        [...member.directModules].sort(),
      ]),
    )
    .digest("hex");
}

async function authorizeMemberRead(tx: Tx, ctx: Context) {
  await lockWorkspace(tx, ctx.workspaceId);
  return authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    "members.manage",
  );
}
function memberScope(tx: Tx, workspaceId: string) {
  return tx
    .selectFrom("suite.memberships as m")
    .innerJoin("suite.users as u", "m.user_id", "u.id")
    .where("m.workspace_id", "=", workspaceId);
}
const memberColumns = [
  "m.id",
  "m.user_id",
  "m.active",
  "u.name",
  "u.email",
] as const;

export async function listMembers(
  tx: Tx,
  ctx: Context,
  query: MemberQuery,
): Promise<MemberPage> {
  ctx = await authorizeMemberRead(tx, ctx);
  const scope = memberScope(tx, ctx.workspaceId);
  const summary = await scope
    .select((eb) => [
      eb.fn.countAll<string>().as("total"),
      sql<string>`count(*) filter (where m.active)`.as("active"),
    ])
    .executeTakeFirstOrThrow();
  const counts = await tx
    .selectFrom("suite.role_assignments as a")
    .innerJoin("suite.memberships as m", (join) =>
      join
        .onRef("m.id", "=", "a.membership_id")
        .onRef("m.workspace_id", "=", "a.workspace_id"),
    )
    .select((eb) => ["a.role_id", eb.fn.countAll<string>().as("count")])
    .where("a.workspace_id", "=", ctx.workspaceId)
    .where("m.active", "=", true)
    .groupBy("a.role_id")
    .execute();
  let matching = scope;
  const search = query.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    matching = matching.where((eb) =>
      eb.or([
        eb("u.name", "ilike", pattern),
        eb("u.email", "ilike", pattern),
        eb.exists(
          eb
            .selectFrom("suite.role_assignments as a")
            .innerJoin("suite.roles as r", (join) =>
              join
                .onRef("r.id", "=", "a.role_id")
                .onRef("r.workspace_id", "=", "a.workspace_id"),
            )
            .select("a.membership_id")
            .whereRef("a.membership_id", "=", "m.id")
            .whereRef("a.workspace_id", "=", "m.workspace_id")
            .where("r.name", "ilike", pattern),
        ),
      ]),
    );
  }
  const total = search
    ? (
        await matching
          .select((eb) => eb.fn.countAll<string>().as("total"))
          .executeTakeFirstOrThrow()
      ).total
    : summary.total;
  if (query.cursor) {
    const anchor = await scope
      .select("m.id")
      .where("m.id", "=", query.cursor)
      .executeTakeFirst();
    requireCondition(
      anchor,
      400,
      "INVALID_CURSOR",
      "This member page is no longer available. Return to the first page.",
    );
    matching = matching.where(
      sql<boolean>`(u.name, m.id) > (select u.name, m.id from suite.memberships m join suite.users u on u.id=m.user_id where m.workspace_id=${ctx.workspaceId} and m.id=${query.cursor})`,
    );
  }
  const limit = query.limit ?? 20;
  const rows = await matching
    .select(memberColumns)
    .orderBy("u.name")
    .orderBy("m.id")
    .limit(limit + 1)
    .execute();
  return {
    items: await memberDetails(tx, ctx, rows.slice(0, limit)),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    total: Number(total),
    workspaceTotal: Number(summary.total),
    activeTotal: Number(summary.active),
    roleCounts: Object.fromEntries(
      counts.map((row) => [row.role_id, Number(row.count)]),
    ),
  };
}
export async function getMember(
  tx: Tx,
  ctx: Context,
  id: string,
): Promise<Member> {
  ctx = await authorizeMemberRead(tx, ctx);
  const member = found(
    await memberScope(tx, ctx.workspaceId)
      .select(memberColumns)
      .where("m.id", "=", id)
      .executeTakeFirst(),
  );
  return (await memberDetails(tx, ctx, [member]))[0];
}
async function memberDetails(
  tx: Tx,
  ctx: Context,
  members: {
    id: string;
    user_id: string;
    active: boolean;
    name: string;
    email: string;
  }[],
): Promise<Member[]> {
  if (!members.length) return [];
  const ids = members.map((member) => member.id);
  const assignments = await tx
    .selectFrom("suite.role_assignments as a")
    .innerJoin("suite.roles as r", (join) =>
      join
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
    .where("a.membership_id", "in", ids)
    .execute();
  const modules = await tx
    .selectFrom("suite.module_assignments")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "in", ids)
    .execute();
  const policy = await organizationPolicy(tx, ctx.workspaceId);
  const resolvePolicySources = policyModuleSourceResolver(
    tx,
    ctx.workspaceId,
    ctx.runtime.catalog,
    policy,
  );
  return Promise.all(
    members.map(async (member) => {
      const roles = assignments.filter(
        (assignment) => assignment.membership_id === member.id,
      );
      const policySources = await resolvePolicySources(
        roles.map((role) => role.id),
      );
      const assigned = modules.filter(
        (assignment) =>
          assignment.membership_id === member.id &&
          (assignment.direct ||
            Object.hasOwn(policySources, assignment.module_id)),
      );
      const directModules = assigned
        .filter((assignment) => assignment.direct)
        .map((assignment) => assignment.module_id);
      return {
        id: member.id,
        revision: memberRevision(ctx.workspaceId, {
          id: member.id,
          userId: member.user_id,
          active: member.active,
          roleIds: roles.map((role) => role.id),
          directModules,
        }),
        userId: member.user_id,
        name: member.name,
        email: member.email,
        active: member.active,
        roles: roles.map(
          ({ id, name, permissions, protected: protectedRole }) => ({
            id,
            name,
            permissions,
            protected: protectedRole,
          }),
        ),
        modules: assigned.map((assignment) => assignment.module_id),
        modulePolicies: Object.entries(policySources).map(
          ([moduleId, sources]) => ({
            moduleId,
            sources,
            assigned:
              member.active &&
              assigned.some((assignment) => assignment.module_id === moduleId),
          }),
        ),
        directModules,
      };
    }),
  );
}

export async function editMember(
  tx: Tx,
  ctx: Context,
  id: string,
  input: MemberEdit,
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
  const previousModuleIntents = await modulePolicyIntents(tx, ctx.workspaceId);
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
    .innerJoin("suite.roles as r", (join) =>
      join
        .onRef("a.role_id", "=", "r.id")
        .onRef("a.workspace_id", "=", "r.workspace_id"),
    )
    .select(["r.id", "r.name"])
    .where("a.membership_id", "=", id)
    .where("a.workspace_id", "=", ctx.workspaceId)
    .execute();
  const directBefore = await tx
    .selectFrom("suite.module_assignments")
    .select("module_id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "=", id)
    .where("direct", "=", true)
    .execute();
  requireCondition(
    input.revision ===
      memberRevision(ctx.workspaceId, {
        id: member.id,
        userId: member.user_id,
        active: member.active,
        roleIds: current.map((role) => role.id),
        directModules: directBefore.map((assignment) => assignment.module_id),
      }),
    409,
    "MEMBER_CHANGED",
    "This member's access changed. Reload current access before saving new changes.",
  );
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
  const wasOwner = current.some((role) => role.name === "Owner");
  const willOwn = roles.some((role) => role.name === "Owner");
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
      .innerJoin("suite.roles as r", (join) =>
        join
          .onRef("a.role_id", "=", "r.id")
          .onRef("a.workspace_id", "=", "r.workspace_id"),
      )
      .innerJoin("suite.memberships as m", (join) =>
        join
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
    const workspace = await tx
      .selectFrom("suite.workspaces")
      .select("seat_limit")
      .where("id", "=", ctx.workspaceId)
      .executeTakeFirstOrThrow();
    const count = await tx
      .selectFrom("suite.memberships")
      .select((expression) => expression.fn.countAll<number>().as("n"))
      .where("workspace_id", "=", ctx.workspaceId)
      .where("active", "=", true)
      .executeTakeFirstOrThrow();
    requireCondition(
      Number(count.n) < workspace.seat_limit,
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
        roles.map((role) => ({
          workspace_id: ctx.workspaceId,
          membership_id: id,
          role_id: role.id,
        })),
      )
      .execute();
  const derived = await tx
    .selectFrom("suite.module_assignments")
    .select("module_id")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("membership_id", "=", id)
    .where("direct", "=", false)
    .execute();
  // Legacy editors echo effective access. Do not convert policy access into a direct grant.
  const direct =
    input.directModules ??
    input.modules.filter(
      (moduleId) =>
        !derived.some((assignment) => assignment.module_id === moduleId),
    );
  await assignModules(
    tx,
    ctx.workspaceId,
    id,
    input.active ? direct : [],
    ctx.runtime.catalog,
    previousModuleIntents,
  );
  await audit(
    tx,
    ctx,
    input.active ? "members.updated" : "members.removed",
    id,
  );
  return { ok: true };
}
