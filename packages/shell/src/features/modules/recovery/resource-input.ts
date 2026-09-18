import type { Scope } from "@suite/client";
import type { ModuleStorage } from "@suite/client/module-storage";
import {
  responseContract,
  validateModuleResponse,
} from "@suite/client/module-response";
import type {
  ModuleCall,
  ModuleDefinition,
  ResourceRecord,
} from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";

export function canInspectResource(
  call: ModuleCall,
  current: ModuleDefinition,
  original: ModuleDefinition,
  granted: (permission: string) => boolean,
) {
  return (
    call.moduleId === current.id &&
    original.id === current.id &&
    original.version === call.moduleVersion &&
    !!call.resource &&
    !call.operation &&
    !call.kind &&
    ["create", "update", "archive"].includes(call.action) &&
    Object.hasOwn(original.resources, call.resource) &&
    original.resources[call.resource].policy !== "local" &&
    granted(`${current.id}.${call.resource}.read`) &&
    granted(`${current.id}.${call.resource}.write`)
  );
}

export interface ResourceInput {
  call: ModuleCall;
  module: ModuleDefinition;
}
export interface SavedResourceDraft extends ResourceInput {
  key: string;
  data: Record<string, unknown>;
  target: ResourceRecord | null;
  review?: NonNullable<ModuleStorage["draftReviews"]>[string];
  source?: ResourceInput & {
    data: Record<string, unknown>;
    target: ResourceRecord | null;
  };
}

/** Each saved value is interpreted only by its retained original contract. */
export async function resourceRecoveryInputs(
  state: ModuleStorage,
  scope: Scope,
  moduleId: string,
) {
  const changes: (ResourceInput & { entry: JournalEntry })[] = [];
  const drafts: SavedResourceDraft[] = [];
  const failures: unknown[] = [];
  for (const entry of state.journal) {
    if (
      entry.userId !== scope.userId ||
      entry.workspaceId !== scope.workspaceId ||
      entry.call.moduleId !== moduleId ||
      entry.supersededBy ||
      !["create", "update", "archive"].includes(entry.call.action) ||
      (entry.state === "accepted" && entry.recoveredAt === undefined)
    )
      continue;
    try {
      const { module } = await responseContract(state, entry.call);
      if (entry.state === "accepted")
        validateModuleResponse(module, entry.call, entry.result);
      changes.push({ entry, call: entry.call, module });
    } catch (error) {
      failures.push(error);
    }
  }
  for (const [key, data] of Object.entries(state.drafts)) {
    const [id, resource] = key.split("/");
    if (id !== moduleId || !resource) continue;
    try {
      const review = state.draftReviews?.[key];
      const target = state.draftTargets?.[key] ?? null;
      const call: ModuleCall = {
        moduleId,
        resource,
        action: target ? "update" : "create",
        input: {},
        moduleVersion:
          review?.recoveryInput?.moduleVersion ?? state.draftVersions?.[key],
      };
      const { module } = await responseContract(state, call);
      let source: SavedResourceDraft["source"];
      if (review?.collision) {
        const sourceCall = {
          ...call,
          moduleVersion: review.collision.moduleVersion,
        };
        const original = await responseContract(state, sourceCall);
        source = {
          call: sourceCall,
          module: original.module,
          data: review.collision.sourceData,
          target: review.collision.sourceTarget,
        };
      }
      drafts.push({ key, data, target, review, call, module, source });
    } catch (error) {
      failures.push(error);
    }
  }
  return { changes, drafts, failures };
}
