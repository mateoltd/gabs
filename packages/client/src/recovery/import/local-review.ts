import { canonical } from "@suite/module-sdk/registry";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { Scope } from "../../index";
import type { ModuleStorage } from "../../modules/storage";
import { removeResourceDraft } from "../../modules/drafts";
import { createSavedWorkRecovery } from "../work";
import {
  savedWorkFingerprint,
  recoverySize,
  savedWorkImportLimit,
} from "./format";

function sameRequest(left: JournalEntry, right: JournalEntry) {
  return (
    left.userId === right.userId &&
    left.workspaceId === right.workspaceId &&
    canonical({ ...left.call, key: left.id }) ===
      canonical({ ...right.call, key: right.id })
  );
}

export function matchingRequest(state: ModuleStorage, entry?: JournalEntry) {
  if (!entry) return;
  const existing = state.journal.find((item) => item.id === entry.id);
  if (existing && !sameRequest(existing, entry))
    throw Error(
      "This request identity already belongs to different saved work. Both copies were retained.",
    );
  return existing;
}

/** Capture current work for explicit replacement; the snapshot also fences concurrent edits. */
export async function currentImportReview(
  state: ModuleStorage,
  input: SavedWorkRecovery,
  scope: Scope,
) {
  const entry =
    input.entry && state.journal.find((item) => item.id === input.entry!.id);
  // An identity collision must not hide the inert incoming copy from inspection or removal.
  if (!entry || entry.supersededBy || !sameRequest(entry, input.entry!)) return;
  const keys = Object.entries(state.draftReviews ?? {})
    .filter(([, review]) => review.entryId === entry.id)
    .map(([key]) => key)
    .sort();
  if (
    !keys.length &&
    !state.commandReviews?.[entry.id] &&
    !entry.recordRecovery &&
    !entry.createRecovery?.length
  )
    return;
  const copies: SavedWorkRecovery[] = [];
  for (const draftKey of keys)
    copies.push(
      await createSavedWorkRecovery(state, scope, input.moduleId, { draftKey }),
    );
  if (!keys.length || state.commandReviews?.[entry.id])
    copies.push(
      await createSavedWorkRecovery(state, scope, input.moduleId, {
        requestId: entry.id,
      }),
    );
  const fingerprints = await Promise.all(copies.map(savedWorkFingerprint));
  // Individual digests are fixed-width and copies are in stable key order.
  return {
    fingerprint: fingerprints.join(""),
    copies,
    keys,
    requestId: entry.id,
  };
}

export type LocalImportReview = NonNullable<
  Awaited<ReturnType<typeof currentImportReview>>
>;

/** Reserve retained copies before settlement and again inside the atomic local commit. */
export async function retainImportReview(
  state: ModuleStorage,
  review: LocalImportReview,
) {
  const imports = { ...state.recoveryImports };
  for (const input of review.copies) {
    const digest = await savedWorkFingerprint(input);
    if (
      imports[digest] &&
      canonical(imports[digest].input) !== canonical(input)
    )
      throw Error("The retained recovery copy changed. Keep the source file.");
    imports[digest] ??= {
      input: structuredClone(input),
      receivedAt: Date.now(),
    };
  }
  if (
    Object.keys(imports).length > 32 ||
    recoverySize(JSON.stringify(imports)) > savedWorkImportLimit
  )
    throw Error(
      "Saved-work import storage is full. Remove an unneeded imported copy before switching reviews. Current work was preserved.",
    );
  state.recoveryImports = imports;
}

export function replaceImportReview(
  state: ModuleStorage,
  review: LocalImportReview,
) {
  for (const key of review.keys) removeResourceDraft(state, key);
  if (state.commandReviews) delete state.commandReviews[review.requestId];
  const entry = state.journal.find((item) => item.id === review.requestId)!;
  delete entry.recordRecovery;
  delete entry.createRecovery;
  for (const copy of Object.values(state.recoveryImports ?? {}))
    if (
      copy.promotion?.requestId === review.requestId &&
      copy.promotion.outcome === "cancelled"
    )
      copy.promotion.replacedAt = Date.now();
}
