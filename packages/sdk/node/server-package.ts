import * as references from "../src/contracts/references";
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import * as sdk from "../src/index";
import {
  defineModuleServer,
  type ScopedModuleServer,
} from "../src/contracts/server";
import { canonical, satisfies } from "../src/contracts/registry";
import type { ServerPackage } from "../src/contracts/release-packages";
export type { ServerPackage } from "../src/contracts/release-packages";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function signServerPackage(
  module: sdk.ModuleDefinition,
  javascript: string,
  privateKey: string,
): ServerPackage {
  const payload = JSON.parse(
    JSON.stringify({ format: "suite-server-v1", module, javascript }),
  ) as ServerPackage["payload"];
  const digest = hash(canonical(payload));
  return {
    payload,
    digest,
    key_id: hash(
      createPublicKey(privateKey).export({ type: "spki", format: "der" }),
    ),
    signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString(
      "base64",
    ),
  };
}
export function verifyServerPackage(pkg: ServerPackage, publicKey: string) {
  if (
    pkg.payload?.format !== "suite-server-v1" ||
    typeof pkg.payload.javascript !== "string" ||
    !pkg.payload.javascript.trim() ||
    Buffer.byteLength(pkg.payload.javascript) > 4 * 1024 * 1024
  )
    throw Error("Unsupported or oversized server package.");
  const key = createPublicKey(publicKey);
  const bytes = canonical(pkg.payload);
  if (
    pkg.key_id !== hash(key.export({ type: "spki", format: "der" })) ||
    pkg.digest !== hash(bytes) ||
    !verify(null, Buffer.from(bytes), key, Buffer.from(pkg.signature, "base64"))
  )
    throw Error("Server package signature or checksum is invalid.");
  const module = sdk.hydrateModule(pkg.payload.module);
  if (module.publisher !== "suite" || !satisfies("1.0.0", module.backend))
    throw Error(
      "The server package requires an unsupported publisher or backend.",
    );
  return pkg;
}
/** Call only after review approval. Official server code is trusted, not sandboxed. */
export async function loadServerPackage(
  pkg: ServerPackage,
  publicKey: string,
): Promise<ScopedModuleServer> {
  verifyServerPackage(pkg, publicKey);
  const loaded = await import(
    `data:text/javascript;base64,${Buffer.from(pkg.payload.javascript).toString("base64")}`
  );
  if (typeof loaded.createServer !== "function")
    throw Error("Missing server factory.");
  const server = loaded.createServer({
    sdk,
    references,
    server: { defineModuleServer },
  }) as ScopedModuleServer;
  if (
    server?.kind !== "scoped" ||
    typeof server.execute !== "function" ||
    canonical(server.module) !== canonical(pkg.payload.module)
  )
    throw Error(
      "The executable server does not implement its reviewed contract.",
    );
  return server;
}
