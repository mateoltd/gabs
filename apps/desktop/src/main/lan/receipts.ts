import { Type, assertSchema, type Static } from "@suite/module-sdk";
import type { Scope } from "@suite/client";
import { validateRelayEnvelope, type RelayEnvelope } from "./transport";
export const inboxLimit = 10;
export const archiveLimit = 100;
export const archiveByteLimit = 16 * 1024 * 1024;
export const recoveryFileLimit = 1024 * 1024;
export const ReceiptSelection = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    location: Type.Union([Type.Literal("inbox"), Type.Literal("archive")]),
  },
  { additionalProperties: false },
);
export type ReceiptSelection = Static<typeof ReceiptSelection>;
export interface ArchivedReceipt {
  envelope: RelayEnvelope;
  archivedAt: number;
}
export function readArchive(value: unknown, scope: Scope): ArchivedReceipt[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > archiveLimit ||
    Buffer.byteLength(JSON.stringify(value)) > archiveByteLimit
  )
    throw Error(
      "The draft archive needs recovery. Its contents have been retained.",
    );
  const keys = new Set<string>();
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Number.isFinite(entry.archivedAt)
    )
      throw Error("Invalid draft archive. Its contents have been retained.");
    validateRelayEnvelope(entry.envelope, scope.workspaceId);
    const key = JSON.stringify([entry.envelope.id, entry.envelope.digest]);
    if (entry.envelope.kind !== "pending" || keys.has(key))
      throw Error("Invalid draft archive. Its contents have been retained.");
    keys.add(key);
  }
  return value;
}
/** Invalid draft schemas may still belong to this account; foreign/unknown ownership never exports. */
export function ownsReceipt(envelope: RelayEnvelope, scope: Scope) {
  try {
    const value = JSON.parse(envelope.payload);
    return (
      value?.userId === scope.userId && value?.workspaceId === scope.workspaceId
    );
  } catch {
    return false;
  }
}
export function encodeRecoveryFile(scope: Scope, envelope: RelayEnvelope) {
  validateRelayEnvelope(envelope, scope.workspaceId);
  if (envelope.kind !== "pending" || !ownsReceipt(envelope, scope))
    throw Error(
      "Only drafts belonging to this account and workspace can be exported.",
    );
  return JSON.stringify(
    { format: "suite-received-draft-v1", ...scope, envelope },
    null,
    2,
  );
}
export function decodeRecoveryFile(
  content: string,
  scope: Scope,
): RelayEnvelope {
  if (Buffer.byteLength(content) > recoveryFileLimit)
    throw Error("The recovery file exceeds 1 MiB.");
  try {
    const value = JSON.parse(content);
    assertSchema(
      Type.Object(
        {
          format: Type.Literal("suite-received-draft-v1"),
          userId: Type.Literal(scope.userId),
          workspaceId: Type.Literal(scope.workspaceId),
          envelope: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
      value,
    );
    validateRelayEnvelope(value.envelope, scope.workspaceId);
    if (
      value.envelope.kind !== "pending" ||
      !ownsReceipt(value.envelope, scope)
    )
      throw Error("The recovery file belongs to another account or workspace.");
    return value.envelope;
  } catch {
    throw Error(
      "The recovery file is invalid or belongs to another account or workspace. Its contents were not imported.",
    );
  }
}
