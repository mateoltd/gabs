import { LocalExecutionError } from "@suite/module-sdk/local";
import { decryptVault, decryptWithKey, derive } from "./crypto";
import {
  notifyLocalProfileChanged,
  openLocalVaultDatabase,
  type LocalVault,
} from "./store";
import type {
  LocalUnlockCredential,
  LocalUnlockProtection,
  LocalUnlockStatus,
} from "./contracts";
export type {
  LocalUnlockBinding,
  LocalUnlockProtection,
  LocalUnlockStatus,
} from "./contracts";

const changed = () =>
  new LocalExecutionError(
    "PROFILE_CHANGED",
    "The profile changed. Unlock it again before continuing.",
  );
const exclusive = <T>(id: string, run: () => Promise<T>) =>
  navigator.locks.request(`suite-local-unlock:${id}`, run);
const bytes = (value: Uint8Array) => value as Uint8Array<ArrayBuffer>;
const aad = (id: string, epoch: string) =>
  new TextEncoder().encode(
    JSON.stringify(["suite-local-unlock", 1, id, epoch]),
  );
function credential(
  value: LocalUnlockCredential | undefined,
): LocalUnlockCredential | undefined {
  if (value === undefined) return;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.epoch !== "string" ||
    !/^[\da-f-]{36}$/i.test(value.epoch) ||
    !(value.salt instanceof Uint8Array) ||
    value.salt.length !== 16 ||
    !(value.iv instanceof Uint8Array) ||
    value.iv.length !== 12 ||
    !Number.isSafeInteger(value.failures) ||
    value.failures < 0 ||
    value.failures > 20 ||
    !Number.isSafeInteger(value.retryAt) ||
    value.retryAt < 0 ||
    (value.biometric !== undefined &&
      (typeof value.biometric !== "string" ||
        value.biometric.length > 16384)) ||
    !value.pin ||
    !(value.pin.kind === "browser"
      ? value.pin.wrapped instanceof ArrayBuffer &&
        value.pin.wrapped.byteLength === 48 &&
        value.biometric === undefined
      : value.pin.kind === "native" &&
        typeof value.pin.sealed === "string" &&
        value.pin.sealed.length > 0 &&
        value.pin.sealed.length <= 16384)
  )
    throw Error(
      "Quick unlock settings are damaged. Use your passphrase and reset quick unlock.",
    );
  return value;
}
async function activeVault(id: string) {
  const connection = await openLocalVaultDatabase();
  const vault = await connection.get("vaults", id);
  if (!vault || vault.removedAt !== undefined) throw changed();
  return vault;
}
function current(stored: LocalVault | undefined, base: LocalVault) {
  if (
    !stored ||
    stored.removedAt !== undefined ||
    (stored.revision ?? 0) !== (base.revision ?? 0)
  )
    throw changed();
  return stored;
}

export async function localUnlockStatus(
  id: string,
  protection?: LocalUnlockProtection,
): Promise<LocalUnlockStatus> {
  const vault = await activeVault(id);
  const policy = credential(vault.unlock);
  const support = protection
    ? await protection.status()
    : { available: true, biometric: false };
  return {
    enabled: !!policy,
    biometric: !!policy?.biometric,
    available:
      support.available &&
      (!policy || policy.pin.kind === (protection ? "native" : "browser")),
    biometricAvailable: support.biometric,
    retryAt: policy?.retryAt ?? 0,
  };
}

