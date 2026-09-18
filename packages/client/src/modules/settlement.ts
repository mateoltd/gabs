import { assertSchema, type ModuleCall } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import {
  AttemptSettlementSchema,
  type AttemptSettlementRequest,
} from "@suite/contracts";
import type { Platform, Scope } from "../index";
import { changeModuleStorage, readModuleStorage } from "./storage";
import { responseContract, validateModuleResponse } from "./response";
import { JournalConflictError } from "./journal";
import { prepareCreateReplacement } from "./collisions";
import { removeResourceDraft } from "./drafts";

/** Fence a failed create before atomically replacing its never-submitted dependency graph. */
export async function replaceFailedCreate(
  platform: Platform,
  scope: Scope,
  id: string,
  replacement: ModuleCall,
  settle: SettlementTransport,
  authorized: (call: ModuleCall) => boolean,
): Promise<"accepted" | "replaced"> {
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      const state = await readModuleStorage(platform, scope);
      const entry = state.journal.find(
        (e) =>
          e.id === id &&
          e.userId === scope.userId &&
          e.workspaceId === scope.workspaceId,
      );
      if (
        !entry ||
        entry.supersededBy ||
        entry.call.action !== "create" ||
        !["conflict", "rejected"].includes(entry.state)
      )
        throw new JournalConflictError(
          "Only a failed create can become a separate record.",
        );
      const call = structuredClone(entry.call);
      if (!authorized(call) || !authorized(replacement))
        throw Error(
          "Connect and unlock this workspace with current write access to recover this create.",
        );
      const result = await settleModuleCall(
        { ...call, key: id },
        settle,
        async (result) => {
          const { module } = await responseContract(state, call);
          validateModuleResponse(module, call, result);
        },
      );
      if (!authorized(call) || !authorized(replacement))
        throw Error(
          "Unlock this workspace again to recover its confirmed outcome.",
        );
      // Retain a verified fence even if replacement validation fails. Retrying after a
      // crash asks the server for this same original outcome before any rekeying.
      await changeModuleStorage(platform, scope, (stored) => {
        const current = stored.journal.find(
          (e) =>
            e.id === id &&
            e.userId === scope.userId &&
            e.workspaceId === scope.workspaceId,
        );
        if (
          !current ||
          current.supersededBy ||
          !["conflict", "rejected"].includes(current.state) ||
          canonical(current.call) !== canonical(call)
        )
          throw new JournalConflictError(
            "The saved create changed during recovery. Reload its current state.",
          );
        delete current.delivery;
        if (result.outcome === "accepted") {
          current.state = "accepted";
          current.result = result.result;
          delete current.error;
          delete current.errorCode;
          delete current.settlement;
          for (const [key, review] of Object.entries(stored.draftReviews ?? {}))
            if (review.entryId === id) removeResourceDraft(stored, key);
        } else {
          current.settlement = "cancelled";
          current.error =
            "The original create is stopped. Review your saved input to create a separate record.";
        }
      });
      if (result.outcome === "accepted") return "accepted";
      await changeModuleStorage(platform, scope, async (stored) => {
        const next = await prepareCreateReplacement(
          stored,
          scope,
          id,
          replacement,
          authorized,
        );
        if (!authorized(call) || !authorized(replacement))
          throw Error(
            "Current access changed during recovery. Your input is preserved.",
          );
        Object.assign(stored, next);
      });
      return "replaced";
    },
  );
}

export type SettlementTransport = (request: {
  moduleId: string;
  moduleVersion?: string;
  body: AttemptSettlementRequest;
}) => Promise<unknown>;

/** Resolve one exact call. The caller retains it until this verified result is applied. */
export async function settleModuleCall(
  call: ModuleCall,
  settle: SettlementTransport,
  validate: (result: unknown) => void | Promise<void>,
) {
  if (!call.key)
    throw new JournalConflictError("The original retry identity is required.");
  let request: AttemptSettlementRequest["call"];
  if (call.action === "operation" && call.operation)
    request = {
      action: "operation",
      operation: call.operation,
      input: call.input,
    };
  else if (
    (call.action === "create" ||
      call.action === "update" ||
      call.action === "archive") &&
    call.resource
  )
    request = {
      action: call.action,
      resource: call.resource,
      input: call.input,
    };
  else
    throw new JournalConflictError(
      "This request is not a recoverable command.",
    );
  const result = await settle({
    moduleId: call.moduleId,
    moduleVersion: call.moduleVersion,
    body: { key: call.key, call: request },
  });
  assertSchema(AttemptSettlementSchema, result);
  if (result.key !== call.key)
    throw Error("The server returned an outcome for a different change.");
  if (result.outcome === "accepted") await validate(result.result);
  return result;
}

export async function settleJournalEntry(
  platform: Platform,
  scope: Scope,
  id: string,
  settle: SettlementTransport,
  authorized: () => boolean,
) {
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      if (!authorized())
        throw Error("Connect and unlock this workspace to resolve the change.");
      const state = await readModuleStorage(platform, scope);
      const entry = state.journal.find(
        (e) =>
          e.id === id &&
          e.userId === scope.userId &&
          e.workspaceId === scope.workspaceId,
      );
      if (
        !entry ||
        entry.state !== "pending" ||
        entry.supersededBy ||
        entry.delivery === "unsubmitted"
      )
        throw new JournalConflictError(
          "Only an uncertain pending change can be resolved.",
        );
      const { call } = entry;
      const result = await settleModuleCall(
        { ...call, key: entry.id },
        settle,
        async (result) => {
          const { module } = await responseContract(state, call);
          validateModuleResponse(module, call, result);
        },
      );
      if (!authorized())
        throw Error(
          "Unlock this workspace again to recover its confirmed outcome.",
        );
      await changeModuleStorage(platform, scope, (stored) => {
        const current = stored.journal.find(
          (e) =>
            e.id === id &&
            e.userId === scope.userId &&
            e.workspaceId === scope.workspaceId,
        );
        if (
          !current ||
          current.state !== "pending" ||
          current.supersededBy ||
          canonical(current.call) !== canonical(call)
        )
          throw new JournalConflictError(
            "The pending change changed during recovery. Reload its current state.",
          );
        delete current.delivery;
        if (result.outcome === "accepted") {
          current.state = "accepted";
          current.result = result.result;
          delete current.error;
          delete current.errorCode;
          delete current.settlement;
        } else {
          current.settlement = "cancelled";
          current.state = "rejected";
          delete current.result;
          current.error =
            "The server confirmed this change did not commit and stopped further retries. Review your saved input before submitting a correction.";
        }
      });
      return result.outcome;
    },
  );
}
