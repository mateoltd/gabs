import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  hkdfSync,
  timingSafeEqual,
} from "node:crypto";
import { requireCondition, AppError } from "./errors";
const developmentKey = randomBytes(32);
/** Pagination must not disclose private sort fields through a base64 cursor. */
export function queryCursor(
  scope: string,
  kind: "store" | "resource" = "store",
) {
  const prefix = kind === "resource" ? "rq1" : "sq1";
  const configured = process.env.MODULE_QUERY_CURSOR_KEY;
  requireCondition(
    configured || process.env.NODE_ENV !== "production",
    503,
    "QUERY_CURSOR_KEY_REQUIRED",
    "Configure a shared module query cursor key before enabling sorted module queries.",
  );
  requireCondition(
    !configured || /^[a-fA-F0-9]{64}$/.test(configured),
    503,
    "QUERY_CURSOR_KEY_INVALID",
    "The module query cursor key must contain 32 bytes encoded as hexadecimal.",
  );
  const key = configured ? Buffer.from(configured, "hex") : developmentKey;
  const aad = Buffer.from(`suite-${kind}-query-v1:${scope}`);
  const identityKey =
    kind === "resource"
      ? Buffer.from(
          hkdfSync(
            "sha256",
            key,
            Buffer.from("suite-resource-cursor"),
            Buffer.from("identity-v1"),
            32,
          ),
        )
      : undefined;
  const identity = (json: string) =>
    createHmac("sha256", identityKey!)
      .update(aad)
      .update("\0")
      .update(json)
      .digest("base64url");
  return {
    encode(value: unknown) {
      const json = JSON.stringify(value);
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([
        cipher.update(json, "utf8"),
        cipher.final(),
      ]);
      return `${prefix}.${identityKey ? identity(json) + "." : ""}${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
    },
    decode(value: string): unknown {
      try {
        const expression =
          kind === "resource"
            ? /^rq1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/
            : /^sq1\.[A-Za-z0-9_-]+$/;
        if (!expression.test(value)) throw Error("Invalid format");
        const parts = value.split(".");
        const bytes = Buffer.from(parts.at(-1)!, "base64url");
        if (bytes.length < 29) throw Error("Incomplete cursor");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          bytes.subarray(0, 12),
        );
        decipher.setAAD(aad);
        decipher.setAuthTag(bytes.subarray(12, 28));
        const json = Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString("utf8");
        if (
          identityKey &&
          !timingSafeEqual(Buffer.from(parts[1]), Buffer.from(identity(json)))
        )
          throw Error("Invalid cursor identity");
        return JSON.parse(json);
      } catch {
        throw new AppError(
          400,
          kind === "resource"
            ? "INVALID_RESOURCE_CURSOR"
            : "INVALID_STORE_CURSOR",
          "This pagination cursor is invalid or expired. Reload the list.",
        );
      }
    },
  };
}
