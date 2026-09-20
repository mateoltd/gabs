import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import type { CreateRecovery } from "@suite/module-sdk/sync";

/** File observations for the correction form, never instructions to rewrite input. */
export function importedReferenceHints(
  input: SavedWorkRecovery,
): CreateRecovery[] {
  if (input.selection !== "request") return [];
  const entry = input.entry;
  const original = entry.call.input as { id?: unknown } | null;
  const hints = [
    ...(entry.createRecovery ?? []),
    ...(input.review?.createRecovery ?? []),
  ];
  const seen = new Set<string>();
  return hints.filter((hint) => {
    // The explicit record-target selector already handles this observation.
    if (
      entry.recordRecovery &&
      entry.call.action !== "operation" &&
      hint.moduleId === input.moduleId &&
      hint.resource === entry.call.resource &&
      hint.originalId === original?.id &&
      hint.replacementId === entry.recordRecovery.targetId
    )
      return false;
    const key = JSON.stringify([
      hint.moduleId,
      hint.resource,
      hint.originalId,
      hint.replacementId,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Conflicting snapshots must remain separate until the user resolves their provenance. */
export function checkImportedReferenceHints(hints: readonly CreateRecovery[]) {
  const destinations = new Map<string, string>();
  for (const hint of hints) {
    const key = JSON.stringify([hint.moduleId, hint.resource, hint.originalId]);
    const prior = destinations.get(key);
    if (prior !== undefined && prior !== hint.replacementId)
      throw Error(
        "This copy contains conflicting reference hints. Retain both snapshots and review their original input separately.",
      );
    destinations.set(key, hint.replacementId);
  }
}
