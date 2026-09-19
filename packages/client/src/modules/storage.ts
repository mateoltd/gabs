import {
  pruneReferenceCache,
  type ReferenceCacheState,
} from "./reference-cache";
import type { CommandReview } from "./command-recovery";
import { pruneResourcePages, type ResourcePageCache } from "./cache";
export { cacheResourcePage, resourcePageDownloadedAt } from "./cache";
import {
  resourceDraftKey,
  removeResourceDraft,
  promoteReviewDrafts,
  type DraftReview,
} from "./drafts";
export { resourceDraftKey, removeResourceDraft } from "./drafts";
import {
  responseContract,
  responseContractKey,
  validateModuleResponse,
  validateModuleError,
  type ResponseContract,
} from "./response";
import {
  hydrateModuleArtifacts,
  persistModuleArtifacts,
  retainedArtifactKeys,
  type StoredModuleState,
} from "./artifacts";
import type { Platform, Scope } from "../index";
import type {
  InstallationReport,
  InstallationSelection,
  SignedArtifact,
} from "@suite/module-sdk/platform";
import type {
  ModuleCall,
  ResourceRecord,
  FieldReview,
} from "@suite/module-sdk";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";
import {
  assertJournalOrder,
  recoverRecordOrder,
  referenceDependencies,
  recordDependencies,
  JournalConflictError,
} from "./journal";
import { canonical } from "@suite/module-sdk/registry";
import { Type, assertSchema } from "@suite/module-sdk";
import { RequestKeySchema } from "@suite/contracts";
export { pendingReferenceOptions, recordDependencies } from "./journal";
export interface InstallationAttempt {
  action: "install" | "uninstall";
  requestId: string;
  deviceId: string;
  releases: InstallationSelection[];
  startedAt: number;
  reportVersion?: string;
  phase: "downloading" | "confirming";
  error?: string;
  retry?: { failures: number; nextAttemptAt: number };
}
export interface ModuleStorage extends ResourcePageCache, ReferenceCacheState {
  /** Last device contract retained for leased inspection after uninstall, never execution. */
  recoveryVersions?: Record<string, string>;
  commandReviews?: Record<string, CommandReview>;
  responseContracts?: Record<string, ResponseContract>;
  installationReports?: Record<
    string,
    {
      report: InstallationReport;
      delivered: boolean;
      delivery?: {
        attempts: number;
        nextAttemptAt: number;
        rejected?: "invalid" | "superseded";
      };
    }
  >;
  lifecycle?: Record<string, InstallationAttempt>;
  lifecycleErrors?: Record<string, string>;
  journal: JournalEntry[];
  installed: Record<
    string,
    {
      version: string;
      artifact: unknown;
      verifiedAt: number;
      signed?: SignedArtifact;
      publicKey?: string;
    }
  >;
  downloads?: Record<string, SignedArtifact>;
  drafts: Record<string, Record<string, unknown>>;
  draftVersions?: Record<string, string>;
  draftGenerations?: Record<string, number>;
  draftTargets?: Record<string, ResourceRecord | null>;
  draftReviews?: Record<
    string,
    {
      entryId?: string;
      draftId?: string;
      createRecovery?: JournalEntry["createRecovery"];
      comparison?: FieldReview;
      collision?: {
        parentId: string;
        sourceData: Record<string, unknown>;
        sourceTarget: ResourceRecord | null;
        targetId?: string;
        moduleVersion?: string;
        ready?: boolean;
      };
      recoveryInput?: {
        moduleVersion: string;
        baseVersion?: number;
        recordId?: string;
      };
    }
  >;
}
const empty = (): ModuleStorage => ({
  journal: [],
  pages: {},
  installed: {},
  drafts: {},
});
const lockKey = (scope: Scope) =>
  `suite-modules:${scope.userId}:${scope.workspaceId}`;
