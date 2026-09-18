import type { ModuleStorage } from "./storage";
import type { Scope } from "../index";

export type DraftReview = NonNullable<ModuleStorage["draftReviews"]>[string];

export function resourceDraftKey(
  moduleId: string,
  resource: string,
  review?: DraftReview,
) {
  const id = review?.entryId ?? review?.draftId;
  return `${moduleId}/${resource}${id ? `/review/${review?.entryId ? "journal" : "direct"}/${encodeURIComponent(id)}` : ""}`;
}

export function removeResourceDraft(state: ModuleStorage, key: string) {
  delete state.drafts[key];
  if (state.draftTargets) delete state.draftTargets[key];
  if (state.draftReviews) delete state.draftReviews[key];
}

/** Lift legacy shared review slots without overwriting an independently saved review. */
export function promoteReviewDrafts(state: ModuleStorage, scope: Scope) {
  for (const [key, original] of Object.entries(state.draftReviews ?? {})) {
    const parts = key.split("/");
    if (parts.length !== 2 || !state.drafts[key]) continue;
    const [moduleId, resource] = parts;
    const target = state.draftTargets?.[key] ?? null;
    let review = original;
    if (review.entryId) {
      if (
        !state.journal.some(
          (entry) =>
            entry.id === review.entryId &&
            entry.userId === scope.userId &&
            entry.workspaceId === scope.workspaceId &&
            entry.call.moduleId === moduleId &&
            entry.call.resource === resource,
        )
      )
        continue;
    } else if (review.comparison && target) {
      review = {
        ...review,
        draftId: review.draftId ?? `legacy:${target.id}:${target.version}`,
      };
    } else continue;
    const destination = resourceDraftKey(moduleId, resource, review);
    if (state.drafts[destination]) continue;
    state.drafts[destination] = state.drafts[key];
    (state.draftTargets ??= {})[destination] = target;
    (state.draftReviews ??= {})[destination] = review;
    removeResourceDraft(state, key);
  }
  return state;
}
