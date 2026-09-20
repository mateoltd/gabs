import { authorizeRecoveryExport } from "./recovery-export";
import { sealSavedWorkArchive } from "../recovery/archive/crypto";
import type { SavedWorkArchive } from "../recovery/archive/format";
import { validateRecoveryInput } from "../recovery/input";
import { assertSchema, Type, type ModuleDefinition } from "@suite/module-sdk";
import { hostCapabilitySchemas } from "@suite/module-sdk/host-capabilities";
import { ApiError, type SuiteClient } from "../api";
import { openDB } from "idb";
import {
  assertWorkspacePurgeable,
  assertWorkspaceCacheWrite,
  disabledWorkspaceAuthority,
} from "../offline/storage-retention";
import type { Platform, Scope, CacheKey, RememberedIdentity } from "../index";
import { CorporateCapabilityLeases } from "../identity/capability-leases";
import { getBrowserProfileLock } from "./browser-profile-lock";
const db = () =>
  openDB("suite-offline-v1", 1, {
    upgrade(db) {
      db.createObjectStore("records");
    },
  });
const key = (scope: Scope, kind: CacheKey) =>
  `${scope.userId}/${scope.workspaceId}/${kind}`;
// The same account/workspace prefix makes existing logout and workspace purges remove grants too.
const leaseKey = (scope: Scope) =>
  `${scope.userId}/${scope.workspaceId}/capability-leases`;
// Public issuer trust survives account removal. It contains no user or workspace data.
const leaseTrustKey = "capability-issuer-trust";
const withLeaseTrust = async <T>(task: () => Promise<T>) =>
  navigator.locks.request("suite-capability-leases", task);
