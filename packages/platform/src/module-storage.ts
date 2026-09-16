import type { Platform, Scope } from "./index";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import type {
  ModuleCall,
  ResourcePage,
  ResourceRecord,
} from "@suite/module-sdk";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";
export interface ModuleStorage {
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
export async function readModuleStorage(platform: Platform, scope: Scope) {
  return (await platform.load<ModuleStorage>(scope, "module-state")) ?? empty();
}
export async function changeModuleStorage(
  platform: Platform,
  scope: Scope,
  fn: (state: ModuleStorage) => void | Promise<void>,
) {
  const change = async () => {
    const state = await readModuleStorage(platform, scope);
    await fn(state);
    await platform.save(scope, "module-state", state);
    return state;
  };
  return navigator.locks.request(
    `suite-modules:${scope.userId}:${scope.workspaceId}`,
    change,
  );
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
  };
  await changeModuleStorage(platform, scope, (s) => {
    if (!s.journal.some((e) => e.id === entry.id)) s.journal.push(entry);
    if (recovery) {
      delete s.drafts[recovery.draftKey];
      if (s.draftTargets) delete s.draftTargets[recovery.draftKey];
      if (recovery.supersedes)
        s.journal = s.journal.map((e) =>
          e.id === recovery.supersedes
            ? { ...e, supersededBy: entry.id }
            : {
                ...e,
                dependencies: e.dependencies.map((id) =>
                  id === recovery.supersedes ? entry.id : id,
                ),
              },
        );
    }
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
          list: async () => (await readModuleStorage(platform, scope)).journal,
          put: async (entry) => {
            await changeModuleStorage(platform, scope, (s) => {
              s.journal = s.journal.map((e) => (e.id === entry.id ? entry : e));
            });
          },
        },
        send,
        authorized,
      );
    },
  );
}
