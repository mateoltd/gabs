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

export async function listLocalProfiles() {
  return ((await (await database()).getAll("vaults")) as LocalVault[]).map(
    ({ id, name }) => ({ id, name }),
  );
}

export async function removeLocalProfile(id: string) {
  await (await database()).delete("vaults", id);
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
  return { vault, key };
}

export async function unlockVault<T>(id: string, password: string) {
  const vault = (await (await database()).get("vaults", id)) as
    LocalVault | undefined;
  if (!vault) throw Error("Local profile not found.");
  try {
    const key = await derive(password, vault.salt);
    const bytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: vault.iv as Uint8Array<ArrayBuffer>,
        additionalData: new TextEncoder().encode(id),
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

export async function assertVaultRevision(vault: LocalVault, revision: number) {
  const stored = (await (await database()).get("vaults", vault.id)) as
    LocalVault | undefined;
  if (!stored || (stored.revision ?? 0) !== revision)
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
