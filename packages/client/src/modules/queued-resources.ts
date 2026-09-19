import {
  assertSchema,
  resourceMutationSchema,
  Type,
  type ModuleCall,
  type ModuleResourceQueue,
  type QueuedResourceIdentity,
} from "@suite/module-sdk";
import { RequestKeySchema } from "@suite/contracts";
import type { Platform, Scope } from "../index";
import { enqueue, readModuleStorage } from "./storage";
import { responseContract, validateModuleResponse } from "./response";

/** Corporate capture uses original verified schemas and current host authorization. */
export function createModuleResourceQueue(
  platform: Platform,
  scope: Scope,
  authorized: (call: ModuleCall) => boolean,
  canCapture: (call: ModuleCall) => boolean = () => true,
): ModuleResourceQueue {
  async function get(identity: QueuedResourceIdentity) {
    const call: ModuleCall = { ...identity, input: {} };
    if (!authorized(call))
      throw Error("Current access does not allow reading this saved change.");
    const state = await readModuleStorage(platform, scope);
    const entry = state.journal.find(
      (entry) =>
        entry.id === identity.key &&
        entry.userId === scope.userId &&
        entry.workspaceId === scope.workspaceId &&
        entry.call.moduleId === identity.moduleId &&
        entry.call.resource === identity.resource &&
        entry.call.action === identity.action,
    );
    if (!entry) return undefined;
    if (!authorized(entry.call))
      throw Error("Current access changed while reading this saved change.");
    if (entry.call.moduleVersion !== identity.moduleVersion)
      throw Error(
        "Use the original release to inspect this saved resource write.",
      );
    const { module } = await responseContract(state, entry.call);
    if (entry.state === "accepted")
      validateModuleResponse(module, entry.call, entry.result);
    if (!authorized(entry.call))
      throw Error("Current access changed while reading this saved change.");
    const common = {
      ...identity,
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
      },
    };
  }
  return {
    get,
    async capture(raw, dependencies) {
      const call = structuredClone(raw);
      if (
        !call.resource ||
        !call.moduleVersion ||
        !call.key ||
        call.operation ||
        call.kind ||
        (call.action !== "create" &&
          call.action !== "update" &&
          call.action !== "archive")
      )
        throw Error(
          "A versioned resource write with a stable identity is required.",
        );
      if (!authorized(call) || !canCapture(call))
        throw Error(
          "Current access does not allow saving a new pending change.",
        );
      const { module } = await responseContract(
        await readModuleStorage(platform, scope),
        call,
      );
      const resource = Object.hasOwn(module.resources, call.resource)
        ? module.resources[call.resource]
        : undefined;
      if (
        !resource ||
        resource.policy !== "queued" ||
        (resource.appendOnly && call.action !== "create")
      )
        throw Error("This resource action does not allow queued capture.");
      assertSchema(RequestKeySchema, call.key);
      assertSchema(
        Type.Array(RequestKeySchema, { uniqueItems: true, maxItems: 100 }),
        dependencies,
      );
      assertSchema(
        resourceMutationSchema(resource.schema, call.action),
        call.input,
      );
      const entry = await enqueue(
        platform,
        scope,
        call,
        [...dependencies],
        undefined,
        () => authorized(call) && canCapture(call),
      );
      if (!authorized(call))
        throw Error(
          "Access changed after capture. Retain the saved identity before retrying.",
        );
      const result = await get({
        moduleId: call.moduleId,
        moduleVersion: call.moduleVersion,
        resource: call.resource,
        action: call.action,
        key: entry.id,
      });
      if (!result)
        throw Error(
          "The saved resource write could not be read. Retain its original identity.",
        );
      return result;
    },
  };
}
