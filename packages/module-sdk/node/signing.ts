import { createHash, sign, verify, createPublicKey } from "node:crypto";
import { canonical } from "../src/registry";
import type { ModuleDefinition } from "../src/index";
export interface SignedPackage {
  module_id: string;
  version: string;
  manifest: Record<string, unknown>;
  artifact: Record<string, unknown>;
  digest: string;
  signature: string;
  key_id: string;
}
export function signPackage(
  module: ModuleDefinition,
  privateKey: string,
): SignedPackage {
  const artifact = JSON.parse(JSON.stringify(module)) as Record<
    string,
    unknown
  >;
  const manifest = {
    id: module.id,
    version: module.version,
    publisher: module.publisher,
    host: module.host,
    backend: module.backend,
    dependencies: module.dependencies,
    permissions: module.permissions,
  };
  const digest = createHash("sha256").update(canonical(artifact)).digest("hex");
  const key_id = createHash("sha256")
    .update(createPublicKey(privateKey).export({ type: "spki", format: "der" }))
    .digest("hex");
  const signature = sign(
    null,
    Buffer.from(canonical({ manifest, digest })),
    privateKey,
  ).toString("base64");
  return {
    module_id: module.id,
    version: module.version,
    manifest,
    artifact,
    digest,
    signature,
    key_id,
  };
}
export function verifyPackage(pkg: SignedPackage, publicKey: string) {
  const key = createPublicKey(publicKey);
  const id = createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
  if (
    pkg.key_id !== id ||
    pkg.digest !==
      createHash("sha256").update(canonical(pkg.artifact)).digest("hex") ||
    !verify(
      null,
      Buffer.from(canonical({ manifest: pkg.manifest, digest: pkg.digest })),
      key,
      Buffer.from(pkg.signature, "base64"),
    )
  )
    throw Error("Module signature or checksum is invalid.");
  if (
    pkg.manifest.id !== pkg.module_id ||
    pkg.manifest.version !== pkg.version ||
    pkg.manifest.publisher !== "suite" ||
    pkg.artifact.id !== pkg.module_id ||
    pkg.artifact.version !== pkg.version
  )
    throw Error("Module identity does not match its signed manifest.");
  return pkg;
}
