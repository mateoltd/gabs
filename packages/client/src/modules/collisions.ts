import { assertSchema, Type, type ModuleCall } from "@suite/module-sdk";
import { remapResourceReferences } from "@suite/module-sdk/references";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { Scope } from "../index";
import type { ModuleStorage } from "./storage";
import {
  assertJournalOrder,
  JournalConflictError,
  referenceDependencies,
} from "./journal";
import { responseContract, responseContractKey } from "./response";
import { removeResourceDraft, resourceDraftKey } from "./drafts";

const recordId = Type.String({ format: "uuid" });
function input(call: ModuleCall) {
  if (!call.input || typeof call.input !== "object")
    throw new JournalConflictError("The original record input is unavailable.");
  return call.input as { id?: string; data?: unknown; baseData?: unknown };
}
function containsId(value: unknown, id: string): boolean {
  if (typeof value === "string")
    return value.toLowerCase() === id.toLowerCase();
  if (Array.isArray(value)) return value.some((item) => containsId(item, id));
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).some((item) => containsId(item, id))
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
  authorized: (call: ModuleCall) => boolean,
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
  const affected = new Set([originalId]);
  for (let size = -1; size !== affected.size;) {
    size = affected.size;
    for (const entry of scoped)
      if (
        !entry.supersededBy &&
        entry.dependencies.some((id) => affected.has(id))
      )
        affected.add(entry.id);
  }
  const children = scoped.filter(
    (entry) => affected.has(entry.id) && entry.id !== originalId,
  );
  if (
    children.some(
      (entry) =>
        entry.state !== "pending" ||
        entry.delivery !== "unsubmitted" ||
        entry.attempts !== 0,
    )
  )
    throw new JournalConflictError(
      "Some linked work may already have been submitted. Recover its outcome before changing this record identity.",
    );
  if (
    children.some(
      (entry) =>
        !["create", "update"].includes(entry.call.action) ||
        !entry.call.resource,
    )
  )
    throw new JournalConflictError(
      "Linked custom work requires explicit review before changing this record identity.",
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
        entry.call.moduleId === original.call.moduleId &&
        entry.call.resource === original.call.resource &&
        input(entry.call).id?.toLowerCase() === fromId.toLowerCase(),
    )
  )
    throw new JournalConflictError(
      "Linked changes to the same record require explicit review before changing its identity.",
    );
  if (![replacement, ...children.map((entry) => entry.call)].every(authorized))
    throw new JournalConflictError(
      "Current access does not allow recovery of all linked work.",
    );
  const ownDraft = resourceDraftKey(
    original.call.moduleId,
    original.call.resource!,
    { entryId: originalId },
  );
  for (const [key, draft] of Object.entries(state.drafts)) {
    if (key === ownDraft || state.draftReviews?.[key]?.entryId === originalId)
      continue;
    // Unsent drafts lack a durable dependency edge. Never guess whether a matching ID
    // means this provisional parent or the existing corporate record.
    if (containsId(draft, fromId))
      throw new JournalConflictError(
        "A saved draft also refers to this record. Review or queue that draft before creating a separate record.",
      );
  }
  const result = structuredClone(state);
  const keys = new Map<string, string>([[originalId, replacement.key]]);
  const reserved = new Set(state.journal.map((entry) => entry.id));
  reserved.add(replacement.key);
  for (const child of children) {
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
    const value = input(call);
    const { module, contract } = await responseContract(state, call);
    const schema = module.resources[call.resource!].schema;
    call.input = {
      ...value,
      data: remapResourceReferences(schema, value.data, from, toId),
    };
    // A child's original base snapshot describes the server record and must not be rewritten.
    (result.responseContracts ??= {})[responseContractKey(call)] = contract;
    additions.push({
      ...scope,
      id: call.key,
      call,
      dependencies: [
        ...new Set(prior.dependencies.map((id) => keys.get(id) ?? id)),
      ],
      state: "pending",
      createdAt: Date.now(),
      attempts: 0,
      delivery: "unsubmitted",
    });
  }
  result.journal = result.journal.map((entry) => {
    const key = keys.get(entry.id);
    if (
      !key ||
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
  removeResourceDraft(result, ownDraft);
  for (const [key, review] of Object.entries(result.draftReviews ?? {}))
    if (review.entryId === originalId) removeResourceDraft(result, key);
  assertJournalOrder(result.journal, scope);
  if (!additions.every((entry) => authorized(entry.call)))
    throw new JournalConflictError(
      "Current access changed during recovery. Your input is preserved.",
    );
  return result;
}
