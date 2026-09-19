import { assertSchema, Type, type ModuleCall } from "@suite/module-sdk";
import { Id, RequestKeySchema } from "@suite/contracts";
import { canonical } from "@suite/module-sdk/registry";
import type { Platform, Scope } from "../index";
import {
  changeModuleStorage,
  enqueue,
  readModuleStorage,
  resourceDraftKey,
  type ModuleStorage,
} from "./storage";
import { JournalConflictError } from "./journal";
import { responseContract, validateModuleResponse } from "./response";
import { settleModuleCall, type SettlementTransport } from "./settlement";

const archiveInput = Type.Object(
  {
    id: Id,
    baseVersion: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/** Fence the old archive, then durably queue an explicitly reviewed current-version attempt. */
export async function replaceArchive(
  platform: Platform,
  scope: Scope,
  id: string,
  replacement: ModuleCall,
  settle: SettlementTransport,
  authorized: (call: ModuleCall) => boolean,
): Promise<"accepted" | "replaced"> {
  const call = structuredClone(replacement);
  assertSchema(RequestKeySchema, call.key);
  assertSchema(archiveInput, call.input);
  const original = (state: ModuleStorage) => {
    const entry = state.journal.find(
      (e) =>
        e.id === id &&
        e.userId === scope.userId &&
        e.workspaceId === scope.workspaceId,
    );
    if (
      !entry ||
      entry.supersededBy ||
      !["rejected", "conflict"].includes(entry.state) ||
      entry.call.action !== "archive"
    )
      throw new JournalConflictError(
        "Only a rejected or conflicting archive can be reviewed. Resolve uncertain outcomes first.",
      );
    if (
      call.action !== "archive" ||
      call.operation ||
      !call.resource ||
      call.resource !== entry.call.resource ||
      call.moduleId !== entry.call.moduleId ||
      call.key === id ||
      (call.input as { id: string }).id !==
        (entry.recordRecovery?.targetId ??
          (entry.call.input as { id: string }).id)
    )
      throw new JournalConflictError(
        "An archive review must preserve its selected record and use a new retry identity.",
      );
    if (!authorized(entry.call) || !authorized(call))
      throw Error("Current access does not allow reviewing this archive.");
    if (
      entry.recordRecovery &&
      entry.dependencies.some(
        (id) =>
          !state.journal.some(
            (prior) =>
              prior.id === id &&
              prior.userId === scope.userId &&
              prior.workspaceId === scope.workspaceId &&
              prior.state === "accepted",
          ),
      )
    )
      throw new JournalConflictError(
        "Wait for prerequisite changes before reviewing this saved archive.",
      );
    if (state.installed[call.moduleId]?.version !== call.moduleVersion)
      throw new JournalConflictError(
        "The installed release changed. Review the archive again.",
      );
    if (
      state.journal.some(
        (e) =>
          e.dependencies.includes(id) &&
          !e.supersededBy &&
          ((e.state !== "pending" &&
            !(e.state === "conflict" && e.recordRecovery)) ||
            e.delivery !== "unsubmitted" ||
            e.attempts !== 0),
      )
    )
      throw new JournalConflictError(
        "A dependent may already have been submitted. Recover its outcome before replacing this archive.",
      );
    return entry;
  };
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      const state = await readModuleStorage(platform, scope);
      const entry = original(state);
      const verified = await responseContract(state, call);
      if (verified.module.resources[call.resource!]?.policy !== "queued")
        throw new JournalConflictError(
          "The installed resource does not support queued archive recovery.",
        );
      original(await readModuleStorage(platform, scope));
      const outcome = await settleModuleCall(
        { ...entry.call, key: id },
        settle,
        async (result) => {
          const prior = await responseContract(state, entry.call);
          validateModuleResponse(prior.module, entry.call, result);
        },
      );
      await changeModuleStorage(platform, scope, (stored) => {
        const current = original(stored);
        if (canonical(current.call) !== canonical(entry.call))
          throw new JournalConflictError(
            "The saved archive changed during recovery.",
          );
        delete current.delivery;
        delete current.errorCode;
        if (outcome.outcome === "accepted") {
          current.state = "accepted";
          current.result = outcome.result;
          current.recoveredAt = Date.now();
          delete current.error;
          delete current.settlement;
        } else {
          current.state = "rejected";
          current.settlement = "cancelled";
          current.error =
            "The original archive is stopped. Review the current record before submitting its replacement.";
        }
      });
      if (outcome.outcome === "accepted") return "accepted";
      await enqueue(
        platform,
        scope,
        call,
        entry.requestedDependencies ?? entry.dependencies,
        {
          supersedes: id,
          draftKey: resourceDraftKey(call.moduleId, call.resource!, {
            entryId: id,
          }),
        },
        (stored) => {
          const prior = stored.journal.find((e) => e.id === id);
          return (
            stored.installed[call.moduleId]?.version === call.moduleVersion &&
            !!prior &&
            prior.settlement === "cancelled" &&
            (!prior.supersededBy || prior.supersededBy === call.key) &&
            canonical(prior.call) === canonical(entry.call) &&
            authorized(entry.call) &&
            authorized(call)
          );
        },
      );
      return "replaced";
    },
  );
}
