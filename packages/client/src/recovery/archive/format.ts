import { Type, assertSchema, type Static } from "@suite/module-sdk";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { canonical } from "@suite/module-sdk/registry";
import type { Scope } from "../../index";
import { parseSavedWorkImport, recoverySize } from "../import/format";

export const savedWorkArchiveLimit = 16 * 1024 * 1024;
export const savedWorkArchiveCopies = 256;
export const encryptedWorkArchiveLimit =
  Math.ceil((savedWorkArchiveLimit + 16) / 3) * 4 + 1024;

const payloadSchema = Type.Object(
  {
    kind: Type.Literal("corporate-saved-work"),
    formatVersion: Type.Literal(1),
    userId: Type.String({ minLength: 1, maxLength: 128 }),
    workspaceId: Type.String({ minLength: 1, maxLength: 128 }),
    createdAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    copies: Type.Array(Type.Unknown(), {
      minItems: 1,
      maxItems: savedWorkArchiveCopies,
    }),
  },
  { additionalProperties: false },
);

export type SavedWorkArchive = Omit<Static<typeof payloadSchema>, "copies"> & {
  copies: SavedWorkRecovery[];
};

/** Portable observations only. Neither this format nor decryption confers access. */
export function parseSavedWorkArchive(
  text: string,
  scope: Scope,
): SavedWorkArchive {
  if (
    text.length > savedWorkArchiveLimit ||
    recoverySize(text) > savedWorkArchiveLimit
  )
    throw Error("The saved-work archive exceeds the 16 MiB limit.");
  const value: unknown = JSON.parse(text);
  assertSchema(payloadSchema, value);
  if (value.userId !== scope.userId || value.workspaceId !== scope.workspaceId)
    throw Error("This archive belongs to another account or workspace.");
  const seen = new Set<string>();
  const copies = value.copies.map((copy) => {
    const input = parseSavedWorkImport(JSON.stringify(copy), scope);
    const identity = canonical(input);
    if (seen.has(identity))
      throw Error("The archive contains duplicate saved-work copies.");
    seen.add(identity);
    return input;
  });
  return { ...value, copies };
}
