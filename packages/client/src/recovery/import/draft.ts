import {
  assertSchema,
  Type,
  resourceRecordSchema,
  reviewFields,
} from "@suite/module-sdk";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { resourceDraftKey, type DraftReview } from "../../modules/drafts";
import { sendModuleCall } from "../../modules/transport";
import { validateModuleResponse } from "../../modules/response";
import type { settleModuleCall } from "../../modules/settlement";
import type { authorizeWorkImport, SavedWorkImportOptions } from "./authority";

type ImportedDraft = Extract<SavedWorkRecovery, { selection: "draft" }>;
type Authority = Awaited<ReturnType<typeof authorizeWorkImport>>;
type Outcome = Awaited<ReturnType<typeof settleModuleCall>>;
const recordInput = Type.Object({
  id: Type.String({ minLength: 1 }),
  baseData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

/** Check prospective destinations before permanently settling the original request. */
export function importedDraftKeys(input: SavedWorkRecovery, digest: string) {
  if (input.selection !== "draft") return [];
  const direct = resourceDraftKey(input.moduleId, input.resource, {
    draftId: `import-${digest}`,
  });
  if (!input.entry) {
    if (input.review?.entryId)
      throw Error(
        "This saved review is missing its original request. Retain the source file.",
      );
    return [direct];
  }
  if (!["create", "update"].includes(input.entry.call.action))
    throw Error(
      "Review this original request through its own recovery controls before restoring a record draft.",
    );
  if (
    input.entry.recordRecovery ||
    input.entry.createRecovery?.length ||
    input.review?.createRecovery?.length ||
    input.review?.collision
  )
    throw Error(
      "This saved review includes reassigned records. Its imported copy is retained; recover the original dependencies and record choices before restoring it.",
    );
  assertSchema(recordInput, input.entry.call.input);
  if (
    input.entry.call.action === "update" &&
    input.target &&
    input.target.id !== input.entry.call.input.id
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
) {
  let review: DraftReview = { draftId: `import-${digest}` };
  let target = structuredClone(input.target);
  let data = structuredClone(input.data);
  if (!input.entry) {
    review = {
      ...review,
      ...(input.review?.comparison
        ? { comparison: structuredClone(input.review.comparison) }
        : {}),
      ...(input.review?.recoveryInput
        ? { recoveryInput: structuredClone(input.review.recoveryInput) }
        : {}),
    };
  } else {
    if (!outcome) throw Error("The original request outcome is missing.");
    assertSchema(recordInput, input.entry.call.input);
    let targetId: string | undefined;
    // The draft was reviewed against this snapshot; fields inherited from that
    // snapshot are not new user edits when the server advances again.
    let base = input.target?.data ?? input.entry.call.input.baseData;
    if (outcome.outcome === "accepted") {
      const accepted: unknown = outcome.result;
      assertSchema(
        resourceRecordSchema(Type.Record(Type.String(), Type.Unknown())),
        accepted,
      );
      targetId = accepted.id;
      base = accepted.data;
    } else {
      review = { entryId: input.entry.id };
      if (input.entry.call.action === "update")
        targetId = input.entry.call.input.id;
    }
    if (input.review?.recoveryInput)
      review.recoveryInput = structuredClone(input.review.recoveryInput);
    target = null;
    if (targetId) {
      authority.check();
      const call = {
        moduleId: input.moduleId,
        moduleVersion: authority.module.version,
        resource: input.resource,
        action: "get" as const,
        input: { id: targetId },
      };
      const current = await sendModuleCall(
        options.client.forUser(options.scope.userId),
        options.scope,
        call,
        { signal: options.signal },
      );
      authority.check();
      validateModuleResponse(authority.module, call, current);
      assertSchema(
        resourceRecordSchema(Type.Record(Type.String(), Type.Unknown())),
        current,
      );
      if (current.id !== targetId)
        throw Error("The server returned a different recovery record.");
      target = current;
      if (!target.archived) {
        const compared = reviewFields(base, input.data, target.data);
        data = compared.data;
        review.comparison = compared.review;
      } else {
        review.recoveryInput = {
          moduleVersion: input.moduleVersion,
          recordId: target.id,
          ...(input.target ? { baseVersion: input.target.version } : {}),
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
  };
}
