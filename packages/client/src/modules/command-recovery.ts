import { assertSchema, Type, type ModuleCall } from "@suite/module-sdk";
import { RequestKeySchema } from "@suite/contracts";
import { canonical } from "@suite/module-sdk/registry";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { Platform, Scope } from "../index";
import {
  changeModuleStorage,
  readModuleStorage,
  type ModuleStorage,
} from "./storage";
import {
  responseContract,
  responseContractKey,
  validateModuleResponse,
} from "./response";
import {
  assertJournalOrder,
  referenceDependencies,
  JournalConflictError,
} from "./journal";
import { settleModuleCall, type SettlementTransport } from "./settlement";

export interface CommandContinuation {
  id: string;
  fingerprint: string;
}
export const commandContinuation = (
  entry: JournalEntry,
): CommandContinuation => ({
  id: entry.id,
  fingerprint: canonical({
    call: entry.call,
    dependencies: entry.dependencies,
  }),
});
export interface CommandReview {
  continuations?: CommandContinuation[];
  source: ModuleCall;
  moduleVersion: string;
  input: unknown;
  revision: number;
  updatedAt: number;
}
export function commandReview(
  state: ModuleStorage,
  id: string,
): CommandReview | undefined {
  return state.commandReviews && Object.hasOwn(state.commandReviews, id)
    ? state.commandReviews[id]
    : undefined;
}
function original(state: ModuleStorage, scope: Scope, id: string) {
  const entry = state.journal.find(
    (e) =>
      e.id === id &&
      e.userId === scope.userId &&
      e.workspaceId === scope.workspaceId,
  );
  if (
    !entry ||
    entry.call.action !== "operation" ||
    !entry.call.operation ||
    entry.supersededBy
  )
    throw new JournalConflictError(
      "This saved command is no longer available for correction.",
    );
  return entry;
}
function reviewable(entry: JournalEntry) {
  if (!["rejected", "conflict"].includes(entry.state))
    throw new JournalConflictError(
      "Resolve an uncertain command before preparing a correction. Accepted commands cannot be replaced.",
    );
}
function correction(
  entry: JournalEntry,
  review: Pick<CommandReview, "input" | "moduleVersion">,
  key?: string,
): ModuleCall {
  return {
    moduleId: entry.call.moduleId,
    moduleVersion: review.moduleVersion,
    action: "operation",
    operation: entry.call.operation,
    input: structuredClone(review.input),
    ...(key ? { key } : {}),
  };
}
async function contract(state: ModuleStorage, call: ModuleCall) {
  if (state.installed[call.moduleId]?.version !== call.moduleVersion)
    throw new JournalConflictError(
      "The installed release changed. Reopen this command and review its input against the installed release.",
    );
  const verified = await responseContract(state, call);
  const op = verified.module.operations[call.operation!];
  if (op.policy !== "queued" || op.kind === "query" || op.serviceOnly)
    throw new JournalConflictError(
      "The installed release does not support correcting this queued command.",
    );
  return { ...verified, op };
}

