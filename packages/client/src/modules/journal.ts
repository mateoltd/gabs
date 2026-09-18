import type { ModuleCall, TSchema } from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import {
  referenceValues,
  type ReferenceOption,
  type ReferenceTarget,
} from "@suite/module-sdk/references";
import type { Scope } from "../index";

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
    const target = (entry.call.input as { id?: unknown } | undefined)?.id;
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
  if (!["create", "update"].includes(call.action)) return [];
  const input = call.input as { data?: unknown };
  const references = referenceValues(schema, input.data);
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
