import { LocalExecutionError } from "@suite/module-sdk/local";
import { openDB, type DBSchema } from "idb";

export interface LocalVault {
  id: string;
  name: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
  revision?: number;
  removedAt?: number;
}

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

export async function assertVaultRevision(vault: LocalVault, revision: number) {
  const connection = await openLocalVaultDatabase();
  const stored = await connection.get("vaults", vault.id);
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
