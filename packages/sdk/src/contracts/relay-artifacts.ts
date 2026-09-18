import { Type, type Static } from "@sinclair/typebox";
import { assertSchema } from "../authoring/validation";
import type { SignedArtifact } from "./platform";
export const relayArtifactLimit = 64 * 1024 * 1024;
export const relayArtifactChunkSize = 64 * 1024;
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const ArtifactTransferSchema = Type.Object(
  {
    format: Type.Literal("suite-package-v1"),
    module_id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
    version: Type.String({ minLength: 1, maxLength: 100 }),
    digest: hash,
    transfer: hash,
    bytes: Type.Integer({ minimum: 1, maximum: relayArtifactLimit }),
    parts: Type.Integer({
      minimum: 1,
      maximum: relayArtifactLimit / relayArtifactChunkSize,
    }),
  },
  { additionalProperties: false },
);
export const ArtifactPartSchema = Type.Object(
  {
    ...ArtifactTransferSchema.properties,
    index: Type.Integer({
      minimum: 0,
      maximum: relayArtifactLimit / relayArtifactChunkSize - 1,
    }),
    content: Type.String({
      minLength: 1,
      maxLength: 4 * Math.ceil(relayArtifactChunkSize / 3),
      pattern: "^[A-Za-z0-9+/]+={0,2}$",
    }),
  },
  { additionalProperties: false },
);
export type ArtifactTransfer = Static<typeof ArtifactTransferSchema>;
export type ArtifactPart = Static<typeof ArtifactPartSchema>;
export function artifactTransfer(part: ArtifactPart): ArtifactTransfer {
  const { index: _index, content: _content, ...transfer } = part;
  return transfer;
}
export function assertArtifactTransfer(
  value: unknown,
): asserts value is ArtifactTransfer {
  assertSchema(ArtifactTransferSchema, value);
  if (value.parts !== Math.ceil(value.bytes / relayArtifactChunkSize))
    throw Error("Invalid package transfer size.");
}
export function decodeArtifactPart(value: unknown): {
  part: ArtifactPart;
  bytes: Uint8Array;
} {
  assertSchema(ArtifactPartSchema, value);
  assertArtifactTransfer(artifactTransfer(value));
  const expected =
    value.index === value.parts - 1
      ? value.bytes - value.index * relayArtifactChunkSize
      : relayArtifactChunkSize;
  const decoded = atob(value.content);
  if (
    value.index >= value.parts ||
    decoded.length !== expected ||
    btoa(decoded) !== value.content
  )
    throw Error("Invalid package transfer chunk.");
  return {
    part: value,
    bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0)),
  };
}
/** Stable, retryable frames. The receiving installer independently verifies registry authority and signatures. */
export async function* artifactRelays(pkg: SignedArtifact) {
  const bytes = new TextEncoder().encode(JSON.stringify(pkg));
  if (!bytes.length || bytes.length > relayArtifactLimit)
    throw Error("The package exceeds the 64 MiB relay limit.");
  const transfer = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const metadata: ArtifactTransfer = {
    format: "suite-package-v1",
    module_id: pkg.module_id,
    version: pkg.version,
    digest: pkg.digest,
    transfer,
    bytes: bytes.length,
    parts: Math.ceil(bytes.length / relayArtifactChunkSize),
  };
  assertArtifactTransfer(metadata);
  for (let index = 0; index < metadata.parts; index++) {
    let content = "";
    for (const byte of bytes.subarray(
      index * relayArtifactChunkSize,
      (index + 1) * relayArtifactChunkSize,
    ))
      content += String.fromCharCode(byte);
    const part: ArtifactPart = { ...metadata, index, content: btoa(content) };
    yield {
      kind: "artifact" as const,
      id: `${transfer}.${index}`,
      payload: JSON.stringify(part),
    };
  }
}

export const ArtifactMetadataSchema = Type.Object(
  {
    module_id: ArtifactTransferSchema.properties.module_id,
    version: ArtifactTransferSchema.properties.version,
    manifest: Type.Record(Type.String(), Type.Unknown()),
    digest: hash,
    key_id: hash,
    signature: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
);
