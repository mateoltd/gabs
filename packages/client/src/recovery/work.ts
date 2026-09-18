import {
  assertSchema,
  type ModuleCall,
  type ModuleDefinition,
} from "@suite/module-sdk";
import {
  SavedWorkRecoverySchema,
  type SavedWorkRecovery,
} from "@suite/module-sdk/platform";
import { canonical } from "@suite/module-sdk/registry";
import type { Scope } from "../index";
import type { ModuleStorage } from "../modules/storage";
import { responseContract, validateModuleResponse } from "../modules/response";

export type WorkSelection = { requestId: string } | { draftKey: string };

export function savedWorkCalls(input: SavedWorkRecovery): ModuleCall[] {
  if (input.selection === "request")
    return [
      input.entry.call,
      ...(input.review
        ? [
            {
              ...input.review.source,
              moduleVersion: input.review.moduleVersion,
            },
          ]
        : []),
    ];
  const call: ModuleCall = {
    moduleId: input.moduleId,
    moduleVersion: input.moduleVersion,
    resource: input.resource,
    action: input.target ? "update" : "create",
    input: {},
  };
  return [
    call,
    { ...call, moduleVersion: input.draftVersion },
    ...(input.review?.collision
      ? [{ ...call, moduleVersion: input.review.collision.moduleVersion }]
      : []),
    ...(input.entry ? [input.entry.call] : []),
  ];
}

export function validateSavedWork(
  input: SavedWorkRecovery,
  scope: Scope,
  moduleId: string,
) {
  if (
    input.userId !== scope.userId ||
    input.workspaceId !== scope.workspaceId ||
    input.moduleId !== moduleId
  )
    throw Error(
      "The saved work belongs to another account, workspace or module.",
    );
  const entry = input.entry;
  if (
    entry &&
    (entry.userId !== input.userId ||
      entry.workspaceId !== input.workspaceId ||
      entry.call.moduleId !== moduleId ||
      (entry.call.key !== undefined && entry.id !== entry.call.key))
  )
    throw Error(
      "The saved request identity does not match this recovery file.",
    );
  if (input.selection === "request") {
    if (
      input.moduleVersion !== input.entry.call.moduleVersion ||
      (input.review &&
        (input.entry.call.action !== "operation" ||
          canonical(input.review.source) !== canonical(input.entry.call)))
    )
      throw Error("The saved review does not match the original request.");
  } else {
    if (
      input.key.split("/")[0] !== moduleId ||
      input.key.split("/")[1] !== input.resource ||
      (entry &&
        (entry.call.action === "operation" ||
          entry.call.resource !== input.resource ||
          entry.id !== input.review?.entryId)) ||
      (input.review?.recoveryInput &&
        input.review.recoveryInput.moduleVersion !== input.moduleVersion)
    )
      throw Error("The saved draft does not match its original resource.");
  }
  if (
    savedWorkCalls(input).some(
      (call) => call.moduleId !== moduleId || !call.moduleVersion,
    )
  )
    throw Error("The original saved-work contract is unavailable.");
  return input;
}

/** Resolve every source version separately, including reviews retained across upgrades. */
export async function savedWorkContracts(
  state: ModuleStorage,
  input: SavedWorkRecovery,
) {
  const modules = new Map<string, ModuleDefinition>();
  for (const call of savedWorkCalls(input)) {
    const { module } = await responseContract(state, call);
    modules.set(module.version, module);
  }
  if (input.entry?.state === "accepted")
    validateModuleResponse(
      modules.get(input.entry.call.moduleVersion)!,
      input.entry.call,
      input.entry.result,
    );
  return [...modules.values()];
}

export function checkSavedWorkPermissions(
  input: SavedWorkRecovery,
  current: ModuleDefinition,
  originals: readonly ModuleDefinition[],
  granted: (permission: string) => boolean,
) {
  if (current.id !== input.moduleId)
    throw Error("The recovery module identity changed.");
  for (const call of savedWorkCalls(input)) {
    const original = originals.find(
      (module) =>
        module.id === call.moduleId && module.version === call.moduleVersion,
    );
    if (!original)
      throw Error("Reconnect to verify the original saved-work contract.");
    if (call.action === "operation") {
      const operation = Object.hasOwn(original.operations, call.operation!)
        ? original.operations[call.operation!]
        : undefined;
      const active = Object.hasOwn(current.operations, call.operation!)
        ? current.operations[call.operation!]
        : undefined;
      if (
        !operation ||
        operation.policy !== "queued" ||
        operation.kind === "query" ||
        operation.serviceOnly ||
        !granted(operation.permission) ||
        (active && !granted(active.permission))
      )
        throw Error("Current access does not allow exporting this command.");
    } else {
      const resource = Object.hasOwn(original.resources, call.resource!)
        ? original.resources[call.resource!]
        : undefined;
      if (
        !resource ||
        resource.policy === "local" ||
        !granted(`${call.moduleId}.${call.resource}.read`) ||
        !granted(`${call.moduleId}.${call.resource}.write`)
      )
        throw Error(
          "Current access does not allow exporting this resource input.",
        );
    }
  }
}

/** Export a fresh stored snapshot. Device states/results remain observations, not authorization. */
export async function createSavedWorkRecovery(
  state: ModuleStorage,
  scope: Scope,
  moduleId: string,
  selection: WorkSelection,
) {
  const identity = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...scope,
    moduleId,
  };
  let value: unknown;
  if ("requestId" in selection) {
    const entry = state.journal.find(
      (entry) => entry.id === selection.requestId && !entry.supersededBy,
    );
    if (!entry) throw Error("This saved request is no longer available.");
    value = {
      ...identity,
      selection: "request",
      moduleVersion: entry.call.moduleVersion,
      entry,
      review: state.commandReviews?.[entry.id],
    };
  } else {
    const key = selection.draftKey;
    if (!Object.hasOwn(state.drafts, key))
      throw Error("This saved draft is no longer available.");
    const review = state.draftReviews?.[key];
    value = {
      ...identity,
      selection: "draft",
      resource: key.split("/")[1],
      key,
      data: state.drafts[key],
      target: state.draftTargets?.[key] ?? null,
      moduleVersion:
        review?.recoveryInput?.moduleVersion ?? state.draftVersions?.[key],
      draftVersion: state.draftVersions?.[key],
      review,
      entry: review?.entryId
        ? state.journal.find((entry) => entry.id === review.entryId)
        : undefined,
    };
  }
  value = JSON.parse(JSON.stringify(value));
  assertSchema(SavedWorkRecoverySchema, value);
  validateSavedWork(value, scope, moduleId);
  await savedWorkContracts(state, value);
  return value;
}
