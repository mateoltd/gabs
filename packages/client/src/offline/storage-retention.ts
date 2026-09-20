/** Shared by IndexedDB and the protected SQLite utility process. */
export class StorageRetentionError extends Error {}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StorageRetentionError(
      "Saved work is unreadable. Recover it before removing offline storage.",
    );
  return value as Record<string, unknown>;
};
const entries = (value: unknown) =>
  value === undefined ? [] : Object.keys(object(value));
const array = (value: unknown): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new StorageRetentionError(
      "Saved work is unreadable. Recover it before removing offline storage.",
    );
  return value;
};
const pending = () => {
  throw new StorageRetentionError(
    "Resolve pending changes and saved drafts before disabling offline storage.",
  );
};

export function assertWorkspacePurgeable(values: {
  drafts?: unknown;
  pending?: unknown;
  modules?: unknown;
  inbox?: unknown;
}) {
  if (array(values.drafts).length || array(values.pending).length) pending();
  if (array(values.inbox).length)
    throw new StorageRetentionError(
      "Review incoming local-network receipts before disabling offline storage.",
    );
  if (values.modules === undefined) return;
  const state = object(values.modules);
  if (
    ["drafts", "draftReviews", "commandReviews", "recoveryImports"].some(
      (key) => entries(state[key]).length,
    )
  )
    pending();
  const journal = array(state.journal).map(object);
  for (const entry of journal) {
    let current = entry;
    const seen = new Set<unknown>();
    while (current.state !== "accepted") {
      if (seen.has(current.id) || typeof current.supersededBy !== "string")
        pending();
      seen.add(current.id);
      const replacement = journal.find(
        (item) => item.id === current.supersededBy,
      );
      if (!replacement) pending();
      current = replacement!;
    }
  }
  if (entries(state.lifecycle).length)
    throw new StorageRetentionError(
      "Finish pending module installations before disabling offline storage.",
    );
}

export function disabledWorkspaceAuthority() {
  return {
    generation: crypto.randomUUID(),
    denied: true,
    storageDisabled: true,
  };
}

/** Module packages and online retry identities still need durable storage. */
export function assertWorkspaceCacheWrite(
  authority: unknown,
  kind: string,
  value: unknown,
) {
  if (authority === undefined || object(authority).storageDisabled !== true)
    return;
  let businessCache =
    kind === "snapshot" || (kind === "drafts" && array(value).length > 0);
  if (kind === "module-state") {
    const state = object(value);
    businessCache =
      array(state.journal).length > 0 ||
      [
        "drafts",
        "draftReviews",
        "draftTargets",
        "commandReviews",
        "pages",
        "pageMetadata",
        "offlineLists",
        "referenceOptions",
        "referenceMetadata",
      ].some((key) => entries(state[key]).length > 0);
  }
  if (businessCache)
    throw new StorageRetentionError(
      "Offline storage was disabled on this device. Enable it again before saving downloaded records or offline work.",
    );
}
