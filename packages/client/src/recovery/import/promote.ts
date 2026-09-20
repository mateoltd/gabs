import { RequestKeySchema } from "@suite/contracts";
import { assertSchema } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import type { JournalEntry } from "@suite/module-sdk/sync";
import {
  changeModuleStorage,
  readModuleStorage,
  type ModuleStorage,
} from "../../modules/storage";
import {
  importedDraftKeys,
  prepareImportedDraft,
  type ImportedDraftSource,
} from "./draft";
import { settleModuleCall } from "../../modules/settlement";
import {
  responseContract,
  validateModuleResponse,
} from "../../modules/response";
import { assertJournalOrder } from "../../modules/journal";
import { authorizeWorkImport, type SavedWorkImportOptions } from "./authority";
import type { SavedWorkImport } from "./format";
import { readImportSource } from "./stored";

const exactCall = (entry: JournalEntry) =>
  canonical({ ...entry.call, key: entry.id });
function matchingRequest(state: ModuleStorage, entry?: JournalEntry) {
  if (!entry) return;
  const existing = state.journal.find((item) => item.id === entry.id);
  if (
    existing &&
    (existing.userId !== entry.userId ||
      existing.workspaceId !== entry.workspaceId ||
      exactCall(existing) !== exactCall(entry))
  )
    throw Error(
      "This request identity already belongs to different saved work. Both copies were retained.",
    );
  return existing;
}
/** Explicitly settle original effects, then atomically restore independently reviewed local work. */
export async function promoteSavedWorkImport(
  options: SavedWorkImportOptions,
  digest: string,
  choice?: { draftSource: ImportedDraftSource },
) {
  const scope = { ...options.scope };
  const draftSource = choice?.draftSource;
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      options.signal.throwIfAborted();
      options.check();
      const before = await readModuleStorage(options.platform, scope);
      const { input, imported } = await readImportSource(
        before,
        digest,
        options,
      );
      const authority = await authorizeWorkImport(options, input);
      if (imported.promotion)
        return { ...imported.promotion, alreadyRestored: true };
      const entry = input.entry;
      if (entry) assertSchema(RequestKeySchema, entry.id);
      const existing = matchingRequest(before, entry);
      const destinations = importedDraftKeys(input, digest, draftSource);
      if (input.selection === "draft" && existing?.supersededBy)
        throw Error(
          "This original request already has a correction on this device. Inspect the retained imported copy alongside the current work.",
        );
      if (
        input.selection === "draft" &&
        (existing?.recordRecovery || existing?.createRecovery?.length)
      )
        throw Error(
          "This original request was reassigned on this device. Preserve its current record and dependency review before restoring another copy.",
        );
      if (destinations.some((key) => Object.hasOwn(before.drafts, key)))
        throw Error(
          "The recovery draft destination is already in use. Existing work was retained.",
        );
      let outcome: Awaited<ReturnType<typeof settleModuleCall>> | undefined;
      if (entry) {
        authority.check();
        outcome = await settleModuleCall(
          { ...entry.call, key: entry.id },
          (request) =>
            options.client.forUser(scope.userId).request(
              {
                operation: "moduleAttemptSettle",
                params: {
                  workspaceId: scope.workspaceId,
                  moduleId: request.moduleId,
                },
                moduleVersion: request.moduleVersion,
                body: request.body,
              },
              { signal: options.signal },
            ),
          async (result) => {
            const { module } = await responseContract(
              authority.contracts,
              entry.call,
            );
            validateModuleResponse(module, entry.call, result);
          },
        );
        // A lost reply or denial retains the import; retry asks for this exact permanent outcome.
        await authority.refresh();
      }
      const draft =
        input.selection === "draft"
          ? await prepareImportedDraft(
              options,
              input,
              digest,
              authority,
              outcome,
              draftSource,
            )
          : undefined;
      const draftKey = draft?.key;
      const promotion: NonNullable<SavedWorkImport["promotion"]> = {
        ...(entry ? { requestId: entry.id } : {}),
        ...(draftKey ? { draftKey } : {}),
        ...(outcome ? { outcome: outcome.outcome } : {}),
        existingRequest: !!existing,
        ...(input.selection === "draft" &&
        (input.review?.collision || input.entry?.recordRecovery) &&
        draftSource
          ? { draftSource }
          : {}),
        restoredAt: Date.now(),
      };
      await changeModuleStorage(
        options.platform,
        scope,
        async (state) => {
          authority.check();
          const current = await readImportSource(state, digest, options);
          if (
            current.imported.promotion ||
            canonical(current.input) !== canonical(input)
          )
            throw Error(
              "This import changed during restoration. Reload its current state.",
            );
          const present = matchingRequest(state, entry);
          if (canonical(present ?? null) !== canonical(existing ?? null))
            throw Error(
              "The existing request changed during restoration. Retry with its current state.",
            );
          if (destinations.some((key) => Object.hasOwn(state.drafts, key)))
            throw Error(
              "The recovery draft destination changed. Existing work was retained.",
            );
          if (present && outcome) {
            // Only the freshly verified outcome changes; existing input, ordering and independent reviews remain intact.
            delete present.delivery;
            delete present.orderingRecovery;
            delete present.error;
            delete present.errorCode;
            delete present.businessError;
            if (outcome.outcome === "accepted") {
              present.state = "accepted";
              present.result = outcome.result;
              delete present.settlement;
            } else {
              present.state = "rejected";
              present.settlement = "cancelled";
              delete present.result;
              present.error =
                "The server stopped the original request. Review this saved input before submitting a correction.";
            }
          }
          if (entry && !existing) {
            if (!outcome)
              throw Error("The authoritative request outcome is missing.");
            // Copy identity and ordering only. File-supplied acceptance, remapping and replacement claims are inert.
            const restored: JournalEntry = {
              id: entry.id,
              ...scope,
              call: structuredClone(entry.call),
              dependencies: [...entry.dependencies],
              ...(entry.requestedDependencies
                ? { requestedDependencies: [...entry.requestedDependencies] }
                : {}),
              ...(entry.captureDependencies
                ? { captureDependencies: [...entry.captureDependencies] }
                : {}),
              createdAt: entry.createdAt,
              attempts: entry.attempts,
              recoveredAt: Date.now(),
              ...(outcome.outcome === "accepted"
                ? { state: "accepted", result: outcome.result }
                : {
                    state: "rejected",
                    settlement: "cancelled",
                    error:
                      "The server stopped the original request. Review this saved input before submitting a correction.",
                  }),
            };
            state.journal.push(restored);
            if (
              input.selection === "request" &&
              input.review &&
              outcome.outcome === "cancelled"
            ) {
              if (Object.hasOwn(state.commandReviews ?? {}, entry.id))
                throw Error(
                  "An existing command review must be preserved before restoration.",
                );
              (state.commandReviews ??= {})[entry.id] = {
                source: structuredClone(entry.call),
                moduleVersion: input.review.moduleVersion,
                input: structuredClone(input.review.input),
                revision: input.review.revision,
                updatedAt: input.review.updatedAt,
              };
            }
          }
          if (draft?.recordRecovery) {
            const restored = state.journal.find(
              (item) => item.id === entry?.id,
            );
            if (!restored || restored.settlement !== "cancelled")
              throw Error(
                "The original request must be stopped before its target can change.",
              );
            restored.recordRecovery = draft.recordRecovery;
          }
          if (draft) {
            state.drafts[draft.key] = draft.data;
            (state.draftVersions ??= {})[draft.key] = draft.version;
            (state.draftTargets ??= {})[draft.key] = draft.target;
            (state.draftReviews ??= {})[draft.key] = draft.review;
          }
          Object.assign(
            (state.responseContracts ??= {}),
            authority.contracts.responseContracts,
          );
          (state.recoveryVersions ??= {})[input.moduleId] =
            authority.module.version;
          assertJournalOrder(state.journal, scope);
          current.imported.promotion = promotion;
          authority.check();
        },
        authority.check,
      );
      return { ...promotion, alreadyRestored: false };
    },
  );
}
