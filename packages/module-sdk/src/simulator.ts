import {
  listResourceRecords,
  type ResourceListOptions,
} from "./resource-query";
import {
  assertSchema,
  createModuleClient,
  type ModuleCall,
  type ModuleDefinition,
  type ResourceRecord,
  type JsonRecord,
} from "./index";
import { ModuleBusinessError } from "./server";
import { canonical, satisfies } from "./registry";
import { flushJournal, type JournalEntry } from "./sync";
import { createSimulationStores } from "./simulation-stores";
import {
  defineSimulationModule,
  simulationError as rejected,
  type SimulationModule,
  type SimulationGrant,
  type SimulationStoreRecord,
  type SimulationNamespace,
} from "./simulation-fixtures";
export {
  defineFixtures,
  validateFixtures,
  defineSimulationModule,
  grantSimulationServices,
  type ModuleFixtures,
  type SimulationModule,
  type SimulationGrant,
  type ResourceFixtures,
  type StoreFixtures,
  type SimulationRecord,
  type SimulationNamespace,
} from "./simulation-fixtures";

export type SimulatorOptions<M extends ModuleDefinition> = Omit<
  SimulationModule<M>,
  "module"
> & {
  providers?: readonly SimulationModule[];
  personal?: boolean;
};
export const simulationIdentity = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001",
  membershipId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
});
interface NamespaceData {
  records: Record<string, ResourceRecord[]>;
  stores: Record<string, SimulationStoreRecord[]>;
}
export interface SimulatorSnapshot extends NamespaceData {
  scope: { userId: string; workspaceId: string };
  journal: JournalEntry[];
  events: { moduleId: string; name: string; payload: unknown }[];
  audits: {
    moduleId: string;
    action: string;
    targetId: string;
    requestId: string;
    actorId: string;
    workspaceId: string;
  }[];
  online: boolean;
  permissions: string[];
  grants: SimulationGrant[];
  providers: Record<
    string,
    NamespaceData & { module: ModuleDefinition; permissions: string[] }
  >;
}
/** Isolated development transactions. Corporate authority and SQL acceptance still belong to the server. */
export function createModuleSimulator<M extends ModuleDefinition>(
  module: M,
  options: SimulatorOptions<M> = {},
) {
  const root = defineSimulationModule(module, options);
  const modules = new Map<string, SimulationModule>();
  let data: Record<string, NamespaceData> = {};
  const permissions = new Map<string, string[]>();
  let grants: SimulationGrant[] = [];
  let online = true;
  const journal: JournalEntry[] = [],
    events: SimulatorSnapshot["events"] = [],
    audits: SimulatorSnapshot["audits"] = [];
  const receipts = new Map<string, { request: string; result: unknown }>();
  const stores = new Map<string, ReturnType<typeof createSimulationStores>>();
  const recordAudit = (
    moduleId: string,
    action: string,
    targetId: string,
    requestId: string,
  ) => {
    audits.push({
      moduleId,
      action,
      targetId,
      requestId,
      actorId: simulationIdentity.userId,
      workspaceId: simulationIdentity.workspaceId,
    });
  };
  for (const input of [root, ...(options.providers ?? [])]) {
    const fixture = defineSimulationModule(input.module, input),
      current = fixture.module;
    if (modules.has(current.id))
      throw Error(`Duplicate simulation module: ${current.id}`);
    modules.set(current.id, fixture);
    permissions.set(current.id, [...current.permissions]);
    data[current.id] = {
      records: Object.fromEntries(
        Object.keys(current.resources).map((name) => [
          name,
          [
            ...(fixture.fixtures?.[name] ?? []).map((value) => ({
              id: crypto.randomUUID(),
              data: structuredClone(value) as JsonRecord,
              version: 1,
              archived: false,
              updatedAt: new Date().toISOString(),
            })),
            ...(fixture.records?.[name] ?? []).map((value) => ({
              ...structuredClone(value),
              data: structuredClone(value.data) as JsonRecord,
              id: value.id.toLowerCase(),
              version: value.version ?? 1,
              archived: value.archived ?? false,
              updatedAt: new Date().toISOString(),
            })),
          ],
        ]),
      ),
      stores: Object.fromEntries(
        Object.keys(current.stores ?? {}).map((name) => [
          name,
          (fixture.stores?.[name] ?? []).map((value) => ({
            ...structuredClone(value),
            data: structuredClone(value.data) as JsonRecord,
            id: value.id.toLowerCase(),
            version: value.version ?? 1,
            archived: value.archived ?? false,
          })),
        ]),
      ),
    };
    stores.set(
      current.id,
      createSimulationStores(
        current,
        () => data[current.id].stores,
        (action, targetId, requestId) =>
          recordAudit(current.id, action, targetId, requestId),
      ),
    );
  }
  function setGrants(values: readonly SimulationGrant[]) {
    for (const grant of values) {
      const consumer = modules.get(grant.consumerId)?.module,
        provider = modules.get(grant.providerId)?.module;
      if (
        !consumer ||
        !provider ||
        !Object.values(consumer.services ?? {}).some(
          (reference) =>
            reference.moduleId === grant.providerId &&
            reference.operation === grant.operation,
        ) ||
        !provider.operations[grant.operation]?.public
      )
        throw rejected(
          400,
          "INVALID_SERVICE_GRANT",
          "A simulation grant must name a declared service and loaded public provider.",
        );
    }
    grants = structuredClone([...values]);
  }
  setGrants([...modules.values()].flatMap((fixture) => fixture.grants ?? []));
  function policy(
    scope: SimulationModule,
    call: ModuleCall,
    active: string[] = [],
  ) {
    const module = scope.module;
    if (call.moduleId !== module.id)
      throw rejected(
        403,
        "CAPABILITY_DENIED",
        "Use declared services for cross-module access.",
      );
    if (call.moduleVersion && call.moduleVersion !== module.version)
      throw rejected(
        409,
        "MODULE_VERSION_MISMATCH",
        "This call belongs to another simulated release.",
      );
    const collection =
      call.action === "operation" ? module.operations : module.resources;
    const name =
      (call.action === "operation" ? call.operation : call.resource) ?? "";
    const definition = Object.hasOwn(collection, name) && collection[name];
    if (!definition)
      throw rejected(404, "NOT_FOUND", "Unknown resource or operation.");
    if (
      call.action === "operation" &&
      module.operations[name].serviceOnly &&
      !active.length
    )
      throw rejected(
        403,
        "SERVICE_ONLY",
        "This operation requires a declared and granted module service call.",
      );
    const permission =
      call.action === "operation"
        ? module.operations[name].permission
        : `${module.id}.${name}.${["get", "list"].includes(call.action) ? "read" : "write"}`;
    if (!permissions.get(module.id)!.includes(permission))
      throw rejected(403, "FORBIDDEN", `Missing permission: ${permission}`);
    if (
      options.personal &&
      (call.action === "operation"
        ? definition.policy !== "local"
        : !("standalone" in definition && definition.standalone))
    )
      throw rejected(
        403,
        "CORPORATE_ONLY",
        "This capability is not standalone.",
      );
    if (!options.personal && definition.policy === "local")
      throw rejected(
        403,
        "LOCAL_ONLY",
        "Use a personal simulator for local capabilities.",
      );
    return definition.policy;
  }
  const execute = async (
    scope: SimulationModule,
    call: ModuleCall,
    requestId: string,
    active: string[] = [],
  ): Promise<unknown> => {
    const module = scope.module;
    policy(scope, call, active);
    if (call.action === "operation") {
      const name = call.operation!,
        definition = module.operations[name],
        identity = `${module.id}.${name}`;
      if (active.includes(identity) || active.length >= 16)
        throw rejected(
          409,
          "SERVICE_CYCLE",
          "A cyclic or excessively deep service call was rejected.",
        );
      if (!scope.server)
        throw rejected(
          409,
          "BACKEND_UNAVAILABLE",
          `Supply a scoped backend for ${module.id}@${module.version}.`,
        );
      const readOnly = definition.kind === "query";
      let failure: unknown,
        failed = false,
        closed = false;
      const pending = new Set<Promise<unknown>>();
      const guarded = <T>(
        write: boolean,
        run: () => Promise<T>,
      ): Promise<T> => {
        const task = Promise.resolve().then(() => {
          if (closed)
            throw rejected(
              409,
              "OPERATION_CLOSED",
              "This simulated operation has already finished.",
            );
          if (readOnly && write)
            throw rejected(
              403,
              "QUERY_WRITE_DENIED",
              "Read-only operations cannot change data, lock records, emit events or call commands.",
            );
          return run();
        });
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          (error) => {
            failed = true;
            failure ??= error;
            pending.delete(task);
          },
        );
        return task;
      };
      let result: unknown;
      try {
        const caller = active.at(-1);
        result = await scope.server.execute(name, call.input, {
          actor: {
            id: simulationIdentity.userId,
            membershipId: simulationIdentity.membershipId,
          },
          workspaceId: simulationIdentity.workspaceId,
          requestId,
          ...(caller
            ? {
                caller: {
                  moduleId: caller.slice(0, caller.lastIndexOf(".")),
                  operation: caller.slice(caller.lastIndexOf(".") + 1),
                },
              }
            : {}),
          permissions: permissions.get(module.id)!,
          configuration: scope.configuration ?? {},
          resource: (request) =>
            guarded(!["get", "list"].includes(request.action), async () => {
              if (
                request.action === "operation" ||
                request.moduleId !== module.id
              )
                throw rejected(
                  403,
                  "CAPABILITY_DENIED",
                  "Use declared services for cross-module access.",
                );
              return execute(scope, request, requestId, [...active, identity]);
            }),
          store: (name, command) =>
            guarded(
              !["get", "scan", "query", "aggregate"].includes(command.action) ||
                (command.action === "get" && !!command.lock),
              () => stores.get(module.id)!(name, command, requestId),
            ),
          audit: (action, targetId) =>
            guarded(true, async () => {
              if (
                !module.audit?.includes(action) ||
                typeof targetId !== "string" ||
                !targetId.length ||
                targetId.length > 200
              )
                throw rejected(
                  400,
                  "INVALID_AUDIT",
                  "Use a declared audit action and bounded target identifier.",
                );
              recordAudit(
                module.id,
                `${module.id}.${action}`,
                targetId,
                requestId,
              );
            }),
          emit: (event, payload) =>
            guarded(true, async () => {
              const schema = module.events?.[event];
              if (!schema)
                throw rejected(400, "INVALID_EVENT", "Use a declared event.");
              assertSchema(schema, payload);
              events.push({
                moduleId: module.id,
                name: event,
                payload: structuredClone(payload),
              });
            }),
          service: (alias, input) =>
            guarded(
              module.services?.[alias]?.contract.kind !== "query",
              async () => {
                const reference = module.services?.[alias];
                if (!reference || !module.dependencies[reference.moduleId])
                  throw rejected(
                    403,
                    "UNDECLARED_DEPENDENCY",
                    "Declare the public service and its provider dependency.",
                  );
                const provider = modules.get(reference.moduleId);
                if (!provider)
                  throw rejected(
                    409,
                    "SERVICE_UNAVAILABLE",
                    `Load a development fixture for ${reference.moduleId}.`,
                  );
                const contract =
                  provider.module.operations[reference.operation];
                if (
                  !contract?.public ||
                  !satisfies(
                    provider.module.version,
                    module.dependencies[reference.moduleId],
                  )
                )
                  throw rejected(
                    409,
                    "SERVICE_INCOMPATIBLE",
                    "The simulated provider does not expose a compatible public service.",
                  );
                if (canonical(contract) !== canonical(reference.contract))
                  throw rejected(
                    409,
                    "SERVICE_CONTRACT_MISMATCH",
                    "Rebuild the consumer against the simulated public service contract.",
                  );
                if (
                  !grants.some(
                    (grant) =>
                      grant.consumerId === module.id &&
                      grant.providerId === provider.module.id &&
                      grant.operation === reference.operation,
                  )
                )
                  throw rejected(
                    403,
                    "GRANT_REQUIRED",
                    `Grant ${module.id} access to ${reference.moduleId}.${reference.operation} in this simulation.`,
                  );
                return execute(
                  provider,
                  {
                    moduleId: provider.module.id,
                    moduleVersion: provider.module.version,
                    action: "operation",
                    operation: reference.operation,
                    input,
                  },
                  requestId,
                  [...active, identity],
                );
              },
            ),
        });
      } catch (error) {
        failed = true;
        if (
          failure instanceof ModuleBusinessError &&
          error instanceof ModuleBusinessError &&
          error.moduleId === module.id &&
          error.operation === name
        )
          failure = error;
        else failure ??= error;
      } finally {
        while (pending.size) await Promise.allSettled([...pending]);
        closed = true;
      }
      if (failed) throw failure;
      assertSchema(definition.output, result);
      if (!readOnly)
        recordAudit(
          module.id,
          `${module.id}.operation.${name}`,
          module.id,
          requestId,
        );
      return result;
    }
    const resource = module.resources[call.resource!],
      rows = data[module.id].records[call.resource!];
    const input = call.input as {
      id?: string;
      data?: JsonRecord;
      baseVersion?: number;
    } & ResourceListOptions;
    if (call.action === "list")
      return listResourceRecords(resource.schema, rows, input);
    const old = rows.find((r) => r.id === input.id);
    if (call.action === "get") {
      if (!old) throw rejected(404, "NOT_FOUND", "Record not found.");
      return structuredClone(old);
    }
    if (call.action === "create") {
      if (old) throw rejected(409, "RECORD_EXISTS", "Record already exists.");
      assertSchema(resource.schema, input.data);
      const record = {
        id: input.id ?? crypto.randomUUID(),
        data: structuredClone(input.data) as JsonRecord,
        version: 1,
        archived: false,
        updatedAt: new Date().toISOString(),
      };
      rows.push(record);
      recordAudit(
        module.id,
        `${module.id}.${call.resource}.${call.action}`,
        record.id,
        requestId,
      );
      return structuredClone(record);
    }
    if (!old) throw rejected(404, "NOT_FOUND", "Record not found.");
    if (resource.appendOnly)
      throw rejected(409, "APPEND_ONLY", "This resource is append-only.");
    if (old.archived)
      throw rejected(409, "RECORD_ARCHIVED", "This record is archived.");
    if (input.baseVersion !== old.version)
      throw rejected(
        412,
        "VERSION_CONFLICT",
        "The record changed. Reload and review your changes.",
      );
    if (call.action === "archive") old.archived = true;
    else {
      assertSchema(resource.schema, input.data);
      old.data = structuredClone(input.data) as JsonRecord;
    }
    old.version++;
    old.updatedAt = new Date().toISOString();
    recordAudit(
      module.id,
      `${module.id}.${call.resource}.${call.action}`,
      old.id,
      requestId,
    );
    return structuredClone(old);
  };
  // All namespaces and effects share one serialized development transaction.
  let tail: Promise<unknown> = Promise.resolve();
  const send = (call: ModuleCall): Promise<unknown> => {
    const run = async () => {
      policy(root, call);
      if (!online && !options.personal)
        throw rejected(503, "OFFLINE", "The simulated server is offline.");
      const readOnly =
        ["get", "list"].includes(call.action) ||
        (call.action === "operation" &&
          module.operations[call.operation!].kind === "query");
      const request = canonical(call),
        prior = !readOnly && call.key ? receipts.get(call.key) : undefined;
      if (prior) {
        if (prior.request !== request)
          throw rejected(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This key was used for different input.",
          );
        return structuredClone(prior.result);
      }
      const before = structuredClone(data),
        eventCount = events.length,
        auditCount = audits.length;
      try {
        const result = await execute(
          root,
          call,
          call.key ?? crypto.randomUUID(),
        );
        if (!readOnly && call.key)
          receipts.set(call.key, { request, result: structuredClone(result) });
        return result;
      } catch (error) {
        data = before;
        events.splice(eventCount);
        audits.splice(auditCount);
        if (error instanceof ModuleBusinessError) {
          if (
            error.moduleId !== module.id ||
            error.operation !== call.operation
          )
            throw Error("A dependent service rejected the operation.", {
              cause: error,
            });
          throw Object.assign(rejected(422, error.code, error.message), {
            detail: {
              moduleId: error.moduleId,
              operation: error.operation,
              error: error.detail,
            },
          });
        }
        throw error;
      }
    };
    const task = tail.then(run);
    tail = task.catch(() => {});
    return task;
  };
  const setModulePermissions = (id: string, values: readonly string[]) => {
    const scope = modules.get(id);
    if (!scope) throw Error(`Unknown simulated module: ${id}`);
    permissions.set(
      id,
      values.filter((permission) =>
        scope.module.permissions.includes(permission),
      ),
    );
  };
  return {
    client: createModuleClient(module, send),
    send,
    snapshot: (): SimulatorSnapshot =>
      structuredClone({
        ...data[module.id],
        scope: {
          userId: simulationIdentity.userId,
          workspaceId: simulationIdentity.workspaceId,
        },
        journal,
        events,
        audits,
        online,
        permissions: permissions.get(module.id)!,
        grants,
        providers: Object.fromEntries(
          [...modules]
            .filter(([id]) => id !== module.id)
            .map(([id, scope]) => [
              id,
              {
                ...data[id],
                module: scope.module,
                permissions: permissions.get(id)!,
              },
            ]),
        ),
      }),
    inspect<const T extends ModuleDefinition>(
      definition: T,
    ): SimulationNamespace<T> {
      if (
        canonical(modules.get(definition.id)?.module) !== canonical(definition)
      )
        throw Error("Inspect a loaded, matching simulation module.");
      return structuredClone({
        ...data[definition.id],
        permissions: permissions.get(definition.id)!,
      }) as SimulationNamespace<T>;
    },
    setOnline(value: boolean) {
      online = value;
    },
    setPermissions(values: readonly string[]) {
      setModulePermissions(module.id, values);
    },
    setModulePermissions,
    setGrants,
    async submit(
      call: ModuleCall,
    ): Promise<
      { state: "pending"; id: string } | { state: "accepted"; result: unknown }
    > {
      const execution = policy(root, call);
      if (
        !online &&
        !options.personal &&
        execution === "queued" &&
        !["get", "list"].includes(call.action)
      ) {
        if (call.action === "operation")
          assertSchema(module.operations[call.operation!].input, call.input);
        else if (call.action !== "archive")
          assertSchema(
            module.resources[call.resource!].schema,
            (call.input as { data: unknown }).data,
          );
        const id = call.key ?? crypto.randomUUID();
        const old = journal.find((e) => e.id === id);
        if (old && canonical(old.call) !== canonical({ ...call, key: id }))
          throw rejected(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This key was used for different input.",
          );
        if (!old)
          journal.push({
            id,
            userId: simulationIdentity.userId,
            workspaceId: simulationIdentity.workspaceId,
            call: { ...call, key: id },
            dependencies: [],
            state: "pending",
            createdAt: Date.now(),
            attempts: 0,
          });
        return { state: "pending", id };
      }
      return { state: "accepted", result: await send(call) };
    },
    async sync() {
      await flushJournal(
        {
          list: async () => structuredClone(journal),
          put: async (entry) => {
            journal[journal.findIndex((e) => e.id === entry.id)] = entry;
          },
        },
        send,
        () => online,
      );
      return this.snapshot();
    },
  };
}
