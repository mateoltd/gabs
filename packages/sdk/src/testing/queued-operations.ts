import {
  assertSchema,
  type ModuleCall,
  type ModuleDefinition,
  type ModuleQueue,
  type QueuedOperationIdentity,
} from "../index";
import { canonical } from "../contracts/registry";
import type { JournalEntry } from "../contracts/sync";

/** In-memory development simulation only. Production hosts supply durable storage. */
export function simulateQueuedOperations(
  module: ModuleDefinition,
  journal: JournalEntry[],
  identity: { userId: string; workspaceId: string },
  authorize: (call: ModuleCall) => unknown,
): ModuleQueue {
  function get(key: QueuedOperationIdentity) {
    if (key.moduleId !== module.id || key.moduleVersion !== module.version)
      throw Error("Use the matching simulated module release.");
    authorize({ ...key, action: "operation", input: {} });
    const entry = journal.find(
      (entry) => entry.id === key.key && entry.call.operation === key.operation,
    );
    if (!entry) return undefined;
    const common = {
      ...key,
      input: structuredClone(entry.call.input),
      dependencies: [...entry.dependencies],
    };
    if (entry.state === "accepted")
      return {
        ...common,
        state: "accepted",
        value: structuredClone(entry.result),
      };
    if (entry.state === "pending")
      return {
        ...common,
        state: "pending",
        delivery: entry.delivery ?? "uncertain",
      };
    return {
      ...common,
      state: entry.state,
      error: {
        message: entry.error ?? "Rejected by the simulated server.",
        ...(entry.errorCode ? { code: entry.errorCode } : {}),
        ...(entry.businessError !== undefined
          ? { businessError: structuredClone(entry.businessError) }
          : {}),
      },
    };
  }
  return {
    async get(key) {
      return get(key);
    },
    async capture(call, dependencies) {
      authorize(call);
      const op = module.operations[call.operation ?? ""];
      if (
        !op ||
        call.action !== "operation" ||
        op.policy !== "queued" ||
        op.kind === "query" ||
        op.serviceOnly ||
        !call.key
      )
        throw Error("Only queued commands can be captured.");
      assertSchema(op.input, call.input);
      const old = journal.find((entry) => entry.id === call.key);
      if (
        old &&
        (canonical(old.call) !== canonical(call) ||
          canonical(old.dependencies) !== canonical(dependencies))
      )
        throw Error(
          "This retry identity already belongs to different input or prerequisites.",
        );
      if (!old)
        journal.push({
          id: call.key,
          ...identity,
          call: structuredClone(call),
          dependencies: [...dependencies],
          state: "pending",
          delivery: "unsubmitted",
          createdAt: Date.now(),
          attempts: 0,
        });
      return get({
        moduleId: module.id,
        moduleVersion: module.version,
        operation: call.operation!,
        key: call.key,
      });
    },
  };
}
