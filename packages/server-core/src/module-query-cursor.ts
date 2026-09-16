import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireCondition, AppError } from "./errors";
const developmentKey = randomBytes(32);
/** Pagination must not disclose private sort fields through a base64 cursor. */
export function queryCursor(scope: string) {
  const configured = process.env.MODULE_QUERY_CURSOR_KEY;
  requireCondition(
    configured || process.env.NODE_ENV !== "production",
    503,
    "QUERY_CURSOR_KEY_REQUIRED",
    "Configure a shared module query cursor key before enabling private-store queries.",
  );
  requireCondition(
    !configured || /^[a-fA-F0-9]{64}$/.test(configured),
    503,
    "QUERY_CURSOR_KEY_INVALID",
    "The module query cursor key must contain 32 bytes encoded as hexadecimal.",
  );
  const key = configured ? Buffer.from(configured, "hex") : developmentKey;
  const aad = Buffer.from(`suite-store-query-v1:${scope}`);
  return {
    encode(value: unknown) {
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      return `sq1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
    },
    decode(value: string): unknown {
      try {
        if (!/^sq1\.[A-Za-z0-9_-]+$/.test(value)) throw Error("Invalid format");
        const bytes = Buffer.from(value.slice(4), "base64url");
        if (bytes.length < 29) throw Error("Incomplete cursor");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          bytes.subarray(0, 12),
        );
        decipher.setAAD(aad);
        decipher.setAuthTag(bytes.subarray(12, 28));
        return JSON.parse(
          Buffer.concat([
            decipher.update(bytes.subarray(28)),
            decipher.final(),
          ]).toString("utf8"),
        );
      } catch {
        throw new AppError(
          400,
          "INVALID_STORE_CURSOR",
          "This pagination cursor is invalid or expired. Reload the list.",
        );
      }
    },
  };
}