async function readUnlocked(platform: Platform, scope: Scope) {
  const stored = await platform.load<StoredModuleState>(scope, "module-state");
  const state = stored
    ? promoteReviewDrafts(
        await hydrateModuleArtifacts(platform, scope, stored),
        scope,
      )
    : empty();
  const orderChanged = recoverRecordOrder(state.journal, scope);
  const cacheChanged = pruneResourcePages(state);
  const referencesChanged = pruneReferenceCache(state);
  if (orderChanged || cacheChanged || referencesChanged)
    await platform.save(
      scope,
      "module-state",
      await persistModuleArtifacts(platform, scope, state),
    );
  return state;
}
export async function readModuleStorage(platform: Platform, scope: Scope) {
  return navigator.locks.request(lockKey(scope), () =>
    readUnlocked(platform, scope),
  );
}
export async function changeModuleStorage(
  platform: Platform,
  scope: Scope,
  fn: (state: ModuleStorage) => void | Promise<void>,
) {
  const change = async () => {
    const previous = await platform.load<StoredModuleState>(
      scope,
      "module-state",
    );
    // Collect bytes abandoned by a crash or a previous update. Readers share this lock.
    await platform.pruneModuleArtifacts(
      scope,
      previous ? retainedArtifactKeys(previous) : [],
    );
    const state = previous
      ? await hydrateModuleArtifacts(platform, scope, previous)
      : empty();
    promoteReviewDrafts(state, scope);
    recoverRecordOrder(state.journal, scope);
    await fn(state);
    recoverRecordOrder(state.journal, scope);
    pruneResourcePages(state);
    pruneReferenceCache(state);
    const stored = await persistModuleArtifacts(platform, scope, state);
    // This single durable write commits the release set and journal together, after all bytes exist.
    await platform.save(scope, "module-state", stored);
    return state;
  };
  return navigator.locks.request(lockKey(scope), change);
}
/** Save one review independently; stale windows cannot resurrect a replaced request. */
export async function saveResourceDraft(
  platform: Platform,
  scope: Scope,
  moduleId: string,
  resource: string,
  draft: {
    data: Record<string, unknown>;
    target: ResourceRecord | null;
    review?: DraftReview;
    moduleVersion?: string;
    generation?: number;
  },
) {
  return changeModuleStorage(platform, scope, async (state) => {
    const { data, target, review } = draft;
    if (review?.entryId) {
      const entry = state.journal.find(
        (item) =>
          item.id === review.entryId &&
          item.userId === scope.userId &&
          item.workspaceId === scope.workspaceId &&
          item.call.moduleId === moduleId &&
          item.call.resource === resource &&
          !item.supersededBy &&
          ["conflict", "rejected"].includes(item.state),
      );
      if (
        !entry ||
        (entry.call.action === "update" &&
          (entry.recordRecovery?.targetId ??
            (entry.call.input as { id?: string }).id) !== target?.id)
      )
        throw new JournalConflictError(
          "This review no longer belongs to an editable pending change. Refresh pending changes.",
        );
      if (
        canonical(review.createRecovery ?? []) !==
        canonical(entry.createRecovery ?? [])
      )
        throw new JournalConflictError(
          "A prerequisite record changed. Reopen the current recovery details before saving this review.",
        );
    }
    const key = resourceDraftKey(moduleId, resource, review);
    if (
      review?.collision &&
      (!state.draftReviews?.[key]?.collision ||
        canonical({
          ...state.draftReviews[key].collision,
          ready: undefined,
        }) !== canonical({ ...review.collision, ready: undefined }))
    )
      throw new JournalConflictError(
        "This saved review changed or was submitted in another view. Reload its current state.",
      );
    if (
      !review?.entryId &&
      !review?.draftId &&
      (state.draftGenerations?.[key] ?? 0) !== (draft.generation ?? 0)
    )
      throw new JournalConflictError(
        "This draft was moved or submitted in another view. Your open input is preserved; reopen its saved review before continuing.",
      );
    const version = draft.moduleVersion ?? state.installed[moduleId]?.version;
    if (version) {
      const call: ModuleCall = {
        moduleId,
        moduleVersion: version,
        resource,
        action: target ? "update" : "create",
        input: {},
      };
      const { contract } = await responseContract(state, call);
      (state.responseContracts ??= {})[responseContractKey(call)] = contract;
      (state.draftVersions ??= {})[key] = version;
    }
    state.drafts[key] = data;
    (state.draftTargets ??= {})[key] = target;
    if (review) (state.draftReviews ??= {})[key] = review;
    else if (state.draftReviews) delete state.draftReviews[key];
  });
}
export async function enqueue(
  platform: Platform,
  scope: Scope,
  call: ModuleCall,
  dependencies: string[] = [],
  recovery?: {
    draftKey: string;
    supersedes?: string;
    generation?: number;
    createRecovery?: JournalEntry["createRecovery"];
  },
  authorized: (state: ModuleStorage) => boolean = () => true,
) {
  const entry: JournalEntry = {
    id: call.key ?? crypto.randomUUID(),
    ...scope,
    call,
    dependencies,
    state: "pending",
    createdAt: Date.now(),
    attempts: 0,
    delivery: "unsubmitted",
  };
  let captured = entry;
  await changeModuleStorage(platform, scope, async (s) => {
    if (!authorized(s))
      throw Error("Current access does not allow saving this change.");
    if (
      recovery &&
      !recovery.supersedes &&
      recovery.draftKey.split("/").length === 2 &&
      (s.draftGenerations?.[recovery.draftKey] ?? 0) !==
        (recovery.generation ?? 0)
    )
      throw new JournalConflictError(
        "This draft was moved or submitted in another view. Reopen its saved review before continuing.",
      );
    if (
      recovery?.draftKey.includes("/review/direct/") &&
      !s.drafts[recovery.draftKey]
    )
      throw new JournalConflictError(
        "This saved review was already moved or submitted in another view.",
      );
    const draftRecovery =
      recovery && s.draftReviews?.[recovery.draftKey]?.collision;
    if (
      draftRecovery &&
      (!draftRecovery.ready ||
        !s.journal.some(
          (entry) =>
            entry.id === draftRecovery.parentId &&
            entry.userId === scope.userId &&
            entry.workspaceId === scope.workspaceId &&
            entry.state === "accepted",
        ))
    )
      throw new JournalConflictError(
        "Review this draft after its prerequisite is accepted before submitting it.",
      );
    const existing = s.journal.find((e) => e.id === entry.id);
    if (
      existing &&
      (existing.userId !== scope.userId ||
        existing.workspaceId !== scope.workspaceId ||
        canonical(existing.call) !== canonical(call))
    )
      throw new JournalConflictError(
        "This retry identity already belongs to different content.",
      );
    if (existing) captured = structuredClone(existing);
    if (
      existing &&
      (call.action === "operation" ||
        existing.requestedDependencies !== undefined ||
        existing.captureDependencies !== undefined) &&
      canonical(
        [
          ...(existing.captureDependencies ??
            existing.requestedDependencies ??
            existing.dependencies),
        ].sort(),
      ) !== canonical([...dependencies].sort())
    )
      throw new JournalConflictError(
        "This retry identity already has different prerequisites.",
      );
    const replaced = recovery?.supersedes
      ? s.journal.find((e) => e.id === recovery.supersedes)
      : undefined;
    if (
      recovery?.supersedes &&
      (!replaced ||
        replaced.userId !== scope.userId ||
        replaced.workspaceId !== scope.workspaceId ||
        !["conflict", "rejected"].includes(replaced.state) ||
        (replaced.supersededBy && replaced.supersededBy !== entry.id))
    )
      throw new JournalConflictError(
        "Only a rejected or conflicting change can be replaced. Retry an uncertain request with its original identity.",
      );
    if (
      replaced &&
      (replaced.call.moduleId !== call.moduleId ||
        replaced.call.operation !== call.operation ||
        replaced.call.resource !== call.resource ||
        replaced.call.action !== call.action ||
        (call.action !== "operation" &&
          (replaced.recordRecovery?.targetId ??
            (replaced.call.input as { id?: unknown } | null)?.id) !==
            (call.input as { id?: unknown } | null)?.id))
    )
      throw new JournalConflictError(
        "A reviewed change must preserve its original record target.",
      );
    if (replaced && call.action === "operation")
      throw new JournalConflictError(
        "Use authoritative command recovery before replacing a saved command.",
      );
    if (
      (replaced?.recordRecovery || replaced?.createRecovery?.length) &&
      replaced.dependencies.some(
        (id) =>
          !s.journal.some(
            (e) =>
              e.id === id &&
              e.userId === scope.userId &&
              e.workspaceId === scope.workspaceId &&
              e.state === "accepted",
          ),
      )
    )
      throw new JournalConflictError(
        "Wait for prerequisite changes before reviewing this saved edit.",
      );
    if (replaced?.createRecovery?.length) {
      if (
        replaced.settlement !== "cancelled" ||
        canonical(recovery?.createRecovery ?? []) !==
          canonical(replaced.createRecovery)
      )
        throw new JournalConflictError(
          "A prerequisite record changed. Reopen and save the current review before submitting this change.",
        );
      if (
        s.journal.some(
          (child) =>
            child.userId === scope.userId &&
            child.workspaceId === scope.workspaceId &&
            !child.supersededBy &&
            child.state !== "accepted" &&
            child.dependencies.includes(replaced.id) &&
            !(child.delivery === "unsubmitted" && child.attempts === 0) &&
            !(
              child.state === "conflict" &&
              child.createRecovery?.length &&
              child.settlement === "cancelled"
            ),
        )
      )
        throw new JournalConflictError(
          "Recover dependent outcomes before replacing this saved change.",
        );
    }
    if (!s.journal.some((e) => e.id === entry.id)) {
      const { contract, module } = await responseContract(s, call);
      if (call.action === "operation") {
        const op = call.operation && module.operations[call.operation];
        if (
          !op ||
          op.policy !== "queued" ||
          op.kind === "query" ||
          op.serviceOnly ||
          call.resource ||
          call.kind
        )
          throw new JournalConflictError(
            "Only a client queued command can be captured.",
          );
        assertSchema(op.input, call.input);
        assertSchema(RequestKeySchema, entry.id);
        assertSchema(
          Type.Array(RequestKeySchema, { maxItems: 100, uniqueItems: true }),
          dependencies,
        );
      }
      entry.captureDependencies = [...dependencies];
      entry.requestedDependencies = [...dependencies];
      const schema =
        call.action === "operation"
          ? module.operations[call.operation!].input
          : call.resource && module.resources[call.resource]?.schema;
      if (schema)
        entry.dependencies = [
          ...new Set([
            ...dependencies,
            ...(replaced?.dependencies ?? []),
            // A review occupies the original position; later writes already wait
            // for it and must not become its own prerequisites.
            ...(replaced ? [] : recordDependencies(call, s.journal, scope)),
            ...referenceDependencies(schema, call, s.journal, scope),
          ]),
        ];
      (s.responseContracts ??= {})[responseContractKey(call)] = contract;
      if (call.action === "operation")
        assertSchema(
          Type.Array(RequestKeySchema, { maxItems: 100, uniqueItems: true }),
          entry.dependencies,
        );
    }
    if (!s.journal.some((e) => e.id === entry.id)) s.journal.push(entry);
    if (recovery) {
      if (replaced) {
        if (call.resource)
          removeResourceDraft(
            s,
            resourceDraftKey(call.moduleId, call.resource, {
              entryId: replaced.id,
            }),
          );
        // An older caller may still identify the legacy shared slot.
        if (s.draftReviews?.[recovery.draftKey]?.entryId === replaced.id)
          removeResourceDraft(s, recovery.draftKey);
      } else removeResourceDraft(s, recovery.draftKey);
      if (recovery.supersedes)
        s.journal = s.journal.map((e) =>
          e.userId !== scope.userId ||
          e.workspaceId !== scope.workspaceId ||
          e.state === "accepted" ||
          e.supersededBy
            ? e
            : e.id === recovery.supersedes
              ? { ...e, supersededBy: entry.id }
              : {
                  ...e,
                  dependencies: e.dependencies.map((id) =>
                    id === recovery.supersedes ? entry.id : id,
                  ),
                  ...(e.requestedDependencies?.includes(recovery.supersedes!)
                    ? {
                        captureDependencies: e.captureDependencies ?? [
                          ...e.requestedDependencies,
                        ],
                        requestedDependencies: e.requestedDependencies.map(
                          (id) => (id === recovery.supersedes ? entry.id : id),
                        ),
                      }
                    : {}),
                },
        );
    }
    assertJournalOrder(s.journal, scope);
    if (!authorized(s))
      throw Error("Current access changed before this change could be saved.");
  });
  return captured;
}
export async function syncModuleStorage(
  platform: Platform,
  scope: Scope,
  send: (call: ModuleCall) => Promise<unknown>,
  authorized: () => boolean,
  eligible: (call: ModuleCall) => boolean = () => true,
) {
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      await flushJournal(
        {
          list: async () =>
            (await readModuleStorage(platform, scope)).journal.filter(
              (entry) =>
                entry.userId === scope.userId &&
                entry.workspaceId === scope.workspaceId,
            ),
          put: async (entry) => {
            await changeModuleStorage(platform, scope, (s) => {
              s.journal = s.journal.map((e) =>
                e.id === entry.id &&
                e.userId === scope.userId &&
                e.workspaceId === scope.workspaceId
                  ? entry
                  : e,
              );
            });
          },
        },
        async (call) => {
          const state = await readModuleStorage(platform, scope);
          const { contract, module } = await responseContract(state, call);
          // Persist a legacy or repaired entry's exact contract before dispatch.
          if (state.responseContracts?.[responseContractKey(call)] !== contract)
            await changeModuleStorage(platform, scope, (s) => {
              (s.responseContracts ??= {})[responseContractKey(call)] =
                contract;
            });
          let result: unknown;
          try {
            if (!authorized() || !eligible(call))
              throw Error(
                "Current access changed before synchronization. Your change is retained.",
              );
            result = await send(call);
          } catch (error) {
            validateModuleError(module, call, error);
            throw error;
          }
          validateModuleResponse(module, call, result);
          return result;
        },
        authorized,
        eligible,
      );
    },
  );
}
