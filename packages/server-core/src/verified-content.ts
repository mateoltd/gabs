import { createHash } from "node:crypto";

/** Only for owned JSON data and hydrated contracts, never request authority. */
export function freezeContent<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeContent(child);
    Object.freeze(value);
  }
  return value;
}

/** Bounded reuse of successful verification of the exact bytes and trust key.
 * A claimed digest is insufficient: altered bytes must go through verification.
 * Authority (publication, entitlement, permissions, pins) remains database-owned.
 */
export class VerifiedContent<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(
    private verify: (json: string, key: string) => T,
    private maxEntries = 128,
    private maxBytes = 32 * 1024 * 1024,
  ) {}

  get(json: string, key: string): T {
    const identity = createHash("sha256")
      .update(String(Buffer.byteLength(key)))
      .update(":")
      .update(key)
      .update(json)
      .digest("hex");
    const existing = this.entries.get(identity);
    if (existing) {
      this.entries.delete(identity);
      this.entries.set(identity, existing);
      return existing.value;
    }
    const value = freezeContent(this.verify(json, key));
    // A retained-byte budget, not a promise about V8 object heap size.
    const bytes = Buffer.byteLength(json) + Buffer.byteLength(key);
    if (bytes <= this.maxBytes && this.maxEntries > 0) {
      while (
        this.entries.size >= this.maxEntries ||
        this.bytes + bytes > this.maxBytes
      ) {
        const oldest = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(oldest)!.bytes;
        this.entries.delete(oldest);
      }
      this.entries.set(identity, { value, bytes });
      this.bytes += bytes;
    }
    return value;
  }
}
