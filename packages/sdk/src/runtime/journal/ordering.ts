import type { ModuleCall, TSchema } from "../../index";
import type { JournalEntry } from "../../contracts/sync";
import {
  referenceValues,
  type ReferenceOption,
  type ReferenceTarget,
} from "../../contracts/references";
type Scope = Pick<JournalEntry, "userId" | "workspaceId">;

/** Local review intent does not rewrite the retained original request. */
export function journalRecordId(entry: JournalEntry): unknown {
  return (
    entry.recordRecovery?.targetId ??
    (entry.call.input as { id?: unknown } | undefined)?.id
  );
}

export class JournalConflictError extends Error {
  readonly status = 409;
  readonly code = "JOURNAL_CONFLICT";
}

/** Serialize new resource writes to one record without changing their original input. */
export function recordDependencies(
  call: ModuleCall,
  journal: readonly JournalEntry[],
  scope: Scope,
): string[] {
  const id = (call.input as { id?: unknown } | undefined)?.id;
  if (
    !call.resource ||
    !["create", "update", "archive"].includes(call.action) ||
    typeof id !== "string" ||
    !id
  )
    return [];
  const predecessors = journal.filter((entry) => {
    const target = journalRecordId(entry);
    return (
      entry.userId === scope.userId &&
      entry.workspaceId === scope.workspaceId &&
      entry.id !== call.key &&
      !entry.supersededBy &&
      entry.state !== "accepted" &&
      entry.call.moduleId === call.moduleId &&
      entry.call.resource === call.resource &&
      ["create", "update", "archive"].includes(entry.call.action) &&
      typeof target === "string" &&
      target.toLowerCase() === id.toLowerCase()
    );
  });
  const waiting = new Set(predecessors.map((entry) => entry.id));
  for (const entry of predecessors)
    for (const prerequisite of entry.dependencies) waiting.delete(prerequisite);
  return [...waiting];
}

export function assertJournalOrder(
  journal: readonly JournalEntry[],
  scope: Scope,
) {
  const active = journal.filter(
    (entry) =>
      entry.userId === scope.userId &&
      entry.workspaceId === scope.workspaceId &&
      !entry.supersededBy &&
      entry.state !== "accepted",
  );
  const known = new Set(active.map((entry) => entry.id));
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const entry of active) {
    const dependencies = [
      ...new Set(entry.dependencies.filter((id) => known.has(id))),
    ];
    remaining.set(entry.id, dependencies.length);
    for (const id of dependencies)
      dependents.set(id, [...(dependents.get(id) ?? []), entry.id]);
  }
  const ready = active
    .filter((entry) => !remaining.get(entry.id))
    .map((entry) => entry.id);
  for (let i = 0; i < ready.length; i++)
    for (const id of dependents.get(ready[i]) ?? []) {
      const count = remaining.get(id)! - 1;
      remaining.set(id, count);
      if (!count) ready.push(id);
    }
  if (ready.length !== active.length)
    throw new JournalConflictError(
      "These changes depend on each other. Remove the circular reference before saving; your draft is preserved.",
    );
}

/** Provisional records stay separate from server pages and never claim a server version. */
export function pendingReferenceOptions(
  journal: readonly JournalEntry[],
  scope: Scope,
  target: ReferenceTarget,
): ReferenceOption[] {
  if (target.kind !== "resource") return [];
  return pendingCreates(journal, scope)
    .filter(
      ({ entry }) =>
        entry.call.moduleId === target.moduleId &&
        entry.call.resource === target.resource,
    )
    .map(({ entry, id, data }) => ({
      value: id,
      label: `${[data.name, data.title].find((value) => typeof value === "string" && value.length) ?? id} (${entry.state === "pending" ? "pending" : "needs review"})`,
    }));
}

function pendingCreates(journal: readonly JournalEntry[], scope: Scope) {
  return journal.flatMap((entry) => {
    if (
      entry.userId !== scope.userId ||
      entry.workspaceId !== scope.workspaceId ||
      entry.state === "accepted" ||
      entry.supersededBy ||
      entry.call.action !== "create"
    )
      return [];
    const input = entry.call.input as
      { id?: unknown; data?: unknown } | undefined;
    if (
      !input ||
      typeof input.id !== "string" ||
      !input.data ||
      typeof input.data !== "object" ||
      Array.isArray(input.data)
    )
      return [];
    return [
      { entry, id: input.id, data: input.data as Record<string, unknown> },
    ];
  });
}

