import { assertSchema, Type, resourceRecordSchema } from "@suite/module-sdk";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { sendModuleCall } from "../../modules/transport";
import { validateModuleResponse } from "../../modules/response";
import type { settleModuleCall } from "../../modules/settlement";
import type { authorizeWorkImport, SavedWorkImportOptions } from "./authority";

export type ImportedRecordTarget = "original" | "reassigned";
type ImportAuthority = Awaited<ReturnType<typeof authorizeWorkImport>>;

export const recordInput = Type.Object({
  id: Type.String({ minLength: 1 }),
  baseData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  baseVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});

/** Suggestions from a retained file do not establish a current record or approval. */
export function importedRequestTargets(input: SavedWorkRecovery) {
  if (
    input.selection !== "request" ||
    !input.entry.recordRecovery ||
    !["update", "archive"].includes(input.entry.call.action)
  )
    return;
  const value = input.entry.call.input as { id?: unknown } | null;
  if (!value || typeof value.id !== "string") return;
  return {
    originalData: input.entry.call.input,
    originalId: value.id,
    reassignedData: input.entry.call.input,
    reassignedId: input.entry.recordRecovery.targetId,
    linked: true,
  };
}

export function checkImportedRecordTarget(
  input: SavedWorkRecovery,
  choice?: ImportedRecordTarget,
) {
  const entry = input.entry;
  if (
    !entry?.recordRecovery ||
    (entry.call.action !== "update" && entry.call.action !== "archive") ||
    (input.selection === "draft" &&
      (entry.call.action !== "update" || input.review?.collision))
  )
    throw Error(
      "This saved review needs its original dependency recovery before restoration.",
    );
  assertSchema(recordInput, entry.call.input);
  const originalId = entry.call.input.id;
  // This choice confirms one record destination, never other resource-reference remappings.
  for (const mapping of [
    ...(entry.createRecovery ?? []),
    ...(input.review?.createRecovery ?? []),
  ])
    if (
      mapping.moduleId !== input.moduleId ||
      mapping.resource !== entry.call.resource ||
      mapping.originalId !== originalId ||
      mapping.replacementId !== entry.recordRecovery.targetId
    )
      throw Error(
        "This saved review includes other reassigned references. Recover those dependencies before restoring it.",
      );
  if (choice !== "original" && choice !== "reassigned")
    throw Error(
      "Choose the original or reassigned record before restoring this copy.",
    );
  return {
    targetId:
      choice === "original" ? originalId : entry.recordRecovery.targetId,
    destination:
      choice === "original"
        ? ("existing" as const)
        : entry.recordRecovery.destination,
  };
}

/** Reconfirm the destination after settling the original, without executing a replacement. */
export async function prepareImportedRequestTarget(
  options: SavedWorkImportOptions,
  input: Extract<SavedWorkRecovery, { selection: "request" }>,
  authority: ImportAuthority,
  outcome: Awaited<ReturnType<typeof settleModuleCall>>,
  choice?: ImportedRecordTarget,
) {
  const selected = checkImportedRecordTarget(input, choice);
  if (outcome.outcome === "accepted") {
    if (choice === "reassigned")
      throw Error(
        "The original request was already accepted. Choose its original record to recover the actual result.",
      );
    return;
  }
  if (input.entry.call.action === "operation")
    throw Error("A resource target is required.");
  await readCurrentTarget(
    options,
    {
      moduleId: input.moduleId,
      resource: input.entry.call.resource,
    },
    authority,
    selected.targetId,
  );
  await authority.refresh();
  return selected;
}

export async function readCurrentTarget(
  options: SavedWorkImportOptions,
  input: { moduleId: string; resource: string },
  authority: ImportAuthority,
  targetId: string,
) {
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
  return current;
}
