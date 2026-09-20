import { openDB, type DBSchema } from "idb";
import type { LocalVault, LocalVaultStore } from "./contracts";
export type { LocalVault } from "./contracts";

interface LocalVaultDatabase extends DBSchema {
  vaults: { key: string; value: LocalVault };
}

export const openLocalVaultDatabase = () =>
  openDB<LocalVaultDatabase>("suite-local-profiles", 1, {
    upgrade(db) {
      db.createObjectStore("vaults", { keyPath: "id" });
    },
  });

type ProfileChange = { id: string; origin: string };
const origin = crypto.randomUUID();
const listeners = new Set<(id: string) => void>();
let channel: BroadcastChannel | undefined;

export function subscribeLocalProfiles(listener: (id: string) => void) {
  listeners.add(listener);
  if (!channel) {
    channel = new BroadcastChannel("suite-local-profiles");
    channel.onmessage = (event: MessageEvent<ProfileChange>) => {
      if (event.data?.origin !== origin && typeof event.data?.id === "string")
        for (const notify of listeners) notify(event.data.id);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      channel?.close();
      channel = undefined;
    }
  };
}

export function notifyLocalProfileChanged(id: string) {
  for (const listener of listeners) listener(id);
  const sender = new BroadcastChannel("suite-local-profiles");
  sender.postMessage({ id, origin });
  sender.close();
}

export const browserVaultStore: LocalVaultStore = {
  async get(id) {
    return (await openLocalVaultDatabase()).get("vaults", id);
  },
  async list() {
    return (await openLocalVaultDatabase()).getAll("vaults");
  },
  async add(vault) {
    await (await openLocalVaultDatabase()).add("vaults", vault);
  },
  async update(id, change) {
    const tx = (await openLocalVaultDatabase()).transaction(
      "vaults",
      "readwrite",
    );
    try {
      const next = change(await tx.store.get(id));
      if (next.id !== id)
        throw Error("A vault update cannot change its profile.");
      await tx.store.put(next);
      await tx.done;
      return next;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  },
  exclusive: async (id, run) =>
    await navigator.locks.request(`suite-local-unlock:${id}`, run),
  changed: notifyLocalProfileChanged,
};
