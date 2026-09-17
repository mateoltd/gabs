import { verifyCapabilityManifest } from "../src/contracts/host-capabilities";
import {
  validateLocalArtifact,
  type LocalBundle,
} from "../src/contracts/local-artifact";
import { createHash, sign, verify, createPublicKey } from "node:crypto";
import {
  validateClientArtifacts,
  clientRequirements,
  verifyClientRequirements,
  type ClientBundles,
} from "../src/contracts/client-artifact";
import { canonical } from "../src/contracts/registry";
import type { ModuleDefinition } from "../src/index";
import type { SignedPackage } from "../src/contracts/release-packages";
export type { SignedPackage } from "../src/contracts/release-packages";
export function signPackage(
  module: ModuleDefinition,
  privateKey: string,
  client?: ClientBundles,
  local?: LocalBundle,
): SignedPackage {
  const artifact = JSON.parse(JSON.stringify(module)) as Record<
    string,
    unknown
  >;
  if (client && Object.keys(client).length) artifact.client = client;
  if (local) artifact.local = local;
  validateClientArtifacts(artifact);
  validateLocalArtifact(artifact);
  const requirements = clientRequirements(artifact);
  const manifest = {
    id: module.id,
    version: module.version,
    publisher: module.publisher,
    host: module.host,
    backend: module.backend,
    dependencies: module.dependencies,
    permissions: module.permissions,
    ...(module.capabilities ? { capabilities: module.capabilities } : {}),
    ...(Object.keys(requirements).length
      ? { clientRequirements: requirements }
      : {}),
    ...(module.storage ? { storage: module.storage } : {}),
    ...(module.localStorage ? { localStorage: module.localStorage } : {}),
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
  validateClientArtifacts(pkg.artifact);
  verifyClientRequirements(pkg.artifact, pkg.manifest);
  verifyCapabilityManifest(pkg.artifact, pkg.manifest);
  validateLocalArtifact(pkg.artifact);
  return pkg;
}
