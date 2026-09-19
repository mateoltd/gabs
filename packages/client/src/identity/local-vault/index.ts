import { LocalExecutionError } from "@suite/module-sdk/local";
import { decryptVault, derive, encrypt } from "./crypto";
import {
  assertVaultRevision,
  notifyLocalProfileChanged,
  openLocalVaultDatabase,
  type LocalVault,
} from "./store";

export {
  assertVaultRevision,
  subscribeLocalProfiles,
  type LocalVault,
} from "./store";

export async function listLocalProfiles() {
  const connection = await openLocalVaultDatabase();
  return (await connection.getAll("vaults"))
    .filter((vault) => vault.removedAt === undefined)
    .map(({ id, name }) => ({ id, name }));
}

export async function listRemovedLocalProfiles() {
  const connection = await openLocalVaultDatabase();
  return (await connection.getAll("vaults"))
    .filter((vault) => vault.removedAt !== undefined)
    .map(({ id, name, removedAt }) => ({ id, name, removedAt: removedAt! }));
}

/** Removal retains encrypted work and fences every earlier unlocked writer. */
export async function removeLocalProfile(id: string) {
  const tx = (await openLocalVaultDatabase()).transaction(
    "vaults",
    "readwrite",
  );
  const vault = await tx.store.get(id);
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
  notifyLocalProfileChanged(id);
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
  await (await openLocalVaultDatabase()).add("vaults", vault);
  notifyLocalProfileChanged(vault.id);
  return { vault, key };
}

export async function unlockVault<T>(id: string, password: string) {
  const connection = await openLocalVaultDatabase();
  const vault = await connection.get("vaults", id);
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
  const connection = await openLocalVaultDatabase();
  const vault = await connection.get("vaults", id);
  if (!vault || vault.removedAt === undefined)
    throw Error("This profile is not available for restoration.");
  const result = await decryptVault<T>(vault, password);
  signal?.throwIfAborted();
  const tx = connection.transaction("vaults", "readwrite");
  const stored = await tx.store.get(id);
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
  notifyLocalProfileChanged(id);
  return { ...result, vault: restored };
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
  const connection = await openLocalVaultDatabase();
  const transaction = connection.transaction("vaults", "readwrite");
  const stored = await transaction.store.get(vault.id);
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
