import {
  assertSchema,
  createModuleClient,
  type ModuleCall,
  type ModuleDefinition,
  type ResourceRecord,
  type JsonRecord,
  type Static,
} from "./index";
import { ModuleBusinessError, type ScopedModuleServer } from "./server";
import { canonical } from "./registry";
import { flushJournal, type JournalEntry } from "./sync";
export type ModuleFixtures<M extends ModuleDefinition> = {
  [K in keyof M["resources"]]?: Array<Static<M["resources"][K]["schema"]>>;
};
export function defineFixtures<M extends ModuleDefinition>(
  module: M,
  fixtures: ModuleFixtures<M>,
): ModuleFixtures<M> {
  validateFixtures(module, fixtures);
  return fixtures;
}
export function validateFixtures(
  module: ModuleDefinition,
  fixtures: unknown,
): asserts fixtures is Record<string, JsonRecord[]> {
  if (!fixtures || typeof fixtures !== "object" || Array.isArray(fixtures))
    throw Error("Fixtures must map resource names to arrays of records.");
  for (const [name, rows] of Object.entries(fixtures)) {
    const resource = module.resources[name];
    if (!resource || !Array.isArray(rows))
      throw Error(`Invalid fixture resource: ${name}`);
    rows.forEach((data, index) => {
      try {
        assertSchema(resource.schema, data);
      } catch (error) {
        throw Error(`Fixture ${name}[${index}]: ${(error as Error).message}`);
      }
    });
  }
}
const rejected = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code });
export interface SimulatorSnapshot {
  records: Record<string, ResourceRecord[]>;
  journal: JournalEntry[];
  events: { name: string; payload: unknown }[];
  online: boolean;
  permissions: string[];
}
/** A deterministic development adapter. It never connects to a corporate workspace. */
export function createModuleSimulator<M extends ModuleDefinition>(
  module: M,
  options: {
    fixtures?: ModuleFixtures<M>;
    configuration?: unknown;
    server?: ScopedModuleServer;
    personal?: boolean;
  } = {},
) {
  let online = true;
  let permissions: string[] = [...module.permissions];
  let records: Record<string, ResourceRecord[]> = Object.fromEntries(
    Object.keys(module.resources).map((k) => [k, []]),
  );
  const journal: JournalEntry[] = [];
  const events: { name: string; payload: unknown }[] = [];
  const receipts = new Map<string, { request: string; result: unknown }>();
  const fixtures = options.fixtures ?? {};
  validateFixtures(module, fixtures);
  for (const [name, rows] of Object.entries(fixtures))
    records[name] = rows.map((data) => ({
      id: crypto.randomUUID(),
      data: structuredClone(data),
      version: 1,
      archived: false,
      updatedAt: new Date().toISOString(),
    }));
  function policy(call: ModuleCall) {
    if (call.moduleId !== module.id)
      throw rejected(
        403,
        "CAPABILITY_DENIED",
        "This simulator only grants access to its own module.",
      );
    const definition =
      call.action === "operation"
        ? module.operations[call.operation!]
        : module.resources[call.resource!];
    if (!definition)
      throw rejected(404, "NOT_FOUND", "Unknown resource or operation.");
    const permission =
      call.action === "operation"
        ? module.operations[call.operation!].permission
        : `${module.id}.${call.resource}.${["get", "list"].includes(call.action) ? "read" : "write"}`;
    if (!permissions.includes(permission))
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
  const execute = async (call: ModuleCall): Promise<unknown> => {
    policy(call);
    if (call.action === "operation") {
      if (!options.server)
        throw rejected(
          409,
          "BACKEND_UNAVAILABLE",
          "Stage a scoped module-server.ts to simulate this operation.",
        );
      const readOnly = module.operations[call.operation!].kind === "query";
      let failure: unknown;
      let closed = false;
      const pending = new Set<Promise<unknown>>();
      const guarded = <T>(
        write: boolean,
        run: () => Promise<T>,
      ): Promise<T> => {
        const task = Promise.resolve().then(() => {
          if (closed || (readOnly && write))
            throw rejected(
              403,
              "QUERY_WRITE_DENIED",
              "Read-only operations cannot change data or emit events.",
            );
          return run();
        });
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          (error) => {
            failure ??= error;
            pending.delete(task);
          },
        );
        return task;
      };
      try {
        let result: unknown;
        try {
          result = await options.server.execute(call.operation!, call.input, {
            actor: { id: "simulated-user", membershipId: "simulated-member" },
            workspaceId: "simulated-workspace",
            requestId: call.key ?? crypto.randomUUID(),
            permissions,
            configuration: options.configuration ?? {},
            resource: (request) =>
              guarded(!["get", "list"].includes(request.action), () =>
                execute(request),
              ),
            audit: () =>
              guarded(true, async () => {
                throw rejected(
                  409,
                  "AUDIT_UNAVAILABLE",
                  "Audit storage requires an authoritative server test.",
                );
              }),
            emit: (name, payload) =>
              guarded(true, async () => {
                events.push({ name, payload: structuredClone(payload) });
              }),
            service: async () => {
              throw rejected(
                409,
                "SERVICE_UNAVAILABLE",
                "Cross-module services require a provider integration test.",
              );
            },
          });
        } finally {
          while (pending.size) await Promise.allSettled([...pending]);
          closed = true;
        }
        if (failure) throw failure;
        return result;
      } catch (error) {
        if (error instanceof ModuleBusinessError)
          throw Object.assign(rejected(422, error.code, error.message), {
            detail: {
              moduleId: error.moduleId,
              operation: error.operation,
              error: error.detail,
            },
          });
        throw error;
      }
    }
    const resource = module.resources[call.resource!],
      rows = records[call.resource!];
    const input = call.input as {
      id?: string;
      data?: JsonRecord;
      baseVersion?: number;
      search?: string;
      limit?: number;
      cursor?: string;
      archived?: boolean;
    };
    if (call.action === "list") {
      const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
      const matches = rows
        .filter(
          (r) =>
            r.archived === (input.archived ?? false) &&
            (!input.cursor || r.id > input.cursor) &&
            (!input.search ||
              JSON.stringify(r.data)
                .toLowerCase()
                .includes(input.search.toLowerCase())),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      return structuredClone({
        items: matches.slice(0, limit),
        nextCursor: matches.length > limit ? matches[limit - 1].id : null,
      });
    }
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
    return structuredClone(old);
  };
  // Serialize each transaction just as the shared database coordinates competing writes.
  let tail: Promise<unknown> = Promise.resolve();
  const send = (call: ModuleCall): Promise<unknown> => {
    const run = async () => {
      policy(call);
      if (!online && !options.personal)
        throw rejected(503, "OFFLINE", "The simulated server is offline.");
      const readOnly =
        call.action === "operation" &&
        module.operations[call.operation!].kind === "query";
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
      const before = structuredClone(records),
        eventCount = events.length;
      try {
        const result = await execute(call);
        if (!readOnly && call.key)
          receipts.set(call.key, { request, result: structuredClone(result) });
        return result;
      } catch (error) {
        records = before;
        events.splice(eventCount);
        throw error;
      }
    };
    const task = tail.then(run);
    tail = task.catch(() => {});
    return task;
  };
  return {
    client: createModuleClient(module, send),
    send,
    snapshot: (): SimulatorSnapshot =>
      structuredClone({ records, journal, events, online, permissions }),
    setOnline(value: boolean) {
      online = value;
    },
    setPermissions(values: readonly string[]) {
      permissions = values.filter((p) => module.permissions.includes(p));
    },
    async submit(
      call: ModuleCall,
    ): Promise<
      { state: "pending"; id: string } | { state: "accepted"; result: unknown }
    > {
      const execution = policy(call);
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
            userId: "simulated-user",
            workspaceId: "simulated-workspace",
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
