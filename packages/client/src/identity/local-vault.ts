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
}

const database = () =>
  openDB("suite-local-profiles", 1, {
    upgrade(db) {
      db.createObjectStore("vaults", { keyPath: "id" });
    },
  });

async function derive(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: 600000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const encrypt = (
  vault: Pick<LocalVault, "id">,
  key: CryptoKey,
  value: unknown,
  iv: Uint8Array,
) =>
  crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as Uint8Array<ArrayBuffer>,
      additionalData: new TextEncoder().encode(vault.id),
    },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );

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
function changed(id: string) {
  for (const listener of listeners) listener(id);
  const sender = new BroadcastChannel("suite-local-profiles");
  sender.postMessage({ id, origin });
  sender.close();
}
export async function listLocalProfiles() {
  return ((await (await database()).getAll("vaults")) as LocalVault[])
    .filter((vault) => vault.removedAt === undefined)
    .map(({ id, name }) => ({ id, name }));
}
export async function listRemovedLocalProfiles() {
  return ((await (await database()).getAll("vaults")) as LocalVault[])
    .filter((vault) => vault.removedAt !== undefined)
    .map(({ id, name, removedAt }) => ({ id, name, removedAt: removedAt! }));
}
/** Removal retains encrypted work and fences every earlier unlocked writer. */
export async function removeLocalProfile(id: string) {
  const tx = (await database()).transaction("vaults", "readwrite");
  const vault = (await tx.store.get(id)) as LocalVault | undefined;
  if (!vault) {
    await tx.done;
    throw Error("Local profile not found.");
  }
  if (vault.removedAt === undefined)
    await tx.store.put({
      ...vault,
      removedAt: Date.now(),
      revision: (vault.revision ?? 0) + 1,
    });
  await tx.done;
  changed(id);
}

export async function createVault(
  name: string,
  password: string,
  data: unknown,
) {
  if (name.trim().length < 1 || name.length > 100 || password.length < 12)
    throw Error("Enter a name and a passphrase of at least 12 characters.");
  const vault: LocalVault = {
    id: crypto.randomUUID(),
    name: name.trim(),
    salt: crypto.getRandomValues(new Uint8Array(16)),
    iv: crypto.getRandomValues(new Uint8Array(12)),
    ciphertext: new ArrayBuffer(0),
    updatedAt: Date.now(),
    revision: 0,
  };
  const key = await derive(password, vault.salt);
  vault.ciphertext = await encrypt(vault, key, data, vault.iv);
  await (await database()).add("vaults", vault);
  changed(vault.id);
  return { vault, key };
}

async function decryptVault<T>(vault: LocalVault, password: string) {
  try {
    const key = await derive(password, vault.salt);
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: vault.iv as Uint8Array<ArrayBuffer>,
        additionalData: new TextEncoder().encode(vault.id),
      },
      key,
      vault.ciphertext,
    );
    return {
      vault,
      key,
      data: JSON.parse(new TextDecoder().decode(bytes)) as T,
    };
  } catch {
    throw Error(
      "The local profile could not be unlocked. Check the passphrase.",
    );
  }
}

export async function unlockVault<T>(id: string, password: string) {
  const vault = (await (await database()).get("vaults", id)) as
    LocalVault | undefined;
  if (!vault) throw Error("Local profile not found.");
  if (vault.removedAt !== undefined)
    throw Error("Restore this removed profile before unlocking it.");
  const result = await decryptVault<T>(vault, password);
  await assertVaultRevision(vault, vault.revision ?? 0);
  return result;
}
export async function restoreVault<T>(
  id: string,
  password: string,
  signal?: AbortSignal,
) {
  const connection = await database();
  const vault = (await connection.get("vaults", id)) as LocalVault | undefined;
  if (!vault || vault.removedAt === undefined)
    throw Error("This profile is not available for restoration.");
  const result = await decryptVault<T>(vault, password);
  signal?.throwIfAborted();
  const tx = connection.transaction("vaults", "readwrite");
  const stored = (await tx.store.get(id)) as LocalVault | undefined;
  if (
    signal?.aborted ||
    !stored ||
    stored.removedAt === undefined ||
    (stored.revision ?? 0) !== (vault.revision ?? 0)
  ) {
    tx.abort();
    await tx.done.catch(() => {});
    signal?.throwIfAborted();
    throw new LocalExecutionError(
      "PROFILE_CHANGED",
      "The profile changed during restoration. Choose it again.",
    );
  }
  const restored: LocalVault = {
    ...stored,
    removedAt: undefined,
    revision: (stored.revision ?? 0) + 1,
    updatedAt: Date.now(),
  };
  await tx.store.put(restored);
  await tx.done;
  changed(id);
  return { ...result, vault: restored };
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

export async function commitVault(
  vault: LocalVault,
  key: CryptoKey,
  value: unknown,
  revision: number,
  signal: AbortSignal | undefined,
  isUnlocked: () => boolean,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await encrypt(vault, key, value, iv);
  if (!isUnlocked())
    throw new LocalExecutionError(
      "PROFILE_LOCKED",
      "The profile was locked before this change was saved.",
    );
  if (signal?.aborted)
    throw new LocalExecutionError(
      "LOCAL_CANCELLED",
      "The local operation was cancelled.",
    );
  const connection = await database();
  const transaction = connection.transaction("vaults", "readwrite");
  const stored = (await transaction.store.get(vault.id)) as
    LocalVault | undefined;
  if (
    !isUnlocked() ||
    signal?.aborted ||
    !stored ||
    stored.removedAt !== undefined ||
    (stored.revision ?? 0) !== revision
  ) {
    transaction.abort();
    await transaction.done.catch(() => {});
    if (!isUnlocked())
      throw new LocalExecutionError(
        "PROFILE_LOCKED",
        "Unlock the local profile.",
      );
    if (signal?.aborted)
      throw new LocalExecutionError(
        "LOCAL_CANCELLED",
        "The local operation was cancelled.",
      );
    throw new LocalExecutionError(
      "PROFILE_CHANGED",
      "This profile changed in another window or was removed. Unlock it again before saving.",
    );
  }
  await transaction.store.put({
    ...vault,
    iv,
    ciphertext,
    updatedAt: Date.now(),
    revision: revision + 1,
  });
  await transaction.done;
  return revision + 1;
}
