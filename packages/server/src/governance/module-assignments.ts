import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import { effectiveModulePolicies } from "@suite/module-sdk/governance";
import type { Tx } from "../persistence/database";
import { lockWorkspace } from "../identity/authorization";
import { AppError, requireCondition, found } from "../errors";
import { organizationPolicy } from "./module-policy";
export { organizationPolicy } from "./module-policy";
import { workspaceDependencyIds } from "../registry/module-releases";

async function expand(
  tx: Tx,
  workspaceId: string,
  moduleIds: string[],
  catalog: ModuleCatalog,
) {
  return [
    ...new Set(
      (
        await Promise.all(
          moduleIds.map((id) =>
            workspaceDependencyIds(tx, workspaceId, id, catalog),
          ),
        )
      ).flat(),
    ),
  ];
}

async function availability(tx: Tx, workspaceId: string) {
  return tx
    .selectFrom("suite.module_activations as m")
    .innerJoin("suite.entitlements as e", (j) =>
      j
        .onRef("m.workspace_id", "=", "e.workspace_id")
        .onRef("m.module_id", "=", "e.module_id"),
    )
    .select(["m.module_id", "m.state", "e.active", "e.seat_limit"])
    .where("m.workspace_id", "=", workspaceId)
    .execute();
}

/** Rebuild derived access atomically; callers retain the transaction for audit. */
export async function reconcileModulePolicies(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  mode: "strict" | "available" = "strict",
) {
  await lockWorkspace(tx, workspaceId);
  const policy = await organizationPolicy(tx, workspaceId);
  const [members, roles, assignments, modules] = await Promise.all([
    tx
      .selectFrom("suite.memberships")
      .select(["id", "active"])
      .orderBy("created_at")
      .orderBy("id")
      .where("workspace_id", "=", workspaceId)
      .execute(),
    tx
      .selectFrom("suite.role_assignments")
      .select(["membership_id", "role_id"])
      .where("workspace_id", "=", workspaceId)
      .execute(),
    tx
      .selectFrom("suite.module_assignments")
      .select(["membership_id", "module_id", "direct"])
      .where("workspace_id", "=", workspaceId)
      .execute(),
    availability(tx, workspaceId),
  ]);
  const roots = [
    ...new Set(
      [...(policy?.groups ?? []), ...(policy?.tags ?? [])].flatMap(
        (item) => item.modules ?? [],
      ),
    ),
  ];
  const expanded = new Map<string, string[]>();
  for (const root of roots) {
    let ids: string[];
    try {
      ids = await expand(tx, workspaceId, [root], catalog);
    } catch (error) {
      // Entitlement reconciliation must finish even when an old release is unavailable.
      if (
        mode === "available" &&
        error instanceof AppError &&
        [400, 404, 409].includes(error.status)
      )
        continue;
      throw error;
    }
    const unavailable = ids.find(
      (id) =>
        !modules.some(
          (m) => m.module_id === id && m.active && m.state === "enabled",
        ),
    );
    // Policy can precede publication or survive suspension. It never supplies
    // runtime access until the complete dependency set is entitled and enabled.
    if (unavailable) continue;
    expanded.set(root, ids);
  }
  const desired = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  const active = members.filter((m) => m.active);
  for (const row of assignments.filter(
    (a) => a.direct && active.some((m) => m.id === a.membership_id),
  ))
    counts.set(row.module_id, (counts.get(row.module_id) ?? 0) + 1);
  for (const member of active) {
    const direct = new Set(
      assignments
        .filter((a) => a.membership_id === member.id && a.direct)
        .map((a) => a.module_id),
    );
    const selected = Object.keys(
      effectiveModulePolicies(
        roles
          .filter((r) => r.membership_id === member.id)
          .map((r) => r.role_id),
        policy,
      ),
    ).sort();
    const derived = new Set<string>();
    for (const root of selected) {
      const ids = expanded.get(root) ?? [];
      const added = ids.filter((id) => !direct.has(id) && !derived.has(id));
      if (
        mode === "available" &&
        added.some((id) => {
          const limit = modules.find((m) => m.module_id === id)?.seat_limit;
          return limit != null && (counts.get(id) ?? 0) >= limit;
        })
      )
        continue;
      for (const id of added) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const id of ids) derived.add(id);
    }
    desired.set(member.id, derived);
  }
  for (const module of modules) {
    requireCondition(
      module.seat_limit === null ||
        (counts.get(module.module_id) ?? 0) <= module.seat_limit,
      409,
      "NO_MODULE_SEATS",
      `The assignment needs ${counts.get(module.module_id) ?? 0} ${module.module_id} seats; ${module.seat_limit} are available.`,
    );
  }
  // Diff rather than rebuilding unchanged rows: policy revisions describe actual changes.
  for (const row of assignments.filter((a) => !a.direct)) {
    if (desired.get(row.membership_id)?.has(row.module_id)) continue;
    await tx
      .deleteFrom("suite.module_assignments")
      .where("workspace_id", "=", workspaceId)
      .where("membership_id", "=", row.membership_id)
      .where("module_id", "=", row.module_id)
      .where("direct", "=", false)
      .execute();
  }
  const existing = new Set(
    assignments.map((a) => `${a.membership_id}:${a.module_id}`),
  );
  const additions = [...desired].flatMap(([membershipId, ids]) =>
    [...ids]
      .filter((id) => !existing.has(`${membershipId}:${id}`))
      .map((moduleId) => ({
        workspace_id: workspaceId,
        membership_id: membershipId,
        module_id: moduleId,
        direct: false,
      })),
  );
  if (additions.length)
    await tx.insertInto("suite.module_assignments").values(additions).execute();
}

/** Replace explicit member grants; group/tag contributions remain independent. */
export async function assignModules(
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleIds: string[],
  catalog: ModuleCatalog,
) {
  await lockWorkspace(tx, workspaceId);
  const member = found(
    await tx
      .selectFrom("suite.memberships")
      .select("active")
      .where("workspace_id", "=", workspaceId)
      .where("id", "=", membershipId)
      .executeTakeFirst(),
  );
  requireCondition(
    member.active || moduleIds.length === 0,
    409,
    "MEMBER_INACTIVE",
    "Inactive members cannot receive module assignments.",
  );
  const ids = await expand(tx, workspaceId, moduleIds, catalog);
  const modules = await availability(tx, workspaceId);
  for (const id of ids) {
    const module = modules.find((m) => m.module_id === id);
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
        ids.map((moduleId) => ({
          workspace_id: workspaceId,
          membership_id: membershipId,
          module_id: moduleId,
          direct: true,
        })),
      )
      .execute();
  await reconcileModulePolicies(
    tx,
    workspaceId,
    catalog,
    member.active ? "strict" : "available",
  );
}
