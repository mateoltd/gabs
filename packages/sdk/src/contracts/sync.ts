import type { ModuleCall } from "../index";
export type JournalState = "pending" | "accepted" | "rejected" | "conflict";
export interface JournalEntry {
  id: string;
  userId: string;
  workspaceId: string;
  call: ModuleCall;
  dependencies: string[];
  /** Explicit command prerequisites before schema-derived resource references are added. */
  requestedDependencies?: string[];
  state: JournalState;
  createdAt: number;
  attempts: number;
  /** Missing on legacy entries, whose delivery history is unknown. */
  delivery?: "unsubmitted" | "uncertain";
  /** Local scheduling repair only; never part of the original server request. */
  orderingRecovery?: "outcome" | "waiting";
  /** A never-submitted collision descendant awaiting explicit review against this target. */
  recordRecovery?: { targetId: string; destination: "separate" | "existing" };
  supersededBy?: string;
  error?: string;
  errorCode?: string;
  /** Validated against the exact original operation's declared error schema. */
  businessError?: unknown;
  /** Recorded only after a verified authoritative cancellation response. */
  settlement?: "cancelled";
  /** Explicit host recovery retains the verified original contract for later receipt inspection. */
  recoveredAt?: number;
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
  eligible: (call: ModuleCall) => boolean = () => true,
) {
  const entries = await store.list();
  const states = new Map(entries.map((e) => [e.id, e.state]));
  const ready: JournalEntry[] = [];
  const remaining = new Map<string, number>();
  const dependents = new Map<string, JournalEntry[]>();
  for (const entry of entries
    .filter(
      (e) => e.state === "pending" && !e.supersededBy && !e.orderingRecovery,
    )
    .sort((a, b) => a.createdAt - b.createdAt)) {
    const waiting = new Set(
      entry.dependencies.filter((id) => states.get(id) !== "accepted"),
    );
    remaining.set(entry.id, waiting.size);
    if (!waiting.size) ready.push(entry);
    for (const id of waiting) {
      const children = dependents.get(id);
      if (children) children.push(entry);
      else dependents.set(id, [entry]);
    }
  }
  // Reviewed replacements may be newer than their dependents. Drain newly ready
  // work without retrying an uncertain request twice in this pass.
  for (const entry of ready) {
    if (!authorized()) break;
    if (!eligible(entry.call)) continue;
    // Old journals did not persist transport failures. Even attempts=0 cannot
    // establish that a legacy request never reached the server.
    const uncertain = entry.delivery !== "unsubmitted";
    entry.delivery = "uncertain";
    delete entry.errorCode;
    delete entry.businessError;
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
      const e = error as {
        status?: number;
        message?: string;
        code?: string;
        detail?: { moduleId?: string; operation?: string; error?: unknown };
      };
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
          if (
            e.code === "MODULE_BUSINESS_ERROR" &&
            e.detail?.moduleId === entry.call.moduleId &&
            e.detail.operation === entry.call.operation
          )
            entry.businessError = structuredClone(e.detail.error);
        }
      }
    }
    await store.put(entry);
    if (stop) break;
    if (entry.state === "accepted")
      for (const dependent of dependents.get(entry.id) ?? []) {
        const count = remaining.get(dependent.id)! - 1;
        remaining.set(dependent.id, count);
        if (!count) ready.push(dependent);
      }
  }
}