/** Passphrase-authorized replacement is one vault transaction and invalidates existing sessions. */
export async function configureLocalUnlock(
  id: string,
  password: string,
  pin: string | undefined,
  biometric: boolean,
  protection?: LocalUnlockProtection,
  signal?: AbortSignal,
) {
  if (pin !== undefined && !/^\d{8,12}$/.test(pin))
    throw Error("Use a PIN of 8 to 12 digits.");
  if (biometric && (!pin || !protection))
    throw Error("Biometric unlock requires a protected desktop PIN.");
  return exclusive(id, async () => {
    signal?.throwIfAborted();
    const vault = await activeVault(id);
    // Only the enrollment copy is extractable, after passphrase verification.
    const verified = await decryptVault<unknown>(
      vault,
      password,
      pin !== undefined,
    );
    let unlock: LocalUnlockCredential | undefined;
    if (pin !== undefined) {
      const support = protection
        ? await protection.status()
        : { available: true, biometric: false };
      if (!support.available || (biometric && !support.biometric))
        throw Error("Protected unlock is unavailable. Use your passphrase.");
      const epoch = crypto.randomUUID();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const pinKey = await derive(pin, salt, false, ["wrapKey", "unwrapKey"]);
      const wrapped = await crypto.subtle.wrapKey("raw", verified.key, pinKey, {
        name: "AES-GCM",
        iv,
        additionalData: aad(id, epoch),
      });
      signal?.throwIfAborted();
      const protectedPin = protection
        ? await protection.seal(
            { profileId: id, epoch, kind: "pin" },
            Array.from(new Uint8Array(wrapped)),
          )
        : undefined;
      signal?.throwIfAborted();
      const protectedBiometric =
        biometric && protection
          ? await protection.seal(
              { profileId: id, epoch, kind: "biometric" },
              Array.from(
                new Uint8Array(
                  await crypto.subtle.exportKey("raw", verified.key),
                ),
              ),
            )
          : undefined;
      unlock = {
        version: 1,
        epoch,
        salt,
        iv,
        pin:
          protectedPin !== undefined
            ? { kind: "native", sealed: protectedPin }
            : { kind: "browser", wrapped },
        biometric: protectedBiometric,
        failures: 0,
        retryAt: 0,
      };
    }
    signal?.throwIfAborted();
    const connection = await openLocalVaultDatabase();
    const tx = connection.transaction("vaults", "readwrite");
    try {
      const stored = current(await tx.store.get(id), vault);
      signal?.throwIfAborted();
      await tx.store.put({
        ...stored,
        unlock,
        revision: (stored.revision ?? 0) + 1,
      });
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
    notifyLocalProfileChanged(id);
  });
}

export async function unlockLocalVault<T>(
  id: string,
  method: "pin" | "biometric",
  pin: string,
  protection?: LocalUnlockProtection,
  signal?: AbortSignal,
) {
  if (method !== "pin" && method !== "biometric")
    throw Error("Unknown local unlock method.");
  return exclusive(id, async () => {
    signal?.throwIfAborted();
    const vault = await activeVault(id);
    const policy = credential(vault.unlock);
    if (!policy) throw Error("Use the passphrase to unlock this profile.");
    if (policy.retryAt > Date.now())
      throw Error(
        `Try again after ${new Date(policy.retryAt).toLocaleTimeString()}, or use your passphrase.`,
      );
    let key: CryptoKey;
    if (method === "biometric") {
      if (!policy.biometric || !protection || policy.pin.kind !== "native")
        throw Error("Biometric unlock is unavailable. Use your passphrase.");
      const raw = Uint8Array.from(
        await protection.open(
          { profileId: id, epoch: policy.epoch, kind: "biometric" },
          policy.biometric,
        ),
      );
      try {
        if (raw.length !== 32) throw Error("Invalid protected credential.");
        key = await crypto.subtle.importKey(
          "raw",
          raw,
          { name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"],
        );
      } finally {
        raw.fill(0);
      }
    } else {
      if (!/^\d{8,12}$/.test(pin))
        throw Error("Enter your PIN of 8 to 12 digits.");
      if ((policy.pin.kind === "native") !== !!protection)
        throw Error("Use the passphrase on this device.");
      const wrapped =
        policy.pin.kind === "browser"
          ? policy.pin.wrapped
          : Uint8Array.from(
              await protection!.open(
                { profileId: id, epoch: policy.epoch, kind: "pin" },
                policy.pin.sealed,
              ),
            );
      const pinKey = await derive(pin, policy.salt, false, ["unwrapKey"]);
      signal?.throwIfAborted();
      try {
        key = await crypto.subtle.unwrapKey(
          "raw",
          wrapped,
          pinKey,
          {
            name: "AES-GCM",
            iv: bytes(policy.iv),
            additionalData: aad(id, policy.epoch),
          },
          { name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"],
        );
      } catch {
        await updateAttempts(vault, policy, false, signal);
        throw Error(
          "The PIN was not accepted. Try again or use your passphrase.",
        );
      }
    }
    signal?.throwIfAborted();
    const data = await decryptWithKey<T>(vault, key);
    const stored = await updateAttempts(vault, policy, true, signal);
    return { vault: stored, key, data };
  });
}

async function updateAttempts(
  base: LocalVault,
  policy: LocalUnlockCredential,
  accepted: boolean,
  signal?: AbortSignal,
) {
  const connection = await openLocalVaultDatabase();
  const tx = connection.transaction("vaults", "readwrite");
  try {
    const stored = await tx.store.get(base.id);
    if (
      !stored ||
      stored.removedAt !== undefined ||
      credential(stored.unlock)?.epoch !== policy.epoch
    )
      throw changed();
    if (accepted) current(stored, base);
    signal?.throwIfAborted();
    const failures = accepted ? 0 : Math.min(policy.failures + 1, 20);
    const retryAt =
      failures < 5
        ? 0
        : Date.now() + Math.min(900000, 30000 * 2 ** (failures - 5));
    const updated = { ...stored, unlock: { ...policy, failures, retryAt } };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already completed. */
    }
    await tx.done.catch(() => {});
    throw error;
  }
}
