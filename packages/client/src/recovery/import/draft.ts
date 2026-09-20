import {
  assertSchema,
  Type,
  resourceRecordSchema,
  reviewFields,
  unresolvedReviewFields,
} from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { resourceDraftKey, type DraftReview } from "../../modules/drafts";
import {
  recordInput,
  checkImportedRecordTarget,
  readCurrentTarget,
  type ImportedRecordTarget,
} from "./target";
import type { settleModuleCall } from "../../modules/settlement";
import type { authorizeWorkImport, SavedWorkImportOptions } from "./authority";
import { importedReferenceHints } from "./references";

export type ImportedDraftSource = ImportedRecordTarget;

type ImportedDraft = Extract<SavedWorkRecovery, { selection: "draft" }>;
/** Recover unresolved competing input, not the remote placeholder shown by a conflict form. */
export function importedDraftInput(input: ImportedDraft) {
  const data = structuredClone(input.data);
  const comparison = input.review?.comparison;
  if (comparison)
    copyReviewFields(
      data,
      comparison.local,
      unresolvedReviewFields(comparison),
    );
  return data;
}
function copyReviewFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  fields: string[],
) {
  for (const field of fields) {
    if (Object.hasOwn(source, field))
      Object.defineProperty(target, field, {
        value: structuredClone(source[field]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else delete target[field];
  }
}
function importedDraftBase(
  input: ImportedDraft,
  base: Record<string, unknown> | undefined,
) {
  const comparison = input.review?.comparison;
  const unresolved = comparison ? unresolvedReviewFields(comparison) : [];
  if (!unresolved.length) return base;
  if (!comparison?.base || !base) return undefined;
  const restored = structuredClone(base);
  copyReviewFields(restored, comparison.base, unresolved);
  return restored;
}

type Authority = Awaited<ReturnType<typeof authorizeWorkImport>>;
type Outcome = Awaited<ReturnType<typeof settleModuleCall>>;
/** Copied destinations are suggestions only; the caller must make a fresh choice. */
export function importedDraftChoices(input: SavedWorkRecovery) {
  if (input.selection !== "draft") return;
  if (!input.entry && input.review?.collision) {
    const source = input.review.collision;
    return {
      originalData: source.sourceData,
      originalId: source.sourceTarget?.id,
      reassignedData: input.data,
      reassignedId: source.targetId,
      linked: false,
    };
  }
  if (input.entry?.recordRecovery && input.entry.call.action === "update") {
    const original = input.entry.call.input as { id?: unknown } | null;
    if (!original || typeof original.id !== "string") return;
    return {
      originalData: input.data,
      originalId: original.id,
      reassignedData: input.data,
      reassignedId: input.entry.recordRecovery.targetId,
      linked: true,
    };
  }
}

/** Check prospective destinations before permanently settling the original request. */
export function importedDraftKeys(
  input: SavedWorkRecovery,
  digest: string,
  draftSource?: ImportedDraftSource,
) {
  if (input.selection !== "draft") return [];
  const direct = resourceDraftKey(input.moduleId, input.resource, {
    draftId: `import-${digest}`,
  });
  if (!input.entry) {
    if (input.review?.entryId)
      throw Error(
        "This saved review is missing its original request. Retain the source file.",
      );
    if (
      input.review?.collision &&
      draftSource !== "original" &&
      draftSource !== "reassigned"
    )
      throw Error(
        "Choose the original or reassigned draft before restoring this copy.",
      );
    return [direct];
  }
  if (!["create", "update"].includes(input.entry.call.action))
    throw Error(
      "Review this original request through its own recovery controls before restoring a record draft.",
    );
  if (input.entry.recordRecovery) {
    checkImportedRecordTarget(input, draftSource);
  } else if (input.review?.collision)
    throw Error(
      "This saved review includes reassigned records. Its imported copy is retained; recover the original dependencies and record choices before restoring it.",
    );
  assertSchema(recordInput, input.entry.call.input);
  if (
    input.entry.call.action === "update" &&
    input.target &&
    input.target.id !== input.entry.call.input.id &&
    input.target.id !== input.entry.recordRecovery?.targetId
  )
    throw Error("This saved review does not match its original record target.");
  return [
    resourceDraftKey(input.moduleId, input.resource, {
      entryId: input.entry.id,
    }),
    direct,
  ];
}

/** Recompute a linked review from the real original outcome and current record, never copied choices. */
export async function prepareImportedDraft(
  options: SavedWorkImportOptions,
  input: ImportedDraft,
  digest: string,
  authority: Authority,
  outcome?: Outcome,
  draftSource?: ImportedDraftSource,
) {
  const hints = importedReferenceHints(input);
  const context = hints.length
    ? { createRecovery: structuredClone(hints) }
    : {};
  let review: DraftReview = { draftId: `import-${digest}`, ...context };
  let target = structuredClone(input.target);
  let data = importedDraftInput(input);
  let recordRecovery: JournalEntry["recordRecovery"];
  if (!input.entry && input.review?.collision) {
    const source = input.review.collision;
    if (draftSource !== "original" && draftSource !== "reassigned")
      throw Error(
        "Choose the original or reassigned draft before restoring this copy.",
      );
    const original = draftSource === "original";
    const version = original ? source.moduleVersion : input.draftVersion;
    data = structuredClone(original ? source.sourceData : input.data);
    const snapshot = original ? source.sourceTarget : input.target;
    const targetId = original ? source.sourceTarget?.id : source.targetId;
    if (!original && snapshot && !targetId)
      throw Error(
        "The reassigned record target is missing. Retain the source file.",
      );
    target = null;
    if (targetId) {
      target = await readCurrentTarget(options, input, authority, targetId);
      if (!target.archived) {
        const compared = reviewFields(snapshot?.data, data, target.data);
        data = compared.data;
        review.comparison = compared.review;
      } else {
        review.recoveryInput = {
          moduleVersion: version,
          recordId: target.id,
          ...(snapshot ? { baseVersion: snapshot.version } : {}),
        };
      }
      await authority.refresh();
    }
    // This is an independently reviewed draft. The copied collision envelope
    // stays in recoveryImports; it must not become a live journal prerequisite.
    return {
      key: resourceDraftKey(input.moduleId, input.resource, review),
      data,
      target,
      review,
      version,
      recordRecovery,
    };
  }
  if (!input.entry) {
    review = {
      ...review,
      ...(input.review?.recoveryInput
        ? { recoveryInput: structuredClone(input.review.recoveryInput) }
        : {}),
    };
    if (target) {
      const snapshot = target;
      target = await readCurrentTarget(options, input, authority, snapshot.id);
      if (!target.archived) {
        const compared = reviewFields(
          importedDraftBase(input, snapshot.data),
          data,
          target.data,
        );
        data = compared.data;
        review.comparison = compared.review;
      } else {
        review.recoveryInput = {
          moduleVersion: input.draftVersion,
          recordId: snapshot.id,
          baseVersion: snapshot.version,
        };
      }
      await authority.refresh();
    }
  } else {
    if (!outcome) throw Error("The original request outcome is missing.");
    assertSchema(recordInput, input.entry.call.input);
    let targetId: string | undefined;
    // The draft was reviewed against this snapshot; fields inherited from that
    // snapshot are not new user edits when the server advances again.
    let base = input.target?.data ?? input.entry.call.input.baseData;
    if (input.entry.recordRecovery)
      checkImportedRecordTarget(input, draftSource);
    if (outcome.outcome === "accepted") {
      if (input.entry.recordRecovery && draftSource === "reassigned")
        throw Error(
          "The original request was already accepted. Choose the original draft to review its actual record.",
        );
      const accepted: unknown = outcome.result;
      assertSchema(
        resourceRecordSchema(Type.Record(Type.String(), Type.Unknown())),
        accepted,
      );
      targetId = accepted.id;
      base = input.target?.data ?? accepted.data;
    } else {
      review = { entryId: input.entry.id, ...context };
      if (input.entry.call.action === "update") {
        targetId =
          input.entry.recordRecovery && draftSource === "reassigned"
            ? input.entry.recordRecovery.targetId
            : input.entry.call.input.id;
        if (input.entry.recordRecovery)
          recordRecovery = {
            targetId,
            destination:
              draftSource === "reassigned"
                ? input.entry.recordRecovery.destination
                : "existing",
          };
      }
    }
    if (input.review?.recoveryInput)
      review.recoveryInput = structuredClone(input.review.recoveryInput);
    target = null;
    if (targetId) {
      target = await readCurrentTarget(options, input, authority, targetId);
      if (!target.archived) {
        const compared = reviewFields(
          importedDraftBase(input, base),
          data,
          target.data,
        );
        data = compared.data;
        review.comparison = compared.review;
      } else {
        const baseVersion =
          input.target?.id === target.id
            ? input.target.version
            : input.entry.call.input.id === target.id
              ? input.entry.call.input.baseVersion
              : undefined;
        review.recoveryInput = {
          moduleVersion: input.moduleVersion,
          recordId: target.id,
          ...(baseVersion !== undefined ? { baseVersion } : {}),
        };
      }
      await authority.refresh();
    }
  }
  return {
    key: resourceDraftKey(input.moduleId, input.resource, review),
    data,
    target,
    review,
    version: input.draftVersion,
    recordRecovery,
  };
}
