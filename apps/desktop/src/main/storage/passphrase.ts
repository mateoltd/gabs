import type { Readable } from "node:stream";

/** Maintenance secrets are read from a pipe, never from command-line arguments or environment. */
export async function readBackupPassphrase(
  input: Readable & { isTTY?: boolean },
) {
  if (input.isTTY)
    throw Error(
      "Pipe the backup passphrase through standard input; do not put it in command-line arguments.",
    );
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bytes);
      length += bytes.length;
      if (length > 16386) throw Error("The backup passphrase is too long.");
    }
    const bytes = Buffer.concat(chunks);
    try {
      // Permit one conventional line ending, preserving intentional leading/trailing spaces.
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/\r?\n$/, "");
      if (text.length < 12 || text.length > 4096 || /[\r\n\0]/.test(text))
        throw Error(
          "Use one backup passphrase between 12 and 4096 characters.",
        );
      return text;
    } finally {
      bytes.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}
