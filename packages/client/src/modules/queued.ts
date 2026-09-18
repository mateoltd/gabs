import type {
  ModuleCall,
  ModuleQueue,
  QueuedOperationIdentity,
} from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { Platform, Scope } from "../index";
import { enqueue, readModuleStorage } from "./storage";
import { responseContract, validateModuleResponse } from "./response";

function receipt(entry: JournalEntry) {
  const common = {
    moduleId: entry.call.moduleId,
    moduleVersion: entry.call.moduleVersion,
    operation: entry.call.operation,
    key: entry.id,
    input: structuredClone(entry.call.input),
    dependencies: [...entry.dependencies],
  };
  if (entry.state === "accepted")
    return {
      ...common,
      state: entry.state,
      value: structuredClone(entry.result),
    };
  if (entry.state === "pending")
    return {
      ...common,
      state: entry.state,
      delivery: entry.delivery ?? "uncertain",
    };
  return {
    ...common,
    state: entry.state,
    error: {
      message: entry.error ?? "The server rejected this change.",
      ...(entry.errorCode ? { code: entry.errorCode } : {}),
      ...(entry.businessError !== undefined
        ? { businessError: structuredClone(entry.businessError) }
        : {}),
    },
  };
}

/** Bind once to an account/workspace; the host supplies current view, lease and permission checks. */
export function createModuleQueue(
  platform: Platform,
  scope: Scope,
  authorized: (call: ModuleCall) => boolean,
): ModuleQueue {
  async function get(identity: QueuedOperationIdentity) {
    const call: ModuleCall = { ...identity, action: "operation", input: {} };
    if (!authorized(call))
      throw Error("Current access does not allow reading this saved change.");
    const state = await readModuleStorage(platform, scope);
    const entry = state.journal.find(
      (entry) =>
        entry.id === identity.key &&
        entry.userId === scope.userId &&
        entry.workspaceId === scope.workspaceId &&
        entry.call.moduleId === identity.moduleId &&
        entry.call.operation === identity.operation &&
        entry.call.action === "operation",
    );
    if (!entry) return undefined;
    if (!authorized(entry.call))
      throw Error("Current access changed while reading this saved change.");
    if (entry.call.moduleVersion !== identity.moduleVersion)
      throw Error(
        `This saved change belongs to module release ${entry.call.moduleVersion ?? "unknown"}. Use its original contract to review it.`,
      );
    const { module } = await responseContract(state, entry.call);
    if (entry.state === "accepted")
      validateModuleResponse(module, entry.call, entry.result);
    if (!authorized(entry.call))
      throw Error("Current access changed while reading this saved change.");
    return receipt(entry);
  }
  return {
    async capture(raw, dependencies) {
      const call = structuredClone(raw);
      if (
        call.action !== "operation" ||
        !call.operation ||
        !call.moduleVersion ||
        !call.key ||
        call.resource ||
        call.kind
      )
        throw Error(
          "A versioned queued command with a stable identity is required.",
        );
      const entry = await enqueue(
        platform,
        scope,
        call,
        [...dependencies],
        undefined,
        () => authorized(call),
      );
      if (!authorized(call))
        throw Error(
          "Access changed after capture. The saved identity is retained; do not invent a new retry key.",
        );
      const result = await get({
        moduleId: call.moduleId,
        moduleVersion: call.moduleVersion,
        operation: call.operation,
        key: entry.id,
      });
      if (!result)
        throw Error(
          "The saved change could not be read after capture. Retain its original identity.",
        );
      return result;
    },
    get,
  };
}
