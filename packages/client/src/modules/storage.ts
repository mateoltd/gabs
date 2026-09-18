import {
  responseContract,
  responseContractKey,
  validateModuleResponse,
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
  ResourcePage,
  ResourceRecord,
  FieldReview,
} from "@suite/module-sdk";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";
import {
  assertJournalOrder,
  referenceDependencies,
  JournalConflictError,
} from "./journal";
import { canonical } from "@suite/module-sdk/registry";
export { pendingReferenceOptions } from "./journal";
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
export interface ModuleStorage {
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
  pages: Record<string, ResourcePage>;
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
  draftTargets?: Record<string, ResourceRecord | null>;
  draftReviews?: Record<string, { entryId?: string; comparison?: FieldReview }>;
  referenceOptions?: Record<
    string,
    Record<string, { value: string; label: string }[]>
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
  return stored ? hydrateModuleArtifacts(platform, scope, stored) : empty();
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
    await fn(state);
    const stored = await persistModuleArtifacts(platform, scope, state);
    // This single durable write commits the release set and journal together, after all bytes exist.
    await platform.save(scope, "module-state", stored);
    return state;
  };
  return navigator.locks.request(lockKey(scope), change);
}
export async function enqueue(
  platform: Platform,
  scope: Scope,
  call: ModuleCall,
  dependencies: string[] = [],
  recovery?: { draftKey: string; supersedes?: string },
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
  await changeModuleStorage(platform, scope, async (s) => {
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
        replaced.call.resource !== call.resource ||
        replaced.call.action !== call.action ||
        (replaced.call.input as { id?: unknown }).id !==
          (call.input as { id?: unknown }).id)
    )
      throw new JournalConflictError(
        "A reviewed change must preserve its original record target.",
      );
    if (!s.journal.some((e) => e.id === entry.id)) {
      const { contract, module } = await responseContract(s, call);
      const schema = call.resource && module.resources[call.resource]?.schema;
      if (schema)
        entry.dependencies = [
          ...new Set([
            ...dependencies,
            ...(replaced?.dependencies ?? []),
            ...referenceDependencies(schema, call, s.journal, scope),
          ]),
        ];
      (s.responseContracts ??= {})[responseContractKey(call)] = contract;
    }
    if (!s.journal.some((e) => e.id === entry.id)) s.journal.push(entry);
    if (recovery) {
      delete s.drafts[recovery.draftKey];
      if (s.draftTargets) delete s.draftTargets[recovery.draftKey];
      if (s.draftReviews) delete s.draftReviews[recovery.draftKey];
      if (recovery.supersedes)
        s.journal = s.journal.map((e) =>
          e.userId !== scope.userId || e.workspaceId !== scope.workspaceId
            ? e
            : e.id === recovery.supersedes
              ? { ...e, supersededBy: entry.id }
              : {
                  ...e,
                  dependencies: e.dependencies.map((id) =>
                    id === recovery.supersedes ? entry.id : id,
                  ),
                },
        );
    }
    assertJournalOrder(s.journal, scope);
  });
  return entry;
}
export async function syncModuleStorage(
  platform: Platform,
  scope: Scope,
  send: (call: ModuleCall) => Promise<unknown>,
  authorized: () => boolean,
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
          const result = await send(call);
          validateModuleResponse(module, call, result);
          return result;
        },
        authorized,
      );
    },
  );
}
