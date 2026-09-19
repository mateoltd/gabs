import { assertSchema, Type, type ModuleCall } from "@suite/module-sdk";
import { remapResourceReferences } from "@suite/module-sdk/references";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { Scope } from "../index";
import type { ModuleStorage } from "./storage";
import {
  assertJournalOrder,
  JournalConflictError,
  journalRecordId,
  referenceDependencies,
} from "./journal";
import {
  responseContract,
  responseContractKey,
  validateModuleResponse,
} from "./response";
import { removeResourceDraft, resourceDraftKey } from "./drafts";

import {
  collisionDrafts,
  preserveCollisionDrafts,
  containsRecordId,
  type CreateDraftChoices,
} from "./draft-collisions";
const recordId = Type.String({ format: "uuid" });
function input(call: ModuleCall) {
  if (!call.input || typeof call.input !== "object")
    throw new JournalConflictError("The original record input is unavailable.");
  return call.input as { id?: string; data?: unknown; baseData?: unknown };
}
export type CreateRecoveryTargets = Partial<
  Record<string, "separate" | "existing">
>;

function createDependents(
  journal: readonly JournalEntry[],
  originalId: string,
) {
  const affected = new Set([originalId]);
  const accepted = new Set<string>();
  for (let size = -1; size !== affected.size;) {
    size = affected.size;
    for (const entry of journal)
      if (
        !entry.supersededBy &&
        entry.dependencies.some((id) => affected.has(id))
      )
        // An accepted effect stays on its original record. Work depending only
        // on that receipt already has its prerequisite and is not retargeted.
        if (entry.state === "accepted") accepted.add(entry.id);
        else affected.add(entry.id);
  }
  return journal.filter(
    (entry) =>
      (affected.has(entry.id) || accepted.has(entry.id)) &&
      entry.id !== originalId,
  );
}

export function createCommandDependents(
  state: ModuleStorage,
  scope: Scope,
  originalId: string,
) {
  return createDependents(
    state.journal.filter(
      (entry) =>
        entry.userId === scope.userId &&
        entry.workspaceId === scope.workspaceId,
    ),
    originalId,
  ).filter(
    (entry) => entry.call.action === "operation" && entry.state !== "accepted",
  );
}

/** Only explicit dependency edges establish that an edit belongs to this recovery. */
export function sameRecordCreateDependents(
  state: ModuleStorage,
  scope: Scope,
  originalId: string,
): JournalEntry[] {
  const scoped = state.journal.filter(
    (entry) =>
      entry.userId === scope.userId && entry.workspaceId === scope.workspaceId,
  );
  const original = scoped.find((entry) => entry.id === originalId);
  if (!original) return [];
  const id = input(original.call).id?.toLowerCase();
  return createDependents(scoped, originalId).filter(
    (entry) =>
      entry.state !== "accepted" &&
      ["update", "archive"].includes(entry.call.action) &&
      entry.call.moduleId === original.call.moduleId &&
      entry.call.resource === original.call.resource &&
      typeof journalRecordId(entry) === "string" &&
      (journalRecordId(entry) as string).toLowerCase() === id,
  );
}

/**
 * Prepare one atomic journal replacement after authoritative cancellation.
 * No existing server record is edited and no submitted child request is rewritten.
 * The caller commits the returned state under both the scope's sync and storage locks.
 */
