import { recoveredLocalData } from "./recovery";
export { vaultEnvelope } from "./envelope";
import { LocalExecutionError } from "@suite/module-sdk/local";
import { decryptVault, derive, encrypt } from "./crypto";
import { createQuickUnlockEngine } from "./quick-unlock";
import type { LocalVault, LocalVaultStore } from "./contracts";
export type {
  LocalVault,
  LocalVaultStore,
  LocalUnlockProtection,
} from "./contracts";

/** Shared lifecycle and cryptography; the host supplies atomic persistence and exclusion. */
export function createVaultEngine(store: LocalVaultStore) {
  const changed = () =>
    new LocalExecutionError(
      "PROFILE_CHANGED",
      "This profile changed in another window or was removed. Unlock it again before using module access.",
    );
  async function assertVaultRevision(vault: LocalVault, revision: number) {
    const stored = await store.get(vault.id);
    if (
      !stored ||
      stored.removedAt !== undefined ||
      (stored.revision ?? 0) !== revision
    )
      throw changed();
  }
  async function listLocalProfiles() {
    return (await store.list())
      .filter((v) => v.removedAt === undefined)
      .map(({ id, name }) => ({ id, name }));
  }
  async function listRemovedLocalProfiles() {
    return (await store.list())
      .filter((v) => v.removedAt !== undefined)
      .map(({ id, name, removedAt }) => ({ id, name, removedAt: removedAt! }));
  }
  async function removeLocalProfile(id: string) {
    await store.update(id, (vault) => {
      if (!vault) throw Error("Local profile not found.");
      return vault.removedAt === undefined
        ? {
            ...vault,
            removedAt: Date.now(),
            unlock: undefined,
            revision: (vault.revision ?? 0) + 1,
          }
        : vault;
    });
    store.changed(id);
  }
  async function createVault(name: string, password: string, data: unknown) {
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
    await store.add(vault);
    store.changed(vault.id);
    return { vault, key };
  }
  async function prepareRecovery<T>(result: {
    vault: LocalVault;
    key: CryptoKey;
    data: T;
  }) {
    const { vault, key } = result;
    if (!vault.recoveryRequired) return result;
    const data = recoveredLocalData(result.data);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await encrypt(vault, key, data, iv);
    return {
      vault: {
        ...vault,
        iv,
        ciphertext,
        recoveryRequired: undefined,
        unlock: undefined,
      },
      key,
      data: data as T,
    };
  }
  async function finishRecovery<T>(
    result: { vault: LocalVault; key: CryptoKey; data: T },
    signal?: AbortSignal,
  ) {
    if (!result.vault.recoveryRequired) return result;
    const recovered = await prepareRecovery(result);
    const { vault } = result;
    signal?.throwIfAborted();
    const saved = await store.update(vault.id, (stored) => {
      signal?.throwIfAborted();
      if (
        !stored ||
        !stored.recoveryRequired ||
        stored.removedAt !== undefined ||
        (stored.revision ?? 0) !== (vault.revision ?? 0)
      )
        throw changed();
      return {
        ...stored,
        iv: recovered.vault.iv,
        ciphertext: recovered.vault.ciphertext,
        recoveryRequired: undefined,
        unlock: undefined,
        revision: (stored.revision ?? 0) + 1,
        updatedAt: Date.now(),
      };
    });
    // Recovery-marked profiles cannot issue a grant before this update. Concurrent unlocks
    // are fenced by revision above; a list-change event would cancel this same unlock in the UI.
    return { ...recovered, vault: saved };
  }
  async function unlockVault<T>(
    id: string,
    password: string,
    signal?: AbortSignal,
  ) {
    const vault = await store.get(id);
    if (!vault) throw Error("Local profile not found.");
    if (vault.removedAt !== undefined)
      throw Error("Restore this removed profile before unlocking it.");
    const result = await decryptVault<T>(vault, password);
    await assertVaultRevision(vault, vault.revision ?? 0);
    return finishRecovery(result, signal);
  }
  async function restoreVault<T>(
    id: string,
    password: string,
    signal?: AbortSignal,
  ) {
    const vault = await store.get(id);
    if (!vault || vault.removedAt === undefined)
      throw Error("This profile is not available for restoration.");
    // Validate and encrypt recovery safeguards before making a removed profile active.
    const result = await prepareRecovery(
      await decryptVault<T>(vault, password),
    );
    signal?.throwIfAborted();
    const restored = await store.update(id, (stored) => {
      signal?.throwIfAborted();
      if (
        !stored ||
        stored.removedAt === undefined ||
        (stored.revision ?? 0) !== (vault.revision ?? 0)
      )
        throw new LocalExecutionError(
          "PROFILE_CHANGED",
          "The profile changed during restoration. Choose it again.",
        );
      return {
        ...stored,
        iv: result.vault.iv,
        ciphertext: result.vault.ciphertext,
        recoveryRequired: result.vault.recoveryRequired,
        removedAt: undefined,
        unlock: undefined,
        revision: (stored.revision ?? 0) + 1,
        updatedAt: Date.now(),
      };
    });
    store.changed(id);
    return { ...result, vault: restored };
  }
  async function commitVault(
    vault: LocalVault,
    key: CryptoKey,
    value: unknown,
    revision: number,
    signal: AbortSignal | undefined,
    isUnlocked: () => boolean,
  ) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await encrypt(vault, key, value, iv);
    const assertCurrent = () => {
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
    };
    assertCurrent();
    await store.update(vault.id, (stored) => {
      assertCurrent();
      if (
        !stored ||
        stored.removedAt !== undefined ||
        (stored.revision ?? 0) !== revision
      )
        throw new LocalExecutionError(
          "PROFILE_CHANGED",
          "This profile changed in another window or was removed. Unlock it again before saving.",
        );
      return {
        ...stored,
        iv,
        ciphertext,
        updatedAt: Date.now(),
        revision: revision + 1,
      };
    });
    return revision + 1;
  }
  const quickUnlock = createQuickUnlockEngine(store);
  return {
    listLocalProfiles,
    listRemovedLocalProfiles,
    removeLocalProfile,
    createVault,
    unlockVault,
    restoreVault,
    commitVault,
    assertVaultRevision,
    ...quickUnlock,
    async unlockLocalVault<T>(
      ...args: Parameters<typeof quickUnlock.unlockLocalVault>
    ) {
      return finishRecovery(
        await quickUnlock.unlockLocalVault<T>(...args),
        args[4],
      );
    },
  };
}
