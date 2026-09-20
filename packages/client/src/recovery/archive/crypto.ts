import { Type, assertSchema } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import type { Scope } from "../../index";
import { recoverySize } from "../import/format";
import {
  encryptedWorkArchiveLimit,
  parseSavedWorkArchive,
  savedWorkArchiveLimit,
  type SavedWorkArchive,
} from "./format";

const algorithm = {
  kind: "encrypted-corporate-saved-work",
  formatVersion: 1,
  cipher: "AES-256-GCM",
  kdf: "PBKDF2-SHA256",
  iterations: 600000,
} as const;
const envelopeSchema = Type.Object(
  {
    kind: Type.Literal(algorithm.kind),
    formatVersion: Type.Literal(algorithm.formatVersion),
    cipher: Type.Literal(algorithm.cipher),
    kdf: Type.Literal(algorithm.kdf),
    iterations: Type.Literal(algorithm.iterations),
    salt: Type.String({ minLength: 24, maxLength: 24 }),
    iv: Type.String({ minLength: 16, maxLength: 16 }),
    ciphertext: Type.String({
      minLength: 24,
      maxLength: encryptedWorkArchiveLimit - 1024,
    }),
  },
  { additionalProperties: false },
);
const encode = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
};
const decode = (value: string) => {
  const bytes = Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
  if (encode(bytes) !== value) throw Error("The archive encoding is invalid.");
  return bytes;
};
async function derive(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usage: "encrypt" | "decrypt",
) {
  if (passphrase.length < 12 || passphrase.length > 1024)
    throw Error("Use an archive passphrase between 12 and 1,024 characters.");
  const bytes = new TextEncoder().encode(passphrase);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      bytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: algorithm.iterations,
        salt,
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      [usage],
    );
  } finally {
    bytes.fill(0);
  }
}

/** Encrypt validated input. The host must authorize every copy before offering the file. */
export async function sealSavedWorkArchive(
  archive: SavedWorkArchive,
  passphrase: string,
  check: () => void,
) {
  check();
  const validated = parseSavedWorkArchive(JSON.stringify(archive), archive);
  const header = {
    ...algorithm,
    salt: encode(crypto.getRandomValues(new Uint8Array(16))),
    iv: encode(crypto.getRandomValues(new Uint8Array(12))),
  };
  const key = await derive(passphrase, decode(header.salt), "encrypt");
  check();
  const plaintext = new TextEncoder().encode(JSON.stringify(validated));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: decode(header.iv),
        additionalData: new TextEncoder().encode(canonical(header)),
        tagLength: 128,
      },
      key,
      plaintext,
    );
    check();
    return JSON.stringify({
      ...header,
      ciphertext: encode(new Uint8Array(ciphertext)),
    });
  } finally {
    plaintext.fill(0);
  }
}

/** Authenticate the entire file before parsing any saved input. Still requires live import authority. */
export async function openSavedWorkArchive(
  text: string,
  passphrase: string,
  scope: Scope,
  check: () => void,
) {
  check();
  if (
    text.length > encryptedWorkArchiveLimit ||
    recoverySize(text) > encryptedWorkArchiveLimit
  )
    throw Error("The encrypted saved-work archive is too large.");
  const envelope: unknown = JSON.parse(text);
  assertSchema(envelopeSchema, envelope);
  const { ciphertext: encoded, ...header } = envelope;
  const salt = decode(header.salt),
    iv = decode(header.iv),
    ciphertext = decode(encoded);
  if (
    salt.length !== 16 ||
    iv.length !== 12 ||
    ciphertext.length < 16 ||
    ciphertext.length > savedWorkArchiveLimit + 16
  )
    throw Error("The archive encryption parameters are invalid.");
  const key = await derive(passphrase, salt, "decrypt");
  check();
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(canonical(header)),
          tagLength: 128,
        },
        key,
        ciphertext,
      ),
    );
  } catch {
    throw Error(
      "The archive could not be unlocked. Check the passphrase and the original file.",
    );
  }
  try {
    check();
    return parseSavedWorkArchive(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      scope,
    );
  } finally {
    plaintext.fill(0);
  }
}
