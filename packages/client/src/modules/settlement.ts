import { assertSchema } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import {
  AttemptSettlementSchema,
  type AttemptSettlementRequest,
} from "@suite/contracts";
import type { Platform, Scope } from "../index";
import { changeModuleStorage, readModuleStorage } from "./storage";
import { responseContract, validateModuleResponse } from "./response";
import { JournalConflictError } from "./journal";

export async function settleJournalEntry(
  platform: Platform,
  scope: Scope,
  id: string,
  settle: (request: {
    moduleId: string;
    moduleVersion?: string;
    body: AttemptSettlementRequest;
  }) => Promise<unknown>,
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
        body: { key: entry.id, call: request },
      });
      assertSchema(AttemptSettlementSchema, result);
      if (result.key !== entry.id)
        throw Error("The server returned an outcome for a different change.");
      if (result.outcome === "accepted") {
        const { module } = await responseContract(state, call);
        validateModuleResponse(module, call, result.result);
      }
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
        } else {
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
