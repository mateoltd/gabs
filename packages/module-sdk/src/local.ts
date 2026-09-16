import {
  assertSchema,
  createModuleClient,
  type ModuleDefinition,
  type ModuleCall,
  type ModuleTransport,
  type ResourceRecord,
  type ResourcePage,
  type Static,
} from "./index";
import type { Configuration, OperationError } from "./context";
import { canonical } from "./registry";

export type LocalOperation<M extends ModuleDefinition> = {
  [K in keyof M["operations"]]: M["operations"][K] extends { policy: "local" }
    ? K
    : never;
}[keyof M["operations"]] &
  string;
export type LocalResource<M extends ModuleDefinition> = {
  [K in keyof M["resources"]]: M["resources"][K] extends { standalone: true }
    ? K
    : never;
}[keyof M["resources"]] &
  string;
/** A local client cannot name corporate operations or non-standalone resources. */
export function createLocalModuleClient<M extends ModuleDefinition>(
  module: M,
  send: ModuleTransport,
) {
  const client = createModuleClient(module, send);
  return {
    resource<R extends LocalResource<M>>(name: R) {
      return client.resource(name);
    },
    call<K extends LocalOperation<M>>(
      name: K,
      input: Static<M["operations"][K]["input"]>,
      key?: string,
    ) {
      return client.call(name, input, key);
    },
    attempt<K extends LocalOperation<M>>(
      name: K,
      input: Static<M["operations"][K]["input"]>,
      key?: string,
    ) {
      return client.attempt(name, input, key);
    },
  };
}
export interface LocalResourceClient<D> {
  get(id: string): Promise<ResourceRecord<D>>;
  list(input?: {
    search?: string;
    cursor?: string;
    limit?: number;
    archived?: boolean;
  }): Promise<ResourcePage<D>>;
  create(data: D, key?: string): Promise<ResourceRecord<D>>;
  update(
    id: string,
    data: D,
    base: ResourceRecord<D>,
    key?: string,
  ): Promise<ResourceRecord<D>>;
  archive(
    id: string,
    version: number,
    key?: string,
  ): Promise<ResourceRecord<D>>;
}
export interface LocalContext<
  M extends ModuleDefinition,
  K extends LocalOperation<M>,
