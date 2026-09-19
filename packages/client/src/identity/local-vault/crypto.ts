import type { LocalVault } from "./store";
export async function derive(password: string, salt: Uint8Array, extractable = false, usages: KeyUsage[] = ["encrypt", "decrypt"]) {
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
    extractable,
    usages,
  );
}

export const encrypt = (
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

export async function decryptVault<T>(vault: LocalVault, password: string, extractable = false) {
  try {
    const key = await derive(password, vault.salt, extractable);
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

