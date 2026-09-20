import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import { effectiveModulePolicies } from "@suite/module-sdk/governance";
import type { Tx } from "../persistence/database";
import { lockWorkspace } from "../identity/authorization";
import { AppError, requireCondition, found } from "../errors";
import {
  currentPolicyModules,
  organizationPolicy,
  modulePolicyIntents,
  type ModulePolicyIntents,
} from "./module-policy";
export {
  organizationPolicy,
  modulePolicyIntents,
  type ModulePolicyIntents,
} from "./module-policy";
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
  previous?: ModulePolicyIntents,
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
  const unresolved = new Map<string, AppError>();
  for (const root of roots) {
    let ids: string[];
    try {
      ids = await expand(tx, workspaceId, [root], catalog);
    } catch (error) {
      // Entitlement reconciliation must finish even when an old release is unavailable.
      if (error instanceof AppError && [400, 404, 409].includes(error.status)) {
        if (mode === "strict") unresolved.set(root, error);
        continue;
      }
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
  const requests = active
    .flatMap((member, order) => {
      const existing = new Set(
        assignments
          .filter((a) => a.membership_id === member.id)
          .map((a) => a.module_id),
      );
      return Object.keys(
        effectiveModulePolicies(
          roles
            .filter((r) => r.membership_id === member.id)
            .map((r) => r.role_id),
          policy,
        ),
      )
        .sort()
        .map((root) => {
          const ids = expanded.get(root) ?? [];
          return {
            memberId: member.id,
            root,
            ids,
            order,
            retained: ids.length > 0 && ids.every((id) => existing.has(id)),
          };
        });
    })
    .sort(
      (a, b) =>
        Number(b.retained) - Number(a.retained) ||
        a.order - b.order ||
        a.root.localeCompare(b.root),
    );
  if (mode === "strict") {
    for (const [root, error] of unresolved) {
      const accepted =
        previous?.roots.has(root) &&
        requests
          .filter((request) => request.root === root)
          .every((request) =>
            previous?.byMember.get(request.memberId)?.has(root),
          );
      // An unavailable release cannot invalidate already-authorized intent during
      // an unrelated edit. Newly declared or newly inherited intent still fails.
      if (!accepted) throw error;
    }
  }
  for (const request of requests) {
    const direct = new Set(
      assignments
        .filter((a) => a.membership_id === request.memberId && a.direct)
        .map((a) => a.module_id),
    );
    const derived = desired.get(request.memberId) ?? new Set<string>();
    const added = request.ids.filter(
      (id) => !direct.has(id) && !derived.has(id),
    );
    const full = added.find((id) => {
      const limit = modules.find((m) => m.module_id === id)?.seat_limit;
      return limit != null && (counts.get(id) ?? 0) >= limit;
    });
    if (full) {
      requireCondition(
        mode === "available" ||
          previous?.byMember.get(request.memberId)?.has(request.root),
        409,
        "NO_MODULE_SEATS",
        `No ${full} seats are available for this policy assignment.`,
      );
      continue;
    }
    for (const id of added) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const id of request.ids) derived.add(id);
    desired.set(request.memberId, derived);
  }
  // Diff rather than rebuilding unchanged rows: policy revisions describe actual changes.
  let removed = 0;
  for (const row of assignments.filter((a) => !a.direct)) {
    if (desired.get(row.membership_id)?.has(row.module_id)) continue;
    removed++;
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
  for (let offset = 0; offset < additions.length; offset += 500)
    await tx
      .insertInto("suite.module_assignments")
      .values(additions.slice(offset, offset + 500))
      .execute();
  return { added: additions.length, removed };
}

/** Replace explicit member grants; group/tag contributions remain independent. */
export async function assignModules(
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleIds: string[],
  catalog: ModuleCatalog,
  previous?: ModulePolicyIntents,
) {
  await lockWorkspace(tx, workspaceId);
  previous ??= await modulePolicyIntents(tx, workspaceId);
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
  const occupied = ids.length
    ? await tx
        .selectFrom("suite.module_assignments as a")
        .innerJoin("suite.memberships as m", (j) =>
          j
            .onRef("a.workspace_id", "=", "m.workspace_id")
            .onRef("a.membership_id", "=", "m.id"),
        )
        .select(["a.membership_id", "a.module_id", "a.direct"])
        .where("a.workspace_id", "=", workspaceId)
        .where("a.module_id", "in", ids)
        .where("a.membership_id", "!=", membershipId)
        .where("m.active", "=", true)
        .execute()
    : [];
  const policyModules = new Map<string, Promise<Set<string>>>();
  const inherited = (memberId: string) => {
    let pending = policyModules.get(memberId);
    if (!pending) {
      pending = currentPolicyModules(tx, workspaceId, memberId, catalog).then(
        (current) => new Set(current),
      );
      policyModules.set(memberId, pending);
    }
    return pending;
  };
  for (const id of ids) {
    const module = modules.find((m) => m.module_id === id);
    requireCondition(
      module?.active && module.state === "enabled",
      409,
      "MODULE_UNAVAILABLE",
      "Only entitled, enabled modules can be assigned.",
    );
    if (module.seat_limit !== null) {
      const holders = occupied.filter((row) => row.module_id === id);
      const used = (
        await Promise.all(
          holders.map(
            async (row) =>
              row.direct || (await inherited(row.membership_id)).has(id),
          ),
        )
      ).filter(Boolean).length;
      requireCondition(
        used < module.seat_limit,
        409,
        "NO_MODULE_SEATS",
        `No ${id} seats are available.`,
      );
    }
  }
  await tx
    .updateTable("suite.module_assignments")
    .set({ direct: false })
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
      .onConflict((oc) =>
        oc
          .columns(["workspace_id", "membership_id", "module_id"])
          .doUpdateSet({ direct: true }),
      )
      .execute();
  await reconcileModulePolicies(
    tx,
    workspaceId,
    catalog,
    member.active ? "strict" : "available",
    previous,
  );
}