/** Derive ordering from declared references, including nested arrays/maps, inside the durable write. */
export function referenceDependencies(
  schema: TSchema,
  call: ModuleCall,
  journal: readonly JournalEntry[],
  scope: Scope,
): string[] {
  if (!["create", "update", "operation"].includes(call.action)) return [];
  const input = call.input as { data?: unknown };
  const references = referenceValues(
    schema,
    call.action === "operation" ? call.input : input.data,
  );
  return pendingCreates(journal, scope)
    .filter(
      ({ entry, id }) =>
        entry.id !== call.key &&
        references.some(
          ({ target, value }) =>
            target.kind === "resource" &&
            target.moduleId === entry.call.moduleId &&
            target.resource === entry.call.resource &&
            value.toLowerCase() === id.toLowerCase(),
        ),
    )
    .map(({ entry }) => entry.id);
}

/** Repair legacy scheduling without rewriting input or pretending earlier effects were ordered. */
export function recoverRecordOrder(
  journal: JournalEntry[],
  scope: Scope,
): boolean {
  const active = journal.filter(
    (entry) =>
      entry.userId === scope.userId &&
      entry.workspaceId === scope.workspaceId &&
      !entry.supersededBy &&
      entry.state !== "accepted",
  );
  const byId = new Map(active.map((entry) => [entry.id, entry]));
  const history = new Map(
    journal
      .filter(
        (entry) =>
          entry.userId === scope.userId &&
          entry.workspaceId === scope.workspaceId,
      )
      .map((entry) => [entry.id, entry]),
  );
  const groups = new Map<string, JournalEntry[]>();
  for (const entry of active) {
    const id = journalRecordId(entry);
    if (
      !entry.call.resource ||
      !["create", "update", "archive"].includes(entry.call.action) ||
      typeof id !== "string" ||
      !id
    )
      continue;
    const key = JSON.stringify([
      entry.call.moduleId,
      entry.call.resource,
      id.toLowerCase(),
    ]);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  // Respect existing dependencies even when a reviewed replacement is newer than its child.
  const ordered: JournalEntry[] = [];
  const visited = new Set<string>();
  const pending = [...active].sort((a, b) => a.createdAt - b.createdAt);
  while (true) {
    const index = pending.findIndex((entry) =>
      entry.dependencies.every((id) => !byId.has(id) || visited.has(id)),
    );
    if (index < 0) break;
    const [entry] = pending.splice(index, 1);
    ordered.push(entry);
    visited.add(entry.id);
  }
  const rank = new Map(ordered.map((entry, index) => [entry.id, index]));
  const dependsOn = (entry: JournalEntry, target: string) => {
    const seen = new Set<string>();
    const queue = [...entry.dependencies];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(history.get(id)?.dependencies ?? []));
    }
    return false;
  };
  let changed = false;
  const setRecovery = (
    entry: JournalEntry,
    value: JournalEntry["orderingRecovery"],
  ) => {
    if (entry.orderingRecovery === value) return;
    if (value) entry.orderingRecovery = value;
    else delete entry.orderingRecovery;
    changed = true;
  };
  for (const group of groups.values()) {
    // An existing cycle needs its own recovery; never guess a replacement graph.
    if (group.some((entry) => !rank.has(entry.id))) continue;
    group.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const gaps = group
      .slice(1)
      .filter((entry, index) => !dependsOn(entry, group[index].id));
    if (gaps.length) {
      for (const entry of group)
        if (entry.state === "pending" && entry.delivery !== "unsubmitted")
          setRecovery(entry, "outcome");
      for (let index = 1; index < group.length; index++) {
        const entry = group[index];
        if (!dependsOn(entry, group[index - 1].id)) {
          entry.dependencies.push(group[index - 1].id);
          changed = true;
        }
      }
    }
    // A later effect can already be accepted in an old journal. Recover its
    // predecessor's outcome instead of blindly executing it after that effect.
    for (const entry of group) {
      if (entry.state !== "pending" || entry.delivery === "unsubmitted")
        continue;
      const id = (journalRecordId(entry) as string).toLowerCase();
      if (
        [...history.values()].some(
          (later) =>
            later.state === "accepted" &&
            !later.supersededBy &&
            later.createdAt >= entry.createdAt &&
            later.call.moduleId === entry.call.moduleId &&
            later.call.resource === entry.call.resource &&
            ["create", "update", "archive"].includes(later.call.action) &&
            typeof journalRecordId(later) === "string" &&
            (journalRecordId(later) as string).toLowerCase() === id &&
            !dependsOn(later, entry.id),
        )
      )
        setRecovery(entry, "outcome");
    }
    const unknown = group.some(
      (entry) =>
        entry.state === "pending" && entry.orderingRecovery === "outcome",
    );
    for (const entry of group) {
      if (entry.state !== "pending") setRecovery(entry, undefined);
      else if (entry.delivery === "unsubmitted")
        setRecovery(entry, unknown ? "waiting" : undefined);
    }
  }
  return changed;
}
