import { savedWorkContracts } from "../recovery/work";
import { readModuleStorage } from "../modules/storage";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { checkRecoveryPolicy, validateRecoveryInput } from "../recovery/input";
import {
  assertSchema,
  Type,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
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
export const browserPlatform: Platform = {
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
  await browserPlatform.saveFile(file.filename, file.content);
  return { status: "offered" as const };
}

/** Recovery input is scoped to a live view; the native host independently repeats authorization. */
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
  let access = options.access();
  let policy = access.policy;
  let currentModule = access.module;
  const offline = !access.online || !navigator.onLine;
  if (!offline) {
    try {
      const me = await options.client.request({ operation: "me" }, { signal });
      check();
      if (me.user.id !== input.userId)
        throw new ApiError(
          401,
          "PROFILE_CHANGED",
          "This recovery profile is no longer active.",
        );
      policy = await options.client.request(
        { operation: "bootstrap", params: { workspaceId: input.workspaceId } },
        { signal },
      );
      check();
      policy = await options.receivePolicy(policy, signal);
      check();
      if (input.kind === "module-work-recovery") {
        const pkg = await options.client.request(
          {
            operation: "moduleArtifact",
            params: {
              workspaceId: input.workspaceId,
              moduleId: input.moduleId,
            },
          },
          { signal },
        );
        check();
        currentModule = hydrateModule(moduleContract(pkg.artifact));
      }
    } catch (error) {
      if (!signal.aborted) options.onError(error);
      throw error;
    }
  }
  access = options.access();
  const offlineNow = offline || !access.online || !navigator.onLine;
  const contracts =
    input.kind === "module-work-recovery" && currentModule
      ? {
          current: currentModule,
          originals: await savedWorkContracts(
            await readModuleStorage(browserPlatform, input),
            input,
          ),
        }
      : undefined;
  check();
  if (
    input.kind === "module-work-recovery" &&
    currentModule?.version !== options.access().module?.version
  )
    throw Error(
      "The recovery release changed. Refresh saved work before exporting.",
    );
  if (offlineNow && !access.offlineEnabled)
    throw Error("Reconnect to authorize recovery export.");
  if (offlineNow) {
    const snapshot = await browserPlatform.load<import("../index").Snapshot>(
      { userId: input.userId, workspaceId: input.workspaceId },
      "snapshot",
    );
    check();
    if (
      !snapshot ||
      snapshot.expiresAt <= Date.now() ||
      snapshot.cachedAt > Date.now()
    )
      throw Error("Offline recovery access expired. Reconnect to continue.");
    checkRecoveryPolicy(
      snapshot.bootstrap,
      input,
      access.dependencies,
      true,
      Date.now(),
      contracts,
    );
  }
  if (input.kind === "module-work-recovery" && !offlineNow) {
    const revision = policy.policyRevision;
    try {
      policy = await options.client.request(
        { operation: "bootstrap", params: { workspaceId: input.workspaceId } },
        { signal },
      );
      check();
      policy = await options.receivePolicy(policy, signal);
      check();
      access = options.access();
      if (policy.policyRevision !== revision)
        throw Error(
          "Workspace access changed while preparing this export. Refresh saved work and try again.",
        );
    } catch (error) {
      if (!signal.aborted) options.onError(error);
      throw error;
    }
  }
  checkRecoveryPolicy(
    policy,
    input,
    access.dependencies,
    offlineNow,
    Date.now(),
    contracts,
  );
  checkRecoveryPolicy(
    access.policy,
    input,
    access.dependencies,
    offlineNow,
    Date.now(),
    contracts,
  );
  check();
  await browserPlatform.saveFile(
    `${input.kind === "module-work-recovery" ? "saved-work" : "module-input"}-${crypto.randomUUID()}.json`,
    JSON.stringify(input, null, 2),
  );
}
