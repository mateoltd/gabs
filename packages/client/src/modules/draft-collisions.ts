import type { ModuleCall, ResourceRecord, TSchema } from "@suite/module-sdk";
import {
  referenceValues,
  remapResourceReferences,
} from "@suite/module-sdk/references";
import { canonical } from "@suite/module-sdk/registry";
import type { Scope } from "../index";
import type { ModuleStorage } from "./storage";
import { responseContract } from "./response";
import { resourceDraftKey, removeResourceDraft } from "./drafts";
import { JournalConflictError } from "./journal";

export function containsRecordId(value: unknown, id: string): boolean {
  if (typeof value === "string")
    return value.toLowerCase() === id.toLowerCase();
  if (Array.isArray(value))
    return value.some((item) => containsRecordId(item, id));
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).some((item) => containsRecordId(item, id))
  );
}
export interface CollisionDraft {
  key: string;
  fingerprint: string;
  moduleId: string;
  resource: string;
  moduleVersion?: string;
  title: string;
  data: Record<string, unknown>;
  target: ResourceRecord | null;
  sameRecord: boolean;
  schema?: TSchema;
  movable: boolean;
}
export type CreateDraftChoices = Partial<
  Record<string, { fingerprint: string; destination: "separate" | "existing" }>
>;

/** Inspect the saved contract, not a newer release that may reinterpret a field. */
export async function collisionDrafts(
  state: ModuleStorage,
  scope: Scope,
  originalId: string,
): Promise<CollisionDraft[]> {
  const original = state.journal.find(
    (entry) =>
      entry.id === originalId &&
      entry.userId === scope.userId &&
      entry.workspaceId === scope.workspaceId,
  );
  if (!original?.call.resource) return [];
  const id = (original.call.input as { id?: unknown })?.id;
  if (typeof id !== "string") return [];
  const result: CollisionDraft[] = [];
  for (const [key, data] of Object.entries(state.drafts)) {
    const review = state.draftReviews?.[key];
    const parts = key.split("/");
    if (
      parts.length !== 2 &&
      !(review?.collision?.parentId === originalId && !review.collision.ready)
    )
      continue;
    const [moduleId, resource] = parts;
    const target = state.draftTargets?.[key] ?? null;
    const sameRecord =
      moduleId === original.call.moduleId &&
      resource === original.call.resource &&
      (review?.collision?.targetId ?? target?.id)?.toLowerCase() ===
        id.toLowerCase();
    const moduleVersion = state.draftVersions?.[key];
    let schema: TSchema | undefined,
      title = resource,
      movable = false;
    if (moduleVersion) {
      try {
        const { module } = await responseContract(state, {
          moduleId,
          moduleVersion,
          resource,
          action: target ? "update" : "create",
          input: {},
        });
        schema = module.resources[resource].schema;
        movable = module.resources[resource].policy === "queued";
        title = `${module.name}: ${module.resources[resource].title}`;
      } catch {
        /* Unknown historical meaning permits preservation, never inferred remapping. */
      }
    }
    const linked = schema
      ? referenceValues(schema, data).some(
          ({ target, value }) =>
            target.kind === "resource" &&
            target.moduleId === original.call.moduleId &&
            target.resource === original.call.resource &&
            value.toLowerCase() === id.toLowerCase(),
        )
      : containsRecordId(data, id);
    if (!sameRecord && !linked) continue;
    result.push({
      key,
      moduleId,
      resource,
      moduleVersion,
      title,
      data,
      target,
      sameRecord,
      schema,
      movable,
      fingerprint: canonical({
        data,
        target,
        moduleVersion,
        review,
        generation: state.draftGenerations?.[key] ?? 0,
      }),
    });
  }
  return result;
}

/** Turn an explicitly classified draft into an independent saved review, never an operation. */
export function preserveCollisionDrafts(
  state: ModuleStorage,
  drafts: CollisionDraft[],
  choices: CreateDraftChoices,
  original: { moduleId: string; resource: string; id: string },
  nextId: string,
  parentId: string,
  authorized: (call: ModuleCall) => boolean,
) {
  if (
    Object.keys(choices).some(
      (key) => !drafts.some((draft) => draft.key === key),
    )
  )
    throw new JournalConflictError(
      "The saved drafts changed. Review their current choices before continuing.",
    );
  for (const draft of drafts) {
    const choice = choices[draft.key];
    if (
      !choice ||
      choice.fingerprint !== draft.fingerprint ||
      !["separate", "existing"].includes(choice.destination)
    )
      throw new JournalConflictError(
        "Choose which record each saved draft belongs to. A changed draft needs a fresh choice.",
      );
    if (choice.destination === "separate" && !draft.movable)
      throw new JournalConflictError(
        "This draft cannot be moved safely. Keep its input unchanged and review it in its original module.",
      );
    if (
      !authorized({
        moduleId: draft.moduleId,
        moduleVersion: draft.moduleVersion,
        resource: draft.resource,
        action: draft.target ? "update" : "create",
        input: {},
      })
    )
      throw new JournalConflictError(
        "Current access does not allow recovery of every affected saved draft.",
      );
    if (!draft.movable) continue;
    const previous = state.draftReviews?.[draft.key]?.collision;
    const collision = {
      parentId,
      sourceData: structuredClone(previous?.sourceData ?? draft.data),
      sourceTarget: structuredClone(previous?.sourceTarget ?? draft.target),
      moduleVersion: previous?.moduleVersion ?? draft.moduleVersion,
      ...(draft.target
        ? {
            targetId: draft.sameRecord
              ? choice.destination === "separate"
                ? nextId
                : original.id
              : draft.target.id,
          }
        : {}),
    };
    const review = { draftId: crypto.randomUUID(), collision };
    const key = resourceDraftKey(draft.moduleId, draft.resource, review);
    state.drafts[key] = (
      choice.destination === "separate"
        ? remapResourceReferences(draft.schema!, draft.data, original, nextId)
        : structuredClone(draft.data)
    ) as Record<string, unknown>;
    (state.draftTargets ??= {})[key] = structuredClone(draft.target);
    (state.draftReviews ??= {})[key] = review;
    if (draft.moduleVersion)
      (state.draftVersions ??= {})[key] = draft.moduleVersion;
    removeResourceDraft(state, draft.key);
  }
}