> {
  readonly profileId: string;
  readonly requestId: string;
  readonly configuration: Readonly<Configuration<M>>;
  resource<R extends LocalResource<M>>(
    name: R,
  ): LocalResourceClient<Static<M["resources"][R]["schema"]>>;
  reject(error: OperationError<M, K>): never;
}
export interface LocalModule {
  readonly module: ModuleDefinition;
  execute(
    name: string,
    input: unknown,
    capabilities: {
      profileId: string;
      requestId: string;
      configuration: unknown;
      resource: ModuleTransport;
    },
  ): Promise<unknown>;
}
export class LocalExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
  }
}
function fail(code: string, message: string): never {
  throw new LocalExecutionError(code, message);
}
/** Local handlers have no corporate service, credential, SQL or desktop capabilities. */
export function defineLocalModule<const M extends ModuleDefinition>(module: M) {
  return (handlers: {
    [K in LocalOperation<M>]: (
      context: LocalContext<M, K>,
      input: Static<M["operations"][K]["input"]>,
    ) => Promise<Static<M["operations"][K]["output"]>>;
  }): LocalModule => {
    const expected = Object.entries(module.operations)
      .filter(([, op]) => op.policy === "local")
      .map(([name]) => name);
    if (
      expected.some((name) => !Object.hasOwn(handlers, name)) ||
      Object.keys(handlers).some((name) => !expected.includes(name))
    )
      throw Error("Local handlers must match the declared local operations.");
    return {
      module,
      async execute(name, input, capabilities) {
        const op = module.operations[name];
        if (op?.policy !== "local" || !Object.hasOwn(handlers, name))
          fail(
            "LOCAL_ONLY",
            "This operation requires corporate server execution.",
          );
        assertSchema(op.input, input);
        assertSchema(module.configuration, capabilities.configuration);
        const context = {
          profileId: capabilities.profileId,
          requestId: capabilities.requestId,
          configuration: structuredClone(
            capabilities.configuration,
          ) as Configuration<M>,
          resource: createModuleClient(module, capabilities.resource).resource,
          reject(error: unknown): never {
            if (!op.errors)
              throw Error("This operation declares no business errors.");
            assertSchema(op.errors, error);
            throw new LocalExecutionError(
              "MODULE_BUSINESS_ERROR",
              "The module rejected this operation.",
              { moduleId: module.id, operation: name, error },
            );
          },
        };
        const result = await handlers[name as LocalOperation<M>](
          Object.freeze(context),
          input,
        );
        assertSchema(op.output, result);
        return result;
      },
    };
  };
}
export interface LocalReceipt {
  request: string;
  result: unknown;
}
export interface LocalSnapshot {
  records: Record<string, ResourceRecord[]>;
  receipts: Record<string, LocalReceipt>;
}
export interface LocalRequest {
  profileId: string;
  call: ModuleCall;
  configuration: unknown;
  snapshot: LocalSnapshot;
}
export interface LocalResult {
  result: unknown;
  snapshot: LocalSnapshot;
}
/** Pure transaction engine for a dedicated worker. The host commits its result atomically. */
export async function executeLocalCall(
  module: ModuleDefinition,
  request: LocalRequest,
  implementation?: LocalModule,
): Promise<LocalResult> {
  const { call } = request;
  if (
    !request.profileId ||
    call.moduleId !== module.id ||
    call.moduleVersion !== module.version
  )
    fail(
      "LOCAL_CONTRACT_MISMATCH",
      "The local request does not match the installed module.",
    );
  const snapshot = structuredClone(request.snapshot);
  const mutation = !["list", "get"].includes(call.action);
  const assertCapability = (command: ModuleCall) => {
    if (
      !["list", "get", "create", "update", "archive", "operation"].includes(
        command.action,
      )
    )
      fail("INVALID_LOCAL_ACTION", "Unknown local action.");
    if (
      command.moduleId !== module.id ||
      command.moduleVersion !== module.version
    )
      fail(
        "LOCAL_SCOPE_DENIED",
        "A local handler can only access its own installed module.",
      );
    if (command.action === "operation") {
      if (module.operations[command.operation!]?.policy !== "local")
        fail(
          "LOCAL_ONLY",
          "This operation requires corporate server execution.",
        );
    } else if (!module.resources[command.resource!]?.standalone)
      fail(
        "LOCAL_ONLY",
        "This resource is not available in a standalone profile.",
      );
  };
  assertCapability(call);
  if (mutation && (!call.key || call.key.length > 200))
    fail(
      "REQUEST_KEY_REQUIRED",
      "Local changes require a stable request identifier.",
    );
  const receiptKey = call.key ?? "";
  const signature = canonical({
    module: module.id,
    version: module.version,
    action: call.action,
    resource: call.resource ?? null,
    operation: call.operation ?? null,
    input: call.input,
    configuration: request.configuration,
  });
  const previous = Object.hasOwn(snapshot.receipts, receiptKey)
    ? snapshot.receipts[receiptKey]
    : undefined;
  if (mutation && previous) {
    if (previous.request !== signature)
      fail(
        "IDEMPOTENCY_CONFLICT",
        "This request identifier was already used for different input.",
      );
    return { result: structuredClone(previous.result), snapshot };
  }
  let closed = false,
    failure: unknown;
  const pending = new Set<Promise<unknown>>();
  const resource: ModuleTransport = (command) => {
    const task = Promise.resolve().then(() => {
      if (closed)
        fail(
          "LOCAL_TRANSACTION_CLOSED",
          "This local transaction has finished.",
        );
      assertCapability(command);
      if (command.action === "operation")
        fail(
          "LOCAL_SCOPE_DENIED",
          "Nested operation calls require an explicit host contract.",
        );
      const name = command.resource!,
        definition = module.resources[name];
      const rows = Object.hasOwn(snapshot.records, name)
        ? snapshot.records[name]
        : (snapshot.records[name] = []);
      const input = command.input as {
        id?: string;
        data?: Record<string, unknown>;
        baseVersion?: number;
        search?: string;
        cursor?: string;
        limit?: number;
        archived?: boolean;
      };
      if (!input || typeof input !== "object")
        fail("INVALID_INPUT", "Expected a resource request.");
      if (command.action === "list") {
        const limit = input.limit ?? 50;
        if (!Number.isInteger(limit) || limit < 1 || limit > 200)
          fail("INVALID_INPUT", "Page size must be between 1 and 200.");
        const matches = rows
          .filter(
            (r) =>
              r.archived === Boolean(input.archived) &&
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
      const row = rows.find((r) => r.id === input.id);
      if (command.action === "get") {
        if (!row) fail("NOT_FOUND", "Local record not found.");
        return structuredClone(row);
      }
      if (command.action !== "create") {
        if (!row) fail("NOT_FOUND", "Local record not found.");
        if (definition.appendOnly)
          fail("APPEND_ONLY", "This resource only permits new records.");
        if (row.archived)
          fail("RECORD_ARCHIVED", "This local record is archived.");
        if (row.version !== input.baseVersion)
          fail(
            "VERSION_CONFLICT",
            "The local record changed. Reload and review your changes.",
          );
      }
      if (command.action !== "archive")
        assertSchema(definition.schema, input.data);
      if (command.action === "create") {
        const created: ResourceRecord = {
          id: crypto.randomUUID(),
          data: structuredClone(input.data!),
          version: 1,
          archived: false,
          updatedAt: new Date().toISOString(),
        };
        rows.push(created);
        return structuredClone(created);
      }
      if (command.action === "archive") row!.archived = true;
      else row!.data = structuredClone(input.data!);
      row!.version++;
      row!.updatedAt = new Date().toISOString();
      return structuredClone(row!);
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
  let result: unknown;
  try {
    if (call.action === "operation") {
      if (
        !implementation ||
        canonical(implementation.module) !== canonical(module)
      )
        fail(
          "LOCAL_IMPLEMENTATION_MISSING",
          "Install the reviewed local implementation for this module.",
        );
      result = await implementation.execute(call.operation!, call.input, {
        profileId: request.profileId,
        requestId: call.key!,
        configuration: request.configuration,
        resource,
      });
    } else result = await resource(call);
  } finally {
    while (pending.size) await Promise.allSettled([...pending]);
    closed = true;
  }
  if (failure) throw failure;
  if (mutation)
    Object.defineProperty(snapshot.receipts, receiptKey, {
      value: { request: signature, result: structuredClone(result) },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return { result, snapshot };
}
