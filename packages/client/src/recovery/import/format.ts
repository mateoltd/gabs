import { assertSchema } from "@suite/module-sdk";
import {
  SavedWorkRecoverySchema,
  type SavedWorkRecovery,
} from "@suite/module-sdk/platform";
import { canonical } from "@suite/module-sdk/registry";
import type { Scope } from "../../index";
import { validateSavedWork } from "../work";

export const savedWorkImportLimit = 1024 * 1024;
export const recoverySize = (text: string) =>
  new TextEncoder().encode(text).byteLength;
export interface SavedWorkImport {
  input: SavedWorkRecovery;
  receivedAt: number;
  promotion?: {
    requestId?: string;
    draftKey?: string;
    existingRequest: boolean;
    outcome?: "accepted" | "cancelled";
    restoredAt: number;
  };
}
/** Bound bytes and nesting before recursive schema/identity processing. */
export function parseSavedWorkImport(text: string, scope: Scope) {
  if (
    text.length > savedWorkImportLimit ||
    recoverySize(text) > savedWorkImportLimit
  )
    throw Error("The recovery file exceeds the 1 MiB import limit.");
  const input: unknown = JSON.parse(text);
  const pending: { value: unknown; depth: number }[] = [
    { value: input, depth: 0 },
  ];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (typeof value === "number" && !Number.isFinite(value))
      throw Error("The recovery file contains a non-finite number.");
    if (!value || typeof value !== "object") continue;
    if (depth >= 64) throw Error("The recovery file is nested too deeply.");
    for (const child of Object.values(value))
      pending.push({ value: child, depth: depth + 1 });
  }
  assertSchema(SavedWorkRecoverySchema, input);
  return validateSavedWork(input, scope, input.moduleId);
}

export async function savedWorkFingerprint(input: SavedWorkRecovery) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(input)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