export async function prepareCreateReplacement(
  state: ModuleStorage,
  scope: Scope,
  originalId: string,
  replacement: ModuleCall,
  authorized: (call: ModuleCall, state?: ModuleStorage) => boolean,
  targets: CreateRecoveryTargets = {},
  draftChoices: CreateDraftChoices = {},
): Promise<ModuleStorage> {
  const scoped = state.journal.filter(
    (entry) =>
      entry.userId === scope.userId && entry.workspaceId === scope.workspaceId,
  );
  const original = scoped.find((entry) => entry.id === originalId);
  if (
    !original ||
    original.supersededBy ||
    original.call.action !== "create" ||
    !["conflict", "rejected"].includes(original.state) ||
    original.settlement !== "cancelled"
  )
    throw new JournalConflictError(
      "The server must confirm the original create is cancelled before its record identity can change.",
    );
  if (
    !replacement.key ||
    replacement.key.length < 8 ||
    replacement.key.length > 128 ||
    state.journal.some((entry) => entry.id === replacement.key) ||
    replacement.action !== "create" ||
    replacement.moduleId !== original.call.moduleId ||
    replacement.resource !== original.call.resource ||
    !replacement.resource
  )
    throw new JournalConflictError(
      "Create a fresh request for the same resource.",
    );
  const fromId = input(original.call).id,
    toId = input(replacement).id;
  assertSchema(recordId, fromId);
  assertSchema(recordId, toId);
  if (fromId.toLowerCase() === toId.toLowerCase())
    throw new JournalConflictError(
      "Choose a new record identity for this separate create.",
    );
  const branches = createDependents(scoped, originalId);
  for (const entry of branches.filter((entry) => entry.state === "accepted")) {
    const { module } = await responseContract(state, entry.call);
    validateModuleResponse(module, entry.call, entry.result);
  }
  const children = branches.filter((entry) => entry.state !== "accepted");
  if (
    children.some(
      (entry) =>
        // Only a permanent server fence permits an attempted request to enter
        // the existing explicit review flow. Its exact call and key survive.
        !(
          entry.settlement === "cancelled" &&
          ["rejected", "conflict"].includes(entry.state)
        ) &&
        ((entry.state !== "pending" &&
          !(
            entry.state === "conflict" &&
            (entry.recordRecovery || entry.createRecovery)
          )) ||
          entry.delivery !== "unsubmitted" ||
          entry.attempts !== 0),
    )
  )
    throw new JournalConflictError(
      "Some linked work may already have been submitted. Recover its outcome before changing this record identity.",
    );
  if (
    children.some((entry) =>
      entry.call.action === "operation"
        ? !entry.call.operation || !!entry.call.resource
        : !["create", "update", "archive"].includes(entry.call.action) ||
          !entry.call.resource,
    )
  )
    throw new JournalConflictError(
      "This linked work has no recoverable resource or command contract.",
    );
  if (
    scoped.some(
      (entry) =>
        !entry.supersededBy &&
        entry.id !== originalId &&
        entry.call.action === "create" &&
        entry.call.moduleId === replacement.moduleId &&
        entry.call.resource === replacement.resource &&
        input(entry.call).id?.toLowerCase() === toId.toLowerCase(),
    )
  )
    throw new JournalConflictError(
      "This record identity already belongs to another saved create.",
    );
  if (
    children.some(
      (entry) =>
        entry.call.action === "create" &&
        entry.call.moduleId === original.call.moduleId &&
        entry.call.resource === original.call.resource &&
        input(entry.call).id?.toLowerCase() === fromId.toLowerCase(),
    )
  )
    throw new JournalConflictError(
      "A second create uses the same record identity. Review that create separately before recovery.",
    );
  const sameRecord = new Set(
    sameRecordCreateDependents(state, scope, originalId).map(
      (entry) => entry.id,
    ),
  );
  if (
    [...sameRecord].some(
      (id) => !["separate", "existing"].includes(targets[id] ?? ""),
    ) ||
    Object.keys(targets).some((id) => !sameRecord.has(id))
  )
    throw new JournalConflictError(
      "Choose where to review each later edit before creating a separate record.",
    );
  if (
    ![replacement, ...children.map((entry) => entry.call)].every((call) =>
      authorized(call, state),
    )
  )
    throw new JournalConflictError(
      "Current access does not allow recovery of all linked work.",
    );
  const ownDraft = resourceDraftKey(
    original.call.moduleId,
    original.call.resource!,
    { entryId: originalId },
  );
  const drafts = await collisionDrafts(state, scope, originalId);
  for (const [key, draft] of Object.entries(state.drafts)) {
    if (
      key === ownDraft ||
      state.draftReviews?.[key]?.entryId === originalId ||
      children.some((entry) => entry.settlement === "cancelled" && entry.id === state.draftReviews?.[key]?.entryId) ||
      drafts.some((draft) => draft.key === key) ||
      key.split("/").length === 2
    )
      continue;
    // Unsent drafts lack a durable dependency edge. Never guess whether a matching ID
    // means this provisional parent or the existing corporate record.
    if (containsRecordId(draft, fromId))
      throw new JournalConflictError(
        "A saved draft also refers to this record. Review or queue that draft before creating a separate record.",
      );
  }
  const result = structuredClone(state);
  const keys = new Map<string, string>([[originalId, replacement.key]]);
  const reserved = new Set(state.journal.map((entry) => entry.id));
  reserved.add(replacement.key);
  for (const child of children) {
    // Attempted requests retain their fenced identity and input until explicit review.
    if (child.call.action === "operation" || child.settlement === "cancelled") {
      keys.set(child.id, child.id);
      continue;
    }
    let key: string;
    do {
      key = crypto.randomUUID();
    } while (reserved.has(key));
    reserved.add(key);
    keys.set(child.id, key);
  }
  const from = {
    moduleId: original.call.moduleId,
    resource: replacement.resource,
    id: fromId,
  };
  const additions: JournalEntry[] = [];
  for (const prior of [original, ...children]) {
    const call = structuredClone(prior === original ? replacement : prior.call);
    call.key = keys.get(prior.id)!;
    const { module, contract } = await responseContract(state, call);
    (result.responseContracts ??= {})[responseContractKey(call)] = contract;
    const recovery = sameRecord.has(prior.id)
      ? {
          targetId: targets[prior.id] === "separate" ? toId : fromId,
          destination: targets[prior.id]!,
        }
      : prior.recordRecovery;
    if (prior !== original && (call.action === "operation" || prior.settlement === "cancelled")) {
      const operation = call.operation && module.operations[call.operation];
      if (
        call.action === "operation"
          ? !operation || operation.policy !== "queued" || operation.kind === "query" || operation.serviceOnly
          : module.resources[call.resource!]?.policy !== "queued"
      )
        throw new JournalConflictError(
          "Only public queued changes can be reviewed after a create collision.",
        );
      const command = result.journal.find(
        (entry) =>
          entry.id === prior.id &&
          entry.userId === scope.userId &&
          entry.workspaceId === scope.workspaceId,
      )!;
      const recoveries = (command.createRecovery ??= []);
      const previous = recoveries.find(
        (recovery) =>
          recovery.moduleId === from.moduleId &&
          recovery.resource === from.resource &&
          (recovery.replacementId === fromId || recovery.originalId === fromId),
      );
      if (previous) previous.replacementId = toId;
      else
        recoveries.push({
          moduleId: from.moduleId,
          resource: from.resource,
          originalId: fromId,
          replacementId: toId,
        });
      command.captureDependencies ??= [
        ...(command.requestedDependencies ?? command.dependencies),
      ];
      command.requestedDependencies = (
        command.requestedDependencies ?? command.dependencies
      ).map((id) => keys.get(id) ?? id);
      command.dependencies = command.dependencies.map(
        (id) => keys.get(id) ?? id,
      );
      command.state = "conflict";
      if (recovery) command.recordRecovery = recovery;
      command.error =
        "A prerequisite record was replaced. Review this change before submitting it. Its original input is preserved.";
      continue;
    }
    const value = input(call);
    const schema = module.resources[call.resource!].schema;
    if (!recovery && call.action !== "archive")
      call.input = {
        ...value,
        data: remapResourceReferences(schema, value.data, from, toId),
      };
    // A child's original base snapshot describes the server record and must not be rewritten.
    additions.push({
      ...scope,
      id: call.key,
      call,
      dependencies: [
        ...new Set(prior.dependencies.map((id) => keys.get(id) ?? id)),
      ],
      state: recovery ? "conflict" : "pending",
      ...(recovery
        ? {
            recordRecovery: recovery,
            error: `Review this saved ${call.action === "archive" ? "archive" : "edit"} on the ${recovery.destination === "separate" ? "separate record" : "existing corporate record"} before submitting it. Its original input is preserved.`,
          }
        : {}),
      createdAt: Date.now(),
      attempts: 0,
      delivery: "unsubmitted",
    });
  }
  result.journal = result.journal.map((entry) => {
    const key = keys.get(entry.id);
    if (
      !key ||
      key === entry.id ||
      entry.userId !== scope.userId ||
      entry.workspaceId !== scope.workspaceId
    )
      return entry;
    return { ...entry, supersededBy: key };
  });
  result.journal.push(...additions);
  for (const entry of additions) {
    const { module } = await responseContract(result, entry.call);
    entry.dependencies = [
      ...new Set([
        ...entry.dependencies,
        ...referenceDependencies(
          module.resources[entry.call.resource!].schema,
          entry.call,
          result.journal,
          scope,
        ),
      ]),
    ];
  }
  preserveCollisionDrafts(
    result,
    drafts,
    draftChoices,
    from,
    toId,
    replacement.key,
    (call) => authorized(call, result),
  );
  // A prior preservation choice can still point at an unrelated existing record.
  // Keep its input unchanged while reconnecting the replaced prerequisite.
  for (const review of Object.values(result.draftReviews ?? {}))
    if (review.collision?.parentId === originalId && !review.collision.ready)
      review.collision.parentId = replacement.key;
  removeResourceDraft(result, ownDraft);
  for (const [key, review] of Object.entries(result.draftReviews ?? {}))
    if (review.entryId === originalId) removeResourceDraft(result, key);
  assertJournalOrder(result.journal, scope);
  if (
    ![...additions, ...children].every((entry) =>
      authorized(entry.call, result),
    )
  )
    throw new JournalConflictError(
      "Current access changed during recovery. Your input is preserved.",
    );
  return result;
}
