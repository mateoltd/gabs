import { openDB } from "idb";
import type { Platform, Scope, CacheKey, RememberedIdentity } from "../index";
const db = () =>
  openDB("suite-offline-v1", 1, {
    upgrade(db) {
      db.createObjectStore("records");
    },
  });
const key = (scope: Scope, kind: CacheKey) =>
  `${scope.userId}/${scope.workspaceId}/${kind}`;
export const browserPlatform: Platform = {
  kind: "web",
  async load<T>(scope: Scope, kind: CacheKey) {
    return (await db()).get("records", key(scope, kind)) as Promise<
      T | undefined
    >;
  },
  async save(scope, kind, value) {
    await (await db()).put("records", value, key(scope, kind));
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
    const store = await db();
    const tx = store.transaction("records", "readwrite");
    for (const k of await tx.store.getAllKeys())
      if (String(k).startsWith(`${scope.userId}/${scope.workspaceId}/`))
        await tx.store.delete(k);
    await tx.done;
  },
  async purgeUser(userId) {
    const store = await db();
    const tx = store.transaction("records", "readwrite");
    for (const k of await tx.store.getAllKeys())
      if (String(k).startsWith(userId + "/")) await tx.store.delete(k);
    await tx.done;
    await store.delete("records", "identity");
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
          : "text/csv;charset=utf-8",
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
