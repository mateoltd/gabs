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
  /** Missing on legacy entries, whose delivery history is unknown. */
  delivery?: "unsubmitted" | "uncertain";
  supersededBy?: string;
  error?: string;
  errorCode?: string;
  /** Recorded only after a verified authoritative cancellation response. */
  settlement?: "cancelled";
  result?: unknown;
}
export interface JournalStore {
  list(): Promise<JournalEntry[]>;
  put(entry: JournalEntry): Promise<void>;
}
/** A later denial cannot establish the outcome of an earlier ambiguous attempt. */
export function isDefinitiveRejection(
  error: unknown,
  priorUncertainty: boolean,
): boolean {
  if (priorUncertainty || !error || typeof error !== "object") return false;
  const { status, code } = error as { status?: number; code?: string };
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    ![401, 408, 429].includes(status) &&
    ![
      "MEMBERSHIP_REVOKED",
      "MFA_REQUIRED",
      "INVALID_RESOURCE_RESPONSE",
      "MODULE_RESPONSE_CONTRACT_UNAVAILABLE",
    ].includes(code ?? "")
  );
}
/** Persist dispatch before sending. An ambiguous attempt keeps its original retry identity. */
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
    // Old journals did not persist transport failures. Even attempts=0 cannot
    // establish that a legacy request never reached the server.
    const uncertain = entry.delivery !== "unsubmitted";
    entry.delivery = "uncertain";
    delete entry.errorCode;
    entry.attempts++;
    await store.put(structuredClone(entry));
    let stop = false;
    try {
      entry.result = await send({ ...entry.call, key: entry.id });
      entry.state = "accepted";
      delete entry.error;
      delete entry.errorCode;
      delete entry.settlement;
      delete entry.delivery;
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
        stop =
          !e.status ||
          e.status >= 500 ||
          e.status === 408 ||
          e.status === 429 ||
          e.status === 401 ||
          e.code === "MEMBERSHIP_REVOKED" ||
          e.code === "MFA_REQUIRED";
        if (uncertain || stop) {
          delete entry.result;
          entry.error =
            "The outcome of an earlier attempt is unknown. Your original change is retained for retry." +
            (e.status && e.message ? ` ${e.message}` : "");
        } else {
          entry.state =
            e.status === 409 || e.status === 412 ? "conflict" : "rejected";
          delete entry.delivery;
          entry.error = e.message ?? "The server rejected this change.";
          if (typeof e.code === "string") entry.errorCode = e.code;
        }
      }
    }
    await store.put(entry);
    states.set(entry.id, entry.state);
    if (stop) break;
  }
}
