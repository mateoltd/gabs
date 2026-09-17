import type { ModuleCall } from "../index";
export type JournalState = "pending" | "accepted" | "rejected" | "conflict";
export interface JournalEntry {
  id: string;
  userId: string;
  workspaceId: string;
  call: ModuleCall;
  dependencies: string[];
  state: JournalState;
  createdAt: number;
  attempts: number;
  supersededBy?: string;
  error?: string;
  result?: unknown;
}
export interface JournalStore {
  list(): Promise<JournalEntry[]>;
  put(entry: JournalEntry): Promise<void>;
}
/** Persist each terminal result before proceeding. Transport failures remain pending. */
export async function flushJournal(
  store: JournalStore,
  send: (call: ModuleCall) => Promise<unknown>,
  authorized: () => boolean,
) {
  const entries = await store.list();
  const states = new Map(entries.map((e) => [e.id, e.state]));
  for (const entry of entries
    .filter((e) => e.state === "pending" && !e.supersededBy)
    .sort((a, b) => a.createdAt - b.createdAt)) {
    if (!authorized()) break;
    if (
      entry.dependencies.some(
        (id) => !states.has(id) || states.get(id) !== "accepted",
      )
    )
      continue;
    try {
      entry.result = await send({ ...entry.call, key: entry.id });
      entry.state = "accepted";
      delete entry.error;
    } catch (error) {
      const e = error as { status?: number; message?: string; code?: string };
      if (
        e.code === "INVALID_RESOURCE_RESPONSE" ||
        e.code === "MODULE_RESPONSE_CONTRACT_UNAVAILABLE"
      ) {
        delete entry.result;
        entry.error =
          e.message ?? "This change is still awaiting a verified response.";
      } else {
        if (!e.status || e.status >= 500 || e.status === 429) break;
        if (
          e.status === 401 ||
          e.code === "MEMBERSHIP_REVOKED" ||
          e.code === "MFA_REQUIRED"
        )
          break;
        entry.state =
          e.status === 409 || e.status === 412 ? "conflict" : "rejected";
        entry.error = e.message ?? "The server rejected this change.";
      }
    }
    entry.attempts++;
    await store.put(entry);
    states.set(entry.id, entry.state);
  }
}
