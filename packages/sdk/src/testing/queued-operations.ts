import {
  assertSchema,
  type ModuleCall,
  type ModuleDefinition,
  type ModuleQueue,
  type QueuedOperationIdentity,
  type QueuedResourceIdentity,
  resourceMutationSchema,
} from "../index";
import { canonical } from "../contracts/registry";
import type { JournalEntry } from "../contracts/sync";
import {
  assertJournalOrder,
  recordDependencies,
  referenceDependencies,
} from "../runtime/journal/ordering";
import {
  queueDependenciesSchema,
  queueKeySchema,
} from "../client/queued-operation";

/** In-memory development simulation only. Production hosts supply durable storage. */
export function simulateQueuedOperations(
  module: ModuleDefinition,
  journal: JournalEntry[],
  identity: { userId: string; workspaceId: string },
  authorize: (call: ModuleCall) => unknown,
): ModuleQueue {
  function get(key: QueuedOperationIdentity | QueuedResourceIdentity) {
    if (key.moduleId !== module.id || key.moduleVersion !== module.version)
      throw Error("Use the matching simulated module release.");
    authorize({
      ...key,
      action: "action" in key ? key.action : "operation",
      input: {},
    });
    if ("resource" in key) authorize({ ...key, action: "get", input: {} });
    const entry = journal.find(
      (entry) =>
        entry.id === key.key &&
        ("operation" in key
          ? entry.call.action === "operation" &&
            entry.call.operation === key.operation
          : entry.call.action === key.action &&
            entry.call.resource === key.resource),
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
    resources: {
      async get(key) {
        return get(key);
      },
      async capture(call, dependencies) {
        authorize(call);
        authorize({ ...call, action: "get" });
        const resource =
          call.resource && Object.hasOwn(module.resources, call.resource)
            ? module.resources[call.resource]
            : undefined;
        if (
          !resource ||
          !call.key ||
          call.moduleVersion !== module.version ||
          resource.policy !== "queued" ||
          call.operation ||
          call.kind ||
          (call.action !== "create" &&
            call.action !== "update" &&
            call.action !== "archive") ||
          (resource.appendOnly && call.action !== "create")
        )
          throw Error("Only queued resource writes can be captured.");
        assertSchema(
          resourceMutationSchema(resource.schema, call.action),
          call.input,
        );
        assertSchema(queueKeySchema, call.key);
        assertSchema(queueDependenciesSchema, dependencies);
        if (dependencies.includes(call.key))
          throw Error("A saved write cannot depend on itself.");
        captureSimulatedEntry(module, journal, identity, call, dependencies);
        return get({
          moduleId: module.id,
          moduleVersion: module.version,
          resource: call.resource!,
          action: call.action,
          key: call.key,
        });
      },
    },
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
      assertSchema(queueKeySchema, call.key);
      assertSchema(queueDependenciesSchema, dependencies);
      if (dependencies.includes(call.key))
        throw Error("A saved command cannot depend on itself.");
      captureSimulatedEntry(module, journal, identity, call, dependencies);
      return get({
        moduleId: module.id,
        moduleVersion: module.version,
        operation: call.operation!,
        key: call.key,
      });
    },
  };
}

/** Shared by preview submission and typed queues; all checks finish before mutation. */
export function captureSimulatedEntry(
  module: ModuleDefinition,
  journal: JournalEntry[],
  identity: Pick<JournalEntry, "userId" | "workspaceId">,
  call: ModuleCall,
  dependencies: string[] = [],
) {
  if (!call.key) throw Error("A captured write requires a stable key.");
  const old = journal.find((entry) => entry.id === call.key);
  if (old) {
    if (
      canonical(old.call) !== canonical(call) ||
      canonical(
        [
          ...(old.captureDependencies ??
            old.requestedDependencies ??
            old.dependencies),
        ].sort(),
      ) !== canonical([...dependencies].sort())
    )
      throw Error(
        "This retry identity already belongs to different input or prerequisites.",
      );
    return;
  }
  const schema =
    call.action === "operation"
      ? module.operations[call.operation!].input
      : module.resources[call.resource!].schema;
  const entry: JournalEntry = {
    id: call.key,
    ...identity,
    call: structuredClone(call),
    dependencies: [
      ...new Set([
        ...dependencies,
        ...recordDependencies(call, journal, identity),
        ...referenceDependencies(schema, call, journal, identity),
      ]),
    ],
    requestedDependencies: [...dependencies],
    captureDependencies: [...dependencies],
    state: "pending",
    delivery: "unsubmitted",
    createdAt: Date.now(),
    attempts: 0,
  };
  if (call.action === "operation")
    assertSchema(queueDependenciesSchema, entry.dependencies);
  assertJournalOrder([...journal, entry], identity);
  journal.push(entry);
}
