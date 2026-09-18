import { createHash } from "node:crypto";
import { assertSchema } from "@suite/module-sdk";
import { verifyArtifact } from "@suite/module-sdk/verification";
import { canonical } from "@suite/module-sdk/registry";
import {
  assertArtifactTransfer,
  decodeArtifactPart,
  ArtifactMetadataSchema,
  type ArtifactTransfer,
} from "@suite/module-sdk/relay-artifacts";
import type {
  ArtifactMetadata,
  SignedArtifact,
} from "@suite/module-sdk/platform";
/** Assembly, hashing, parsing and signature verification run in protected storage's utility process. */
export async function verifyLanPackage(
  readPart: (index: number) => unknown,
  transfer: ArtifactTransfer,
  expected: ArtifactMetadata,
  publicKey: string,
): Promise<SignedArtifact> {
  assertArtifactTransfer(transfer);
  assertSchema(ArtifactMetadataSchema, expected);
  if (
    transfer.module_id !== expected.module_id ||
    transfer.version !== expected.version ||
    transfer.digest !== expected.digest
  )
    throw Error("The received package does not match the selected release.");
  const buffers: Uint8Array[] = [];
  for (let index = 0; index < transfer.parts; index++) {
    const part = { ...transfer, index, content: readPart(index) };
    buffers.push(decodeArtifactPart(part).bytes);
  }
  const bytes = Buffer.concat(buffers);
  if (
    bytes.length !== transfer.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== transfer.transfer
  )
    throw Error("The received package transfer is incomplete or corrupt.");
  const pkg = JSON.parse(bytes.toString("utf8")) as SignedArtifact;
  await verifyArtifact(pkg, publicKey);
  const { artifact: _artifact, ...metadata } = pkg;
  if (canonical(metadata) !== canonical(expected))
    throw Error("The registry selected different signed package metadata.");
  return pkg;
}
