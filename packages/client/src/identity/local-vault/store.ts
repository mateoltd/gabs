import { LocalExecutionError } from "@suite/module-sdk/local";
import { openDB } from "idb";
export interface LocalVault {
  id: string;
  name: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
  revision?: number;
  removedAt?: number;
  unlock?: string;
}

export const database = () =>
  openDB("suite-local-profiles", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("vaults")) db.createObjectStore("vaults", { keyPath: "id" });
      if (!db.objectStoreNames.contains("unlocks")) db.createObjectStore("unlocks", { keyPath: "id" });
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
export function changed(id: string) {
  for (const listener of listeners) listener(id);
  const sender = new BroadcastChannel("suite-local-profiles");
  sender.postMessage({ id, origin });
  sender.close();
}
export async function assertVaultRevision(vault: LocalVault, revision: number) {
  const stored = (await (await database()).get("vaults", vault.id)) as
    LocalVault | undefined;
  if (
    !stored ||
    stored.removedAt !== undefined ||
    (stored.revision ?? 0) !== revision
  )
    throw new LocalExecutionError(
      "PROFILE_CHANGED",
      "This profile changed in another window or was removed. Unlock it again before using module access.",
    );
}