/** Save review input, including invalid partial input, without submitting or changing the original request. */
export async function saveCommandReview(
  platform: Platform,
  scope: Scope,
  id: string,
  moduleVersion: string,
  input: unknown,
  expectedRevision: number,
  authorized: (call: ModuleCall) => boolean,
  continuations: readonly CommandContinuation[] = [],
): Promise<CommandReview> {
  const snapshot = structuredClone(input);
  const choices = structuredClone([...continuations]);
  let saved!: CommandReview;
  await changeModuleStorage(platform, scope, async (state) => {
    const entry = original(state, scope, id);
    reviewable(entry);
    const call = correction(entry, { moduleVersion, input: snapshot });
    if (!authorized(entry.call) || !authorized(call))
      throw Error("Current access does not allow reviewing this command.");
    const previous = commandReview(state, id);
    if (
      (previous?.revision ?? 0) !== expectedRevision ||
      (previous && canonical(previous.source) !== canonical(entry.call))
    )
      throw new JournalConflictError(
        "This review changed in another view. Reopen its saved input before continuing.",
      );
    const eligible = new Map(
      commandDependents(state, scope, id).map((child) => [child.id, child]),
    );
    assertSchema(
      Type.Array(RequestKeySchema, { uniqueItems: true, maxItems: 100 }),
      choices.map((choice) => choice.id),
    );
    for (const choice of choices) {
      const child = eligible.get(choice.id);
      if (
        !child ||
        !authorized(child.call) ||
        commandContinuation(child).fingerprint !== choice.fingerprint
      )
        throw new JournalConflictError(
          "A selected dependent changed. Reopen its input before continuing.",
        );
    }
    const verified = await contract(state, call);
    if (
      !authorized(entry.call) ||
      !authorized(call) ||
      choices.some((choice) => !authorized(eligible.get(choice.id)!.call))
    )
      throw Error("Current access changed before the review could be saved.");
    saved = {
      continuations: choices,
      source: structuredClone(entry.call),
      moduleVersion,
      input: snapshot,
      revision: expectedRevision + 1,
      updatedAt: Date.now(),
    };
    (state.responseContracts ??= {})[responseContractKey(call)] =
      verified.contract;
    Object.defineProperty((state.commandReviews ??= {}), id, {
      value: saved,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });
  return saved;
}

/** Only explicit, never-submitted direct dependents may retain their inputs after a correction. */
export function commandDependents(
  state: ModuleStorage,
  scope: Scope,
  id: string,
) {
  return state.journal.filter(
    (entry) =>
      entry.userId === scope.userId &&
      entry.workspaceId === scope.workspaceId &&
      entry.dependencies.includes(id) &&
      !entry.supersededBy &&
      entry.state === "pending" &&
      entry.delivery === "unsubmitted" &&
      entry.attempts === 0 &&
      !entry.orderingRecovery &&
      !entry.recordRecovery,
  );
}

/** Fence the original before replacing its identity. Preserve the fence even if local replacement is interrupted. */
export async function replaceCommand(
  platform: Platform,
  scope: Scope,
  id: string,
  revision: number,
  key: string,
  continuations: readonly CommandContinuation[],
  settle: SettlementTransport,
  authorized: (call: ModuleCall) => boolean,
): Promise<"accepted" | "replaced"> {
  assertSchema(RequestKeySchema, key);
  if (id === key)
    throw new JournalConflictError(
      "A correction needs a new retry identity after the original request is stopped.",
    );
  assertSchema(
    Type.Array(RequestKeySchema, { uniqueItems: true, maxItems: 100 }),
    continuations.map((choice) => choice.id),
  );
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      const state = await readModuleStorage(platform, scope);
      const entry = original(state, scope, id);
      reviewable(entry);
      const review = commandReview(state, id);
      if (
        !review ||
        review.revision !== revision ||
        canonical(review.source) !== canonical(entry.call)
      )
        throw new JournalConflictError(
          "Save and reopen the current review before submitting a correction.",
        );
      if (canonical(review.continuations ?? []) !== canonical(continuations))
        throw new JournalConflictError(
          "Save the selected dependent review before submitting.",
        );
      const call = correction(entry, review, key);
      if (!authorized(entry.call) || !authorized(call))
        throw Error(
          "Reconnect with current command access before submitting a correction.",
        );
      const verified = await contract(state, call);
      assertSchema(verified.op.input, call.input);
      // A snapshot of every selected call prevents a concurrent edit from silently receiving approval.
      const selected = new Map(
        commandDependents(state, scope, id).map((child) => [child.id, child]),
      );
      const approved = continuations.map((choice) => {
        const child = selected.get(choice.id);
        if (
          !child ||
          !authorized(child.call) ||
          commandContinuation(child).fingerprint !== choice.fingerprint
        )
          throw new JournalConflictError(
            "A selected dependent is unavailable or already submitted. Review it separately.",
          );
        return {
          id: child.id,
          call: canonical(child.call),
          dependencies: canonical(child.dependencies),
        };
      });
      if (!authorized(entry.call) || !authorized(call))
        throw Error("Current access changed before command recovery.");
      const outcome = await settleModuleCall(
        { ...entry.call, key: id },
        settle,
        async (result) => {
          const originalContract = await responseContract(state, entry.call);
          validateModuleResponse(originalContract.module, entry.call, result);
        },
      );
      if (!authorized(entry.call) || !authorized(call))
        throw Error(
          "Current access changed during recovery. The original identity and review are preserved.",
        );
      await changeModuleStorage(platform, scope, (stored) => {
        const current = original(stored, scope, id);
        if (
          canonical(current.call) !== canonical(entry.call) ||
          !["conflict", "rejected"].includes(current.state)
        )
          throw new JournalConflictError(
            "The saved command changed during recovery. Reopen its current outcome.",
          );
        if (!authorized(current.call))
          throw Error("Current access changed during recovery.");
        delete current.delivery;
        delete current.errorCode;
        delete current.businessError;
        if (outcome.outcome === "accepted") {
          current.state = "accepted";
          current.result = outcome.result;
          delete current.error;
          delete current.settlement;
        } else {
          current.settlement = "cancelled";
          current.error =
            "The server stopped the original request. Your correction remains saved until its replacement is recorded.";
        }
      });
      if (outcome.outcome === "accepted") return "accepted";
      await changeModuleStorage(platform, scope, async (stored) => {
        const current = original(stored, scope, id);
        const saved = commandReview(stored, id);
        if (
          current.settlement !== "cancelled" ||
          !saved ||
          canonical(saved) !== canonical(review) ||
          canonical(current.call) !== canonical(entry.call)
        )
          throw new JournalConflictError(
            "This review changed during recovery. Reopen it before submitting.",
          );
        if (stored.journal.some((e) => e.id === key))
          throw new JournalConflictError(
            "This replacement identity is already in use. Inspect its outcome before continuing.",
          );
        const nextContract = await contract(stored, call);
        assertSchema(nextContract.op.input, call.input);
        const available = new Map(
          commandDependents(stored, scope, id).map((child) => [
            child.id,
            child,
          ]),
        );
        for (const approval of approved) {
          const child = available.get(approval.id);
          if (
            !child ||
            !authorized(child.call) ||
            canonical(child.call) !== approval.call ||
            canonical(child.dependencies) !== approval.dependencies
          )
            throw new JournalConflictError(
              "A dependent changed during recovery. Review the saved command again.",
            );
        }
        const dependencies = [
          ...new Set([
            ...(current.requestedDependencies ?? current.dependencies),
            ...referenceDependencies(
              nextContract.op.input,
              call,
              stored.journal,
              scope,
            ),
          ]),
        ];
        assertSchema(
          Type.Array(RequestKeySchema, { maxItems: 100, uniqueItems: true }),
          dependencies,
        );
        const replacement: JournalEntry = {
          id: key,
          ...scope,
          call,
          dependencies,
          requestedDependencies: [
            ...(current.requestedDependencies ?? current.dependencies),
          ],
          state: "pending",
          delivery: "unsubmitted",
          createdAt: Date.now(),
          attempts: 0,
        };
        stored.journal.push(replacement);
        current.supersededBy = key;
        for (const { id: childId } of approved) {
          const child = available.get(childId)!;
          child.dependencies = child.dependencies.map((dependency) =>
            dependency === id ? key : dependency,
          );
          // Explicit prerequisites change only after the user's approval; original request bodies stay exact.
          if (child.requestedDependencies)
            child.requestedDependencies = child.requestedDependencies.map(
              (dependency) => (dependency === id ? key : dependency),
            );
        }
        (stored.responseContracts ??= {})[responseContractKey(call)] =
          nextContract.contract;
        assertJournalOrder(stored.journal, scope);
        if (
          !authorized(current.call) ||
          !authorized(call) ||
          approved.some(({ id }) => !authorized(available.get(id)!.call))
        )
          throw Error(
            "Current access changed before the correction could be saved.",
          );
        delete stored.commandReviews![id];
      });
      return "replaced";
    },
  );
}
