import { openDB, type DBSchema } from "idb";
import { SuiteClient } from "../api";
import { BrowserProfileLock } from "../identity/browser-profile-lock";
export type { BrowserRecoveryChallenge } from "../identity/browser-profile-lock";

interface LockDatabase extends DBSchema {
  policies: { key: string; value: string };
}

/** Origin-scoped persistence, shared write ordering and cross-tab invalidation. */
export function createBrowserProfileLock() {
  const database = openDB<LockDatabase>("suite-profile-lock-v1", 1, {
    upgrade(db) {
      db.createObjectStore("policies");
    },
  });
  // Opening can fail before the first call. Keep that rejection observable to callers.
  void database.catch(() => {});
  const channel = new BroadcastChannel("suite-profile-lock-v1");
  const lock = new BrowserProfileLock({
    async read(account) {
      const value = await (await database).get("policies", account);
      if (value !== undefined && typeof value !== "string")
        throw Error(
          "The browser profile store is unavailable. Restore the browser profile before continuing.",
        );
      return value;
    },
    async write(account, value) {
      await (await database).put("policies", JSON.stringify(value), account);
    },
    exclusive: async (account, run) =>
      await navigator.locks.request(`suite-profile-lock:${account}`, run),
    changed: (account) => channel.postMessage(account),
    recovery: () => new SuiteClient().request({ operation: "profileRecovery" }),
  });
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string") void lock.refresh(event.data);
  };
  return {
    lock,
    async close() {
      channel.close();
      await lock.activate();
      (await database).close();
    },
  };
}
