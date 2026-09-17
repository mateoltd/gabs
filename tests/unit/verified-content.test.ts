import { generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import orders from "../../modules/orders/module";
import {
  signPackage,
  verifyPackage,
  type SignedPackage,
} from "../../packages/sdk/node/signing";
import {
  signServerPackage,
  verifyServerPackage,
  type ServerPackage,
} from "../../packages/sdk/node/server-package";
import { VerifiedContent } from "../../packages/server/src/registry/verified-content";

const keys = () =>
  generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });

it("reuses only verified exact release bytes and the current trust key", () => {
  const pair = keys(),
    rotated = keys();
  const verify = vi.fn((json: string, key: string) =>
    verifyPackage(JSON.parse(json) as SignedPackage, key),
  );
  const cache = new VerifiedContent(verify);
  const pkg = signPackage(orders, pair.privateKey),
    json = JSON.stringify(pkg);
  const first = cache.get(json, pair.publicKey);
  expect(cache.get(json, pair.publicKey)).toBe(first);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(() => {
    first.artifact.name = "Changed";
  }).toThrow();
  expect(() => {
    (first.artifact.dependencies as Record<string, string>).inventory = "*";
  }).toThrow();
  for (const mutation of [
    { artifact: { ...pkg.artifact, name: "Tampered" } },
    { manifest: { ...pkg.manifest, permissions: [] } },
    { signature: "invalid" },
    { module_id: "other" },
    { key_id: "other" },
  ]) {
    expect(() =>
      cache.get(JSON.stringify({ ...pkg, ...mutation }), pair.publicKey),
    ).toThrow();
  }
  expect(() => cache.get(json, rotated.publicKey)).toThrow(/signature/);
  const renewed = signPackage(orders, rotated.privateKey);
  expect(cache.get(JSON.stringify(renewed), rotated.publicKey).digest).toBe(
    pkg.digest,
  );
  expect(cache.get(json, pair.publicKey)).toBe(first);
});

it("does not reuse a backend whose executable changed under the claimed digest", () => {
  const pair = keys();
  const cache = new VerifiedContent((json, key) =>
    verifyServerPackage(JSON.parse(json) as ServerPackage, key),
  );
  const pkg = signServerPackage(
    orders,
    "export const fixture = true;",
    pair.privateKey,
  );
  const json = JSON.stringify(pkg);
  const first = cache.get(json, pair.publicKey);
  expect(cache.get(json, pair.publicKey)).toBe(first);
  pkg.payload.javascript = "export const fixture = false;";
  expect(() => cache.get(JSON.stringify(pkg), pair.publicKey)).toThrow(
    /signature|checksum/,
  );
  expect(() => {
    (first.payload.module.permissions as string[]).push("other");
  }).toThrow();
  expect(() => cache.get(json, keys().publicKey)).toThrow(/signature/);
});

it("bounds retained entries and bytes without retaining failed or oversized results", () => {
  const verify = vi.fn((json: string) => {
    if (json === "invalid") throw Error("Invalid");
    return { json };
  });
  const cache = new VerifiedContent(verify, 2, 10);
  const a = cache.get("a", "k"),
    b = cache.get("b", "k");
  expect(cache.get("a", "k")).toBe(a);
  cache.get("c", "k");
  const reloaded = cache.get("b", "k");
  expect(reloaded).not.toBe(b);
  expect(cache.get("12345678", "k")).toEqual({ json: "12345678" });
  expect(cache.get("b", "k")).not.toBe(reloaded);
  const oversized = cache.get("0123456789", "k");
  expect(cache.get("0123456789", "k")).not.toBe(oversized);
  const calls = verify.mock.calls.length;
  expect(() => cache.get("invalid", "k")).toThrow("Invalid");
  expect(() => cache.get("invalid", "k")).toThrow("Invalid");
  expect(verify).toHaveBeenCalledTimes(calls + 2);
});
