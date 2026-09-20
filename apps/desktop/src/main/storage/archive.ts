import {
  createHash,
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, open, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

// Version fixes the cipher, KDF and framing; archive input cannot choose a weaker or costly KDF.
const magic = Buffer.from("COMMONLOCAL1");
const saltSize = 16,
  ivSize = 12,
  tagSize = 16,
  keySize = 32;
const headerSize = magic.length + saltSize + ivSize;
const derive = promisify(pbkdf2);
function passphraseBytes(passphrase: string) {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 12 ||
    passphrase.length > 4096
  )
    throw Error("Use a backup passphrase between 12 and 4096 characters.");
  return Buffer.from(passphrase, "utf8");
}
async function archiveKey(passphrase: string, salt: Buffer) {
  const bytes = passphraseBytes(passphrase);
  try {
    return await derive(bytes, salt, 600000, keySize, "sha256");
  } finally {
    bytes.fill(0);
  }
}
async function flushFile(path: string) {
  const file = await open(path, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function flushDirectory(path: string) {
  if (process.platform === "win32") return;
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function publish(temporary: string, destination: string) {
  // Same-directory hard linking is an atomic no-overwrite publication. Existing backups survive.
  await link(temporary, destination);
  await flushDirectory(dirname(destination));
}

/** Streams an already encrypted, closed SQLite snapshot. Neither plaintext DB nor raw key touches disk. */
export async function writeStorageArchive(options: {
  database: string;
  secret: Buffer;
  destination: string;
  passphrase: string;
  signal?: AbortSignal;
}) {
  const { database, secret, passphrase, signal } = options;
  if (secret.length !== keySize) throw Error("Invalid backup database key.");
  const source = await stat(database);
  if (!source.isFile() || source.size < 16)
    throw Error("Invalid backup database.");
  const destination = resolve(options.destination);
  if (resolve(database) === destination)
    throw Error("Choose a separate backup file.");
  signal?.throwIfAborted();
  const salt = randomBytes(saltSize),
    iv = randomBytes(ivSize);
  const header = Buffer.concat([magic, salt, iv]);
  const key = await archiveKey(passphrase, salt);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(header);
    } finally {
      await file.close();
    }
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    async function* content() {
      yield secret;
      for await (const chunk of createReadStream(database)) yield chunk;
    }
    await pipeline(
      Readable.from(content()),
      cipher,
      createWriteStream(temporary, { flags: "a" }),
      { signal },
    );
    const final = await open(temporary, "a");
    try {
      await final.writeFile(cipher.getAuthTag());
      await final.sync();
    } finally {
      await final.close();
    }
    signal?.throwIfAborted();
    await publish(temporary, destination);
  } finally {
    key.fill(0);
    await rm(temporary, { force: true });
  }
}

/** Extracts only encrypted SQLite pages; the unwrapped database key stays in memory. */
class DatabasePayload extends Transform {
  readonly secret = Buffer.alloc(keySize);
  private received = 0;
  databaseBytes = 0;
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: TransformCallback,
  ) {
    const count = Math.min(keySize - this.received, chunk.length);
    chunk.copy(this.secret, this.received, 0, count);
    this.received += count;
    const pages = chunk.subarray(count);
    this.databaseBytes += pages.length;
    done(null, pages);
  }
  override _flush(done: TransformCallback) {
    done(
      this.received === keySize && this.databaseBytes >= 16
        ? undefined
        : Error("Incomplete storage backup."),
    );
  }
}

/** Authenticates the entire archive before publishing a staging file or releasing its key. */
export async function readStorageArchiveDetails(options: {
  archive: string;
  destination: string;
  passphrase: string;
  signal?: AbortSignal;
}): Promise<{ secret: Buffer; digest: string }> {
  const { archive, passphrase, signal } = options;
  const destination = resolve(options.destination);
  if (resolve(archive) === destination)
    throw Error("Choose a separate recovery file.");
  signal?.throwIfAborted();
  // Hold the same descriptor for framing and body; path replacement cannot splice different files.
  const source = await open(archive, "r");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const payload = new DatabasePayload();
  let key: Buffer | undefined;
  try {
    const metadata = await source.stat();
    if (
      !metadata.isFile() ||
      metadata.size < headerSize + keySize + 16 + tagSize
    )
      throw Error("Invalid or incomplete storage backup.");
    const header = Buffer.alloc(headerSize),
      tag = Buffer.alloc(tagSize);
    const headerRead = await source.read(header, 0, header.length, 0);
    const tagRead = await source.read(
      tag,
      0,
      tag.length,
      metadata.size - tagSize,
    );
    if (
      headerRead.bytesRead !== headerSize ||
      tagRead.bytesRead !== tagSize ||
      !header.subarray(0, magic.length).equals(magic)
    )
      throw Error("Unsupported or incomplete storage backup.");
    key = await archiveKey(
      passphrase,
      header.subarray(magic.length, magic.length + saltSize),
    );
    signal?.throwIfAborted();
    const digest = createHash("sha256").update(header);
    const fingerprint = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        digest.update(chunk);
        done(null, chunk);
      },
    });
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(magic.length + saltSize),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(
      source.createReadStream({
        start: headerSize,
        end: metadata.size - tagSize - 1,
        autoClose: false,
      }),
      fingerprint,
      decipher,
      payload,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    await flushFile(temporary);
    signal?.throwIfAborted();
    await publish(temporary, destination);
    return {
      secret: Buffer.from(payload.secret),
      digest: digest.update(tag).digest("hex"),
    };
  } finally {
    key?.fill(0);
    payload.secret.fill(0);
    await source.close();
    await rm(temporary, { force: true });
  }
}

export async function readStorageArchive(
  options: Parameters<typeof readStorageArchiveDetails>[0],
): Promise<Buffer> {
  return (await readStorageArchiveDetails(options)).secret;
}
