import {
  referenceQueryField,
  referenceValues,
  referenceTargetKey,
  type ReferenceTarget,
  type ReferenceValue,
  pageReferenceOptions,
  resourceReferenceOptions,
  type ReferenceQuery,
  type ReferenceLookup,
  type ReferenceLoader,
} from "./references";
import {
  listResourceRecords,
  type ResourceListOptions,
} from "./resource-query";
import { localStorageContract } from "./storage";
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
import { canonical, satisfies } from "./registry";

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
  references: ReferenceLookup;
  loadReferences: ReferenceLoader;
  get(id: string): Promise<ResourceRecord<D>>;
  list(input?: ResourceListOptions<D>): Promise<ResourcePage<D>>;
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
  migrate?(name: string, context: LocalMigrationContext): Promise<void>;
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
  return (
    handlers: {
      [K in LocalOperation<M>]: (
        context: LocalContext<M, K>,
        input: Static<M["operations"][K]["input"]>,
      ) => Promise<Static<M["operations"][K]["output"]>>;
    },
    ...migrationHandlers: M extends {
      localStorage: { migrations: infer Steps };
    }
      ? [
          migrations: {
            [K in keyof Steps]: (
              context: LocalMigrationContext<M>,
            ) => Promise<void>;
          },
        ]
      : [
          migrations?: Record<
            string,
            (context: LocalMigrationContext<M>) => Promise<void>
          >,
        ]
  ): LocalModule => {
    const migrations = (migrationHandlers[0] ?? {}) as Record<
      string,
      (context: LocalMigrationContext) => Promise<void>
    >;
    const declared = localStorageContract(module).migrations;
    if (
      Object.keys(declared).some((name) => !Object.hasOwn(migrations, name)) ||
      Object.keys(migrations).some((name) => !Object.hasOwn(declared, name))
    )
      throw Error(
        "Local migration handlers must match the declared local storage migrations.",
      );
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
      async migrate(name, context) {
        const step = declared[name];
        if (!step || step.from !== context.from || step.to !== context.to)
          throw Error(`Undeclared local migration: ${module.id}.${name}`);
        await migrations[name](Object.freeze(context));
      },
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
  /** Read-only resources selected by the unlocked profile host's explicit grants. */
  referenceProviders?: LocalReferenceProvider[];
}
export interface LocalReferenceProvider {
  profileId: string;
  module: ModuleDefinition;
  resources: string[];
  records: Record<string, ResourceRecord[]>;
}
export interface LocalResult {
  schemaVersion?: number;
  migrations?: string[];
  result: unknown;
  snapshot: LocalSnapshot;
}
function localReferenceRecords(
  module: ModuleDefinition,
  snapshot: LocalSnapshot,
  target: ReferenceTarget,
  request?: Pick<LocalRequest, "profileId" | "referenceProviders">,
): ResourceRecord[] {
  if (target.kind === "member")
    fail(
      "MEMBERSHIP_UNAVAILABLE",
      "Standalone profiles have no corporate membership directory.",
    );
  if (target.moduleId !== module.id) {
    const provider = request?.referenceProviders?.find(
      (provider) => provider.module.id === target.moduleId,
    );
    const required = module.dependencies[target.moduleId];
    if (
      !provider ||
      provider.profileId !== request?.profileId ||
      !required ||
      !satisfies(provider.module.version, required) ||
      !provider.resources.includes(target.resource)
    )
      fail(
        "LOCAL_SCOPE_DENIED",
        "Allow this reference in Local modules before reading another module's records.",
      );
    const definition =
      Object.hasOwn(provider.module.resources, target.resource) &&
      provider.module.resources[target.resource];
    if (
      !definition ||
      !definition.standalone ||
      !provider.module.permissions.includes(
        `${target.moduleId}.${target.resource}.read`,
      )
    )
      fail(
        "LOCAL_ONLY",
        "The referenced resource does not allow standalone reads.",
      );
    return structuredClone(provider.records[target.resource] ?? []);
  }
  const resource =
    Object.hasOwn(module.resources, target.resource) &&
    module.resources[target.resource];
  if (!resource || !resource.standalone)
    fail(
      "LOCAL_ONLY",
      "The referenced resource is not available in this standalone module.",
    );
  return Object.hasOwn(snapshot.records, target.resource)
    ? snapshot.records[target.resource]
    : [];
}
function validateLocalReferences(
  module: ModuleDefinition,
  snapshot: LocalSnapshot,
  references: readonly ReferenceValue[],
  request?: Pick<LocalRequest, "profileId" | "referenceProviders">,
) {
  const targets = new Map<string, Set<string>>();
  for (const reference of references) {
    const key = referenceTargetKey(reference.target);
    let ids = targets.get(key);
    if (!ids) {
      ids = new Set(
        localReferenceRecords(module, snapshot, reference.target, request)
          .filter((row) => !row.archived)
          .map((row) => row.id.toLowerCase()),
      );
      targets.set(key, ids);
    }
    if (!ids.has(reference.value.toLowerCase()))
      fail(
        "NOT_FOUND",
        "A referenced record was not found in this local profile.",
      );
  }
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
  const mutation = !["list", "get", "references"].includes(call.action);
  const assertCapability = (command: ModuleCall) => {
    if (
      ![
        "list",
        "get",
        "references",
        "create",
        "update",
        "archive",
        "operation",
      ].includes(command.action)
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
      if (command.action === "references") {
        const { target } = referenceQueryField(
          definition.schema,
          command.input,
        );
        return pageReferenceOptions(
          resourceReferenceOptions(
            localReferenceRecords(module, snapshot, target, request),
          ),
          command.input as ReferenceQuery,
        );
      }
      const rows = Object.hasOwn(snapshot.records, name)
        ? snapshot.records[name]
        : (snapshot.records[name] = []);
      const input = command.input as {
        id?: string;
        data?: Record<string, unknown>;
        baseVersion?: number;
      } & ResourceListOptions;
      if (!input || typeof input !== "object")
        fail("INVALID_INPUT", "Expected a resource request.");
      if (command.action === "list")
        return listResourceRecords(
          definition.schema,
          rows,
          input,
          `${request.profileId}/${module.id}@${module.version}/${name}`,
        );
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
        validateLocalReferences(
          module,
          snapshot,
          referenceValues(definition.schema, input.data),
          request,
        );
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

/** Historical fields remain unknown until the migration validates its source data. */
export interface LocalMigrationContext<
  M extends ModuleDefinition = ModuleDefinition,
> {
  readonly profileId: string;
  readonly from: number;
  readonly to: number;
  readonly configuration: Readonly<Configuration<M>>;
  resource(name: string): {
    scan(after?: string): Promise<ResourcePage<Record<string, unknown>>>;
    create(
      data: Record<string, unknown>,
      id?: string,
    ): Promise<ResourceRecord<Record<string, unknown>>>;
    archive(id: string, expectedVersion: number): Promise<void>;
    write(
      id: string,
      data: Record<string, unknown>,
      expectedVersion: number,
    ): Promise<void>;
  };
  renameResource(
    from: string,
    to: string extends keyof M["resources"] ? string : LocalResource<M>,
  ): Promise<void>;
}

/** A private snapshot is returned only after every forward step and final schema check succeeds. */
export async function migrateLocalSnapshot(
  module: ModuleDefinition,
  request: LocalRequest,
  fromVersion: number,
  implementation?: LocalModule,
  source?: ModuleDefinition,
): Promise<LocalResult> {
  if (
    !request.profileId ||
    request.call.moduleId !== module.id ||
    request.call.moduleVersion !== module.version
  )
    fail(
      "LOCAL_CONTRACT_MISMATCH",
      "The local migration does not match this profile's module.",
    );
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 1)
    fail("INVALID_LOCAL_SCHEMA", "The stored local schema version is invalid.");
  assertSchema(module.configuration, request.configuration);
  const contract = localStorageContract(module),
    snapshot = structuredClone(request.snapshot),
    migrations: string[] = [];
  // Only the host-verified installed contract can explain historical annotations.
  if (source) {
    const previous = localStorageContract(source);
    if (
      source.id !== module.id ||
      previous.version > fromVersion ||
      fromVersion < previous.compatible.minimum ||
      fromVersion > previous.compatible.maximum
    )
      fail(
        "LOCAL_CONTRACT_MISMATCH",
        "The historical local contract does not match the stored schema.",
      );
  }
  const identity = (reference: ReferenceValue) =>
    JSON.stringify([
      reference.path,
      referenceTargetKey(reference.target),
      reference.value.toLowerCase(),
    ]);
  const original = new Map<string, Map<string, Set<string>>>();
  if (source)
    for (const [name, rows] of Object.entries(request.snapshot.records)) {
      const definition =
        Object.hasOwn(source.resources, name) && source.resources[name];
      if (!definition || !definition.standalone) continue;
      const records = new Map<string, Set<string>>();
      for (const row of rows) {
        try {
          records.set(
            row.id,
            new Set(referenceValues(definition.schema, row.data).map(identity)),
          );
        } catch {
          /* Invalid historical data cannot establish a reference exemption. */
        }
      }
      original.set(name, records);
    }
  let version = fromVersion;
  while (version < contract.version) {
    const step = Object.entries(contract.migrations).find(
      ([, step]) => step.from === version,
    );
    if (
      !step ||
      !implementation?.migrate ||
      canonical(implementation.module) !== canonical(module)
    )
      fail(
        "LOCAL_MIGRATION_MISSING",
        "This release does not include the complete reviewed local migration path. Your current installation is preserved.",
      );
    const [name, transition] = step;
    let closed = false,
      failure: unknown;
    const pending = new Set<Promise<unknown>>();
    const track = <T>(run: () => T) => {
      const task = Promise.resolve().then(() => {
        if (closed)
          fail(
            "LOCAL_TRANSACTION_CLOSED",
            "This local migration has finished.",
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
    const resource = (name: string) => {
      if (
        !Object.hasOwn(snapshot.records, name) &&
        !module.resources[name]?.standalone
      )
        fail(
          "LOCAL_SCOPE_DENIED",
          "A local migration can only access this module's standalone resources.",
        );
      return snapshot.records[name] ?? (snapshot.records[name] = []);
    };
    const context: LocalMigrationContext = {
      profileId: request.profileId,
      from: version,
      to: transition.to,
      configuration: structuredClone(request.configuration),
      resource(name) {
        return {
          scan(after) {
            return track(() => {
              const rows = resource(name)
                .filter((row) => !after || row.id > after)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
              return structuredClone({
                items: rows.slice(0, 100),
                nextCursor: rows.length > 100 ? rows[99].id : null,
              });
            });
          },
          create(value, id = crypto.randomUUID()) {
            return track(() => {
              if (
                !value ||
                typeof value !== "object" ||
                Array.isArray(value) ||
                typeof id !== "string" ||
                !id ||
                id.length > 200
              )
                fail(
                  "INVALID_INPUT",
                  "Provide migration record data and a valid record identifier.",
                );
              const rows = resource(name);
              if (rows.some((row) => row.id === id))
                fail(
                  "VERSION_CONFLICT",
                  "A migration record with this identifier already exists.",
                );
              const row: ResourceRecord = {
                id,
                data: structuredClone(value),
                version: 1,
                archived: false,
                updatedAt: new Date().toISOString(),
              };
              rows.push(row);
              return structuredClone(row);
            });
          },
          archive(id, expectedVersion) {
            return track(() => {
              const row = resource(name).find((row) => row.id === id);
              if (!row)
                fail("NOT_FOUND", "The local migration record was not found.");
              if (row.version !== expectedVersion)
                fail(
                  "VERSION_CONFLICT",
                  "The local migration record version changed.",
                );
              row.archived = true;
              row.version++;
              row.updatedAt = new Date().toISOString();
            });
          },
          write(id, value, expectedVersion) {
            return track(() => {
              const row = resource(name).find((row) => row.id === id);
              if (!row)
                fail("NOT_FOUND", "The local migration record was not found.");
              if (row.version !== expectedVersion)
                fail(
                  "VERSION_CONFLICT",
                  "The local migration record version changed.",
                );
              if (!value || typeof value !== "object" || Array.isArray(value))
                fail("INVALID_INPUT", "Migration records must be objects.");
              row.data = structuredClone(value);
              row.version++;
              row.updatedAt = new Date().toISOString();
            });
          },
        };
      },
      renameResource(from, to) {
        return track(() => {
          if (
            !Object.hasOwn(module.resources, to) ||
            !module.resources[to].standalone ||
            from === to
          )
            fail(
              "LOCAL_SCOPE_DENIED",
              "Choose a declared standalone target resource.",
            );
          const rows = resource(from),
            target = resource(to);
          if (rows.some((row) => target.some((other) => other.id === row.id)))
            fail(
              "VERSION_CONFLICT",
              "Renamed resources have conflicting record identifiers.",
            );
          snapshot.records[to] = [...target, ...rows];
          delete snapshot.records[from];
        });
      },
    };
    try {
      await implementation.migrate(name, context);
    } finally {
      while (pending.size) await Promise.allSettled([...pending]);
      closed = true;
    }
    if (failure) throw failure;
    migrations.push(name);
    version = transition.to;
  }
  if (
    version < contract.compatible.minimum ||
    version > contract.compatible.maximum
  )
    fail(
      "LOCAL_SCHEMA_INCOMPATIBLE",
      "This release cannot use the stored local schema. Install a compatible release; downgrading data is not supported.",
    );
  for (const [name, rows] of Object.entries(snapshot.records)) {
    const resource = module.resources[name];
    if (
      rows.length &&
      (!Object.hasOwn(module.resources, name) || !resource.standalone)
    )
      fail(
        "LOCAL_SCHEMA_INCOMPATIBLE",
        "This release cannot read an existing standalone resource.",
      );
    for (const row of rows) {
      const historical = original.get(name)?.get(row.id);
      const references = referenceValues(resource.schema, row.data);
      validateLocalReferences(
        module,
        snapshot,
        references.filter((reference) => !historical?.has(identity(reference))),
        request,
      );
    }
  }
  return { result: null, snapshot, schemaVersion: version, migrations };
}
