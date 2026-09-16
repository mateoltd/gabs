import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { queryCursor } from "../packages/server-core/src/module-query-cursor";
it("encrypts private sort values, authenticates the query scope, and rejects altered cursors", () => {
  const codec = queryCursor("actor-workspace-filter"),
    data = { values: ["private salary", 42000], id: "record" };
  const encoded = codec.encode(data);
  expect(encoded).not.toContain("salary");
  expect(codec.decode(encoded)).toEqual(data);
  expect(codec.encode(data)).not.toBe(encoded);
  expect(() => queryCursor("different-account").decode(encoded)).toThrow(
    "invalid or expired",
  );
  const tampered = Buffer.from(encoded.slice(4), "base64url");
  tampered[29] ^= 1;
  expect(() => codec.decode(`sq1.${tampered.toString("base64url")}`)).toThrow(
    "invalid or expired",
  );
});
it("requires a shared production key and retains cursors across codecs only with the same key", () => {
  const previousEnvironment = process.env.NODE_ENV,
    previousKey = process.env.MODULE_QUERY_CURSOR_KEY;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.MODULE_QUERY_CURSOR_KEY;
    expect(() => queryCursor("scope")).toThrow("Configure a shared");
    process.env.MODULE_QUERY_CURSOR_KEY = "bad-key";
    expect(() => queryCursor("scope")).toThrow("32 bytes");
    const key = randomBytes(32).toString("hex");
    process.env.MODULE_QUERY_CURSOR_KEY = key;
    const encoded = queryCursor("scope").encode({ value: 2 });
    expect(queryCursor("scope").decode(encoded)).toEqual({ value: 2 });
    process.env.MODULE_QUERY_CURSOR_KEY = randomBytes(32).toString("hex");
    expect(() => queryCursor("scope").decode(encoded)).toThrow(
      "invalid or expired",
    );
    process.env.MODULE_QUERY_CURSOR_KEY = key;
    expect(queryCursor("scope").decode(encoded)).toEqual({ value: 2 });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousKey === undefined) delete process.env.MODULE_QUERY_CURSOR_KEY;
    else process.env.MODULE_QUERY_CURSOR_KEY = previousKey;
  }
});