export const browserCapabilityLeases = new CorporateCapabilityLeases({
  load: async (scope) => (await db()).get("records", leaseKey(scope)),
  save: async (scope, value) => {
    await (await db()).put("records", value, leaseKey(scope));
  },
  loadTrust: async () => (await db()).get("records", leaseTrustKey),
  saveTrust: async (value) => {
    await (await db()).put("records", value, leaseTrustKey);
  },
  exclusive: (_scope, task) => withLeaseTrust(task),
});
/** Changing credentials expires old leases without deleting any account's saved work. */
export async function invalidateBrowserAccount(
  userId: string,
  signedOut = false,
) {
  await (
    await db()
  ).put("records", crypto.randomUUID(), `${userId}/account-revision`);
  const channel = new BroadcastChannel(`suite-account:${userId}`);
  channel.postMessage(signedOut ? "signed-out" : "invalidated");
  channel.close();
}
export function subscribeBrowserAccount(
  userId: string,
  invalidate: (signedOut: boolean) => void,
) {
  const channel = new BroadcastChannel(`suite-account:${userId}`);
  channel.onmessage = (event) => {
    if (["invalidated", "signed-out"].includes(event.data))
      invalidate(event.data === "signed-out");
  };
  return () => channel.close();
}
const storedPlatform: Platform = {
  kind: "web",
  accountRevision: async (userId) =>
    (await (await db()).get("records", `${userId}/account-revision`)) ??
    "initial",
  async load<T>(scope: Scope, kind: CacheKey) {
    return (await db()).get("records", key(scope, kind)) as Promise<
      T | undefined
    >;
  },
  async save(scope, kind, value) {
    const tx = (await db()).transaction("records", "readwrite");
    try {
      assertWorkspaceCacheWrite(
        await tx.store.get(key(scope, "workspace-authority")),
        kind,
        value,
      );
      await tx.store.put(value, key(scope, kind));
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await tx.done.catch(() => {});
      throw error;
    }
  },
  async pruneModuleArtifacts(scope, keep) {
    const store = await db();
    const tx = store.transaction("records", "readwrite");
    const prefix = `${scope.userId}/${scope.workspaceId}/module-artifact/`;
    const retained = new Set(keep.map((k) => key(scope, k)));
    for (const k of await tx.store.getAllKeys(
      IDBKeyRange.bound(prefix, prefix + "\uffff"),
    ))
      if (!retained.has(String(k))) await tx.store.delete(k);
    await tx.done;
  },
  async purgeWorkspace(scope) {
    await withLeaseTrust(async () => {
      const store = await db();
      const tx = store.transaction("records", "readwrite");
      try {
        assertWorkspacePurgeable({
          drafts: await tx.store.get(key(scope, "drafts")),
          pending: await tx.store.get(key(scope, "pending")),
          modules: await tx.store.get(key(scope, "module-state")),
        });
        for (const k of await tx.store.getAllKeys())
          if (String(k).startsWith(`${scope.userId}/${scope.workspaceId}/`))
            await tx.store.delete(k);
        await tx.store.put(
          disabledWorkspaceAuthority(),
          key(scope, "workspace-authority"),
        );
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
      }
    });
  },
  async purgeUser(userId) {
    await withLeaseTrust(async () => {
      const store = await db();
      const tx = store.transaction("records", "readwrite");
      for (const k of await tx.store.getAllKeys())
        if (String(k).startsWith(userId + "/")) await tx.store.delete(k);
      await tx.store.delete("identity");
      await tx.done;
    });
  },
  async identity() {
    return (await db()).get("records", "identity") as Promise<
      RememberedIdentity | undefined
    >;
  },
  async rememberIdentity(identity) {
    const store = await db();
    if (identity) await store.put("records", identity, "identity");
    else await store.delete("records", "identity");
  },
  async saveFile(filename, content) {
    const url = URL.createObjectURL(
      new Blob([content], {
        type: filename.endsWith(".json")
          ? "application/json;charset=utf-8"
          : filename.endsWith(".csv")
            ? "text/csv;charset=utf-8"
            : "text/plain;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async notify(title, message) {
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(title, { body: message });
  },
};
export const browserPlatform: Platform = {
  ...storedPlatform,
  rememberIdentity: (identity) =>
    identity
      ? getBrowserProfileLock().withAccess(identity.userId, () =>
          storedPlatform.rememberIdentity(identity),
        )
      : storedPlatform.rememberIdentity(undefined),
  load: <T>(scope: Scope, kind: CacheKey) =>
    getBrowserProfileLock().withAccess(scope.userId, () =>
      storedPlatform.load<T>(scope, kind),
    ),
  save: (scope, kind, value) =>
    getBrowserProfileLock().withAccess(scope.userId, () =>
      storedPlatform.save(scope, kind, value),
    ),
  pruneModuleArtifacts: (scope, keep) =>
    getBrowserProfileLock().withAccess(scope.userId, () =>
      storedPlatform.pruneModuleArtifacts(scope, keep),
    ),
  purgeWorkspace: (scope) =>
    getBrowserProfileLock().withAccess(scope.userId, () =>
      storedPlatform.purgeWorkspace(scope),
    ),
  purgeUser: (userId) =>
    getBrowserProfileLock().withAccess(userId, () =>
      storedPlatform.purgeUser(userId),
    ),
};
export function getPlatform(): Platform {
  const native = window.suiteDesktop;
  if (!native) return browserPlatform;
  return {
    kind: "desktop",
    accountRevision: (userId) => native.accountRevision(userId),
    load: <T>(s: Scope, k: CacheKey) =>
      native.cacheRead(s, k) as Promise<T | undefined>,
    save: (s, k, v) => native.cacheWrite(s, k, v),
    pruneModuleArtifacts: (s, keep) => native.cachePruneArtifacts(s, keep),
    purgeWorkspace: (s) => native.cachePurge(s),
    purgeUser: (userId) => native.cachePurge({ userId }),
    identity: () => native.identity(),
    rememberIdentity: (i) => native.rememberIdentity(i),
    saveFile: (f, c) => native.saveFile(f, c),
    notify: (t, m) => native.notify(t, m),
  };
}

/** Host-owned export-job delivery, scoped to the mounted official module view. */
export async function downloadCorporateExport(options: {
  client: SuiteClient;
  scope: Scope;
  moduleVersion: string;
  id: string;
  signal: AbortSignal;
  check(): void;
}) {
  const check = () => {
    options.signal.throwIfAborted();
    options.check();
  };
  check();
  const native = window.suiteDesktop;
  if (native) {
    const handle = await native.openModuleHost(
      options.scope,
      "orders",
      options.moduleVersion,
    );
    const close = () => {
      void native.closeModuleHost(handle).catch(() => {});
    };
    options.signal.addEventListener("abort", close, { once: true });
    try {
      check();
      return await native.downloadExport(handle, options.id);
    } finally {
      options.signal.removeEventListener("abort", close);
      await native.closeModuleHost(handle);
    }
  }
  const params = { workspaceId: options.scope.workspaceId, id: options.id };
  const file = await options.client.request(
    { operation: "exportDownload", params },
    { signal: options.signal },
  );
  check();
  assertSchema(hostCapabilitySchemas["files.export"].input, file);
  const metadata = await options.client.request(
    { operation: "exportAuthorize", params },
    { signal: options.signal },
  );
  check();
  assertSchema(
    Type.Object({ filename: Type.Literal(`orders-${options.id}.csv`) }),
    metadata,
  );
  if (file.filename !== metadata.filename)
    throw Error("The export identity changed while saving.");
  await getBrowserProfileLock().withAccess(options.scope.userId, () =>
    browserPlatform.saveFile(file.filename, file.content),
  );
  return { status: "offered" as const };
}

/** Recovery input is scoped to a live view; the native host independently repeats authorization. */
export async function saveWorkArchive(options: {
  archive: SavedWorkArchive;
  passphrase: string;
  signal: AbortSignal;
  check(): void;
}) {
  const check = () => {
    options.signal.throwIfAborted();
    options.check();
  };
  check();
  const native = window.suiteDesktop;
  if (native) {
    const first = options.archive.copies[0];
    if (!first) throw Error("Select saved work before exporting.");
    const handle = await native.openModuleHost(
      { userId: first.userId, workspaceId: first.workspaceId },
      first.moduleId,
      first.moduleVersion,
    );
    const close = () => {
      void native.closeModuleHost(handle).catch(() => {});
    };
    options.signal.addEventListener("abort", close, { once: true });
    try {
      check();
      return await native.exportWorkArchive(
        handle,
        JSON.stringify(options.archive),
        options.passphrase,
      );
    } finally {
      options.signal.removeEventListener("abort", close);
      await native.closeModuleHost(handle);
    }
  }
  const content = await sealSavedWorkArchive(
    options.archive,
    options.passphrase,
    check,
  );
  await getBrowserProfileLock().withAccess(options.archive.userId, () => {
    check();
    return browserPlatform.saveFile(
      `saved-work-archive-${crypto.randomUUID()}.json`,
      content,
    );
  });
  return { status: "offered" as const };
}

export async function exportRecoveryInput(options: {
  client: SuiteClient;
  input:
    | import("@suite/module-sdk/platform").ModuleInputRecovery
    | import("@suite/module-sdk/platform").SavedWorkRecovery;
  signal: AbortSignal;
  access(): {
    policy: import("@suite/contracts").Bootstrap;
    dependencies: readonly string[];
    online: boolean;
    offlineEnabled: boolean;
    module?: ModuleDefinition;
  };
  receivePolicy(
    policy: import("@suite/contracts").Bootstrap,
    signal: AbortSignal,
  ): Promise<import("@suite/contracts").Bootstrap>;
  onError(error: unknown): void;
  check(): void;
}) {
  const { input, signal } = options;
  const check = () => {
    signal.throwIfAborted();
    options.check();
  };
  check();
  validateRecoveryInput(input, input, input.moduleId);
  const native = window.suiteDesktop;
  if (native) {
    const handle = await native.openModuleHost(
      { userId: input.userId, workspaceId: input.workspaceId },
      input.moduleId,
      input.moduleVersion,
    );
    const close = () => {
      void native.closeModuleHost(handle).catch(() => {});
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      check();
      await native.exportInput(handle, input);
    } finally {
      signal.removeEventListener("abort", close);
      await native.closeModuleHost(handle);
    }
    return;
  }
  const authorize = await authorizeRecoveryExport({
    ...options,
    platform: browserPlatform,
  });
  authorize();
  await getBrowserProfileLock().withAccess(input.userId, () => {
    authorize();
    return browserPlatform.saveFile(
      `${input.kind === "module-work-recovery" ? "saved-work" : "module-input"}-${crypto.randomUUID()}.json`,
      JSON.stringify(input, null, 2),
    );
  });
}
