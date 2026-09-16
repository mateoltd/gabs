import { openDB } from "idb";
import type { ResourceRecord } from "@suite/module-sdk";
interface Vault {
  id: string;
  name: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
}
export interface LocalData {
  records: Record<string, ResourceRecord[]>;
}
const db = () =>
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
export async function listLocalProfiles() {
  return ((await (await db()).getAll("vaults")) as Vault[]).map(
    ({ id, name }) => ({ id, name }),
  );
}
export async function removeLocalProfile(id: string) {
  await (await db()).delete("vaults", id);
}
export interface LocalSession {
  id: string;
  name: string;
  data: LocalData;
  save(data: LocalData): Promise<void>;
  lock(): void;
}
function session(vault: Vault, key: CryptoKey, data: LocalData): LocalSession {
  let unlocked: CryptoKey | undefined = key;
  return {
    id: vault.id,
    name: vault.name,
    data,
    async save(next) {
      if (!unlocked) throw Error("Unlock the local profile.");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(vault.id),
        },
        unlocked,
        new TextEncoder().encode(JSON.stringify(next)),
      );
      await (
        await db()
      ).put("vaults", { ...vault, iv, ciphertext, updatedAt: Date.now() });
      this.data = next;
    },
    lock() {
      unlocked = undefined;
      this.data = { records: {} };
    },
  };
}
export async function createLocalProfile(name: string, password: string) {
  if (name.trim().length < 1 || name.length > 100 || password.length < 12)
    throw Error("Enter a name and a passphrase of at least 12 characters.");
  const vault: Vault = {
    id: crypto.randomUUID(),
    name: name.trim(),
    salt: crypto.getRandomValues(new Uint8Array(16)),
    iv: new Uint8Array(12),
    ciphertext: new ArrayBuffer(0),
    updatedAt: Date.now(),
  };
  const s = session(vault, await derive(password, vault.salt), { records: {} });
  await s.save(s.data);
  return s;
}
export async function unlockLocalProfile(id: string, password: string) {
  const vault = (await (await db()).get("vaults", id)) as Vault | undefined;
  if (!vault) throw Error("Local profile not found.");
  try {
    const key = await derive(password, vault.salt),
      bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: vault.iv as Uint8Array<ArrayBuffer>,
          additionalData: new TextEncoder().encode(id),
        },
        key,
        vault.ciphertext,
      );
    return session(
      vault,
      key,
      JSON.parse(new TextDecoder().decode(bytes)) as LocalData,
    );
  } catch {
    throw Error(
      "The local profile could not be unlocked. Check the passphrase.",
    );
  }
}
