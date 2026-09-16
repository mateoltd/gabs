import { validateStorageContract, type StorageContract } from "./storage";
export {
  store,
  type Store,
  type StoreRecord,
  type StorePage,
  type StoreClient,
} from "./store";
export {
  storageContract,
  supportsStorage,
  type StorageContract,
  type MigrationContext,
} from "./storage";
import {
  Type,
  type Static,
  type TObject,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
export { Type, type Static, type TSchema, type TObject };
export type ExecutionPolicy = "local" | "queued" | "online";
export type JsonRecord = Record<string, unknown>;
export const identifier = /^[a-z][a-z0-9-]{0,63}$/;
export const field = {
  text: (
    options: { maxLength?: number; minLength?: number; title?: string } = {},
  ) => Type.String({ maxLength: 500, ...options }),
  number: (
    options: { minimum?: number; maximum?: number; title?: string } = {},
  ) => Type.Number(options),
  integer: (
    options: { minimum?: number; maximum?: number; title?: string } = {},
  ) => Type.Integer(options),
  boolean: () => Type.Boolean(),
  member: (options: { title?: string } = {}) =>
    Type.String({
      pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
      "x-membership": true,
      ...options,
    }),
  enum: <const V extends readonly [string, ...string[]]>(values: V) =>
    Type.Union(values.map((v) => Type.Literal(v as V[number]))),
  optional: Type.Optional,
  date: () => Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", title: "Date" }),
  reference: (module: string, resource: string) =>
    Type.String({
      pattern: "^[a-fA-F0-9-]{36}$",
      "x-reference": { module, resource },
    }),
};
export interface Resource<S extends TSchema = TSchema> {
  schema: S;
  title: string;
  columns: readonly string[];
  policy: ExecutionPolicy;
  standalone: boolean;
  appendOnly: boolean;
}
export function resource<const P extends TProperties>(
  properties: P,
  options: {
    title: string;
    columns?: readonly (keyof P & string)[];
    policy?: ExecutionPolicy;
    standalone?: boolean;
    appendOnly?: boolean;
  },
): Resource<TObject<P>> {
  return {
    schema: Type.Object(properties, { additionalProperties: false }),
    title: options.title,
    columns: options.columns ?? Object.keys(properties),
    policy: options.policy ?? "queued",
    standalone: options.standalone ?? false,
    appendOnly: options.appendOnly ?? false,
  };
}
export interface Operation<
  I extends TSchema = TSchema,
  O extends TSchema = TSchema,
  E extends TSchema = TSchema,
> {
  input: I;
  output: O;
  errors?: E;
  policy: ExecutionPolicy;
  permission: string;
  title: string;
  legacyOperation?: string;
  /** Expose this operation to explicitly granted module consumers. */
  public?: boolean;
}
export function operation<const O extends Operation>(definition: O): O {
  return definition;
}
export interface ModuleDefinition {
  storage?: StorageContract;
  stores?: Record<string, import("./store").Store>;
  id: string;
  name: string;
  version: string;
  description: string;
  host: string;
  backend: string;
  publisher: string;
  dependencies: Record<string, string>;
  permissions: readonly string[];
  resources: Record<string, Resource>;
  operations: Record<string, Operation>;
  configuration: TObject;
  events?: Record<string, TSchema>;
  services?: Record<string, import("./context").ServiceReference>;
  customUI?: boolean;
  views?: Record<
    string,
    {
      title: string;
      entry: string;
      stylesheet?: string;
      permission: string;
      /** Versioned, JSON-only editable state retained by the host during updates. */
      state?: { version: number; schema: TSchema };
    }
  >;
  navigation?: { path: string; permission: string; view?: string };
  legacyView?: boolean;
}
export function defineModule<const M extends ModuleDefinition>(
  definition: M & {
    operations: {
      [K in keyof M["operations"]]: { permission: M["permissions"][number] };
    };
    views?: {
      [K in keyof NonNullable<M["views"]>]: {
        permission: M["permissions"][number];
      };
    };
    navigation?: { view?: keyof NonNullable<M["views"]> & string };
  },
): M {
  if (definition.storage) validateStorageContract(definition.storage);
  if (!identifier.test(definition.id))
    throw new Error("Module IDs must be lowercase slugs.");
  if (definition.navigation) {
    if (
      [
        "overview",
        "modules",
        "organization",
        "people",
        "audit",
        "notifications",
        "settings",
        "auth",
        "api",
      ].includes(definition.id) ||
      definition.navigation.path !== `/${definition.id}`
    )
      throw new Error(
        "Module navigation must use its own module ID and cannot replace a host route.",
      );
    if (!definition.permissions.includes(definition.navigation.permission))
      throw new Error(
        `Undeclared navigation permission: ${definition.navigation.permission}`,
      );
  }
  for (const name of [
    ...Object.keys(definition.resources),
    ...Object.keys(definition.operations),
    ...Object.keys(definition.stores ?? {}),
  ]) {
    if (!identifier.test(name))
      throw new Error(`Invalid resource or operation: ${name}`);
  }
  for (const [name, store] of Object.entries(definition.stores ?? {})) {
    if (
      store.schema.type !== "object" ||
      !store.schema.properties ||
      store.schema.additionalProperties !== false
    )
      throw Error(`Store ${name} requires a closed object schema.`);
    if (
      !Array.isArray(store.unique) ||
      new Set(store.unique).size !== store.unique.length
    )
      throw Error(`Store ${name} requires distinct unique field names.`);
    for (const key of store.unique) {
      const field = store.schema.properties[key];
      if (
        !Object.hasOwn(store.schema.properties, key) ||
        !["string", "number", "integer", "boolean"].includes(field.type)
      )
        throw Error(`Store ${name} has an invalid unique field: ${key}`);
    }
  }
  for (const [name, view] of Object.entries(definition.views ?? {})) {
    if (
      view.state &&
      (!Number.isSafeInteger(view.state.version) ||
        view.state.version < 1 ||
        !view.state.schema ||
        typeof view.state.schema !== "object")
    )
      throw new Error(`Invalid editable-state contract for view: ${name}`);
    if (!identifier.test(name) || !view.title.trim())
      throw new Error(`Invalid custom view: ${name}`);
    if (!definition.permissions.includes(view.permission))
      throw new Error(`Undeclared view permission: ${view.permission}`);
    for (const path of [view.entry, view.stylesheet].filter(
      (p): p is string => !!p,
    ))
      if (
        !/^[a-zA-Z0-9_./-]+$/.test(path) ||
        path.startsWith("/") ||
        path.split("/").some((p) => p === ".." || p === "")
      )
        throw new Error(
          `View ${name} requires a relative path within the module.`,
        );
  }
  if (
    definition.navigation?.view &&
    !definition.views?.[definition.navigation.view]
  )
    throw new Error(`Unknown navigation view: ${definition.navigation.view}`);
  for (const op of Object.values(definition.operations)) {
    if (!definition.permissions.includes(op.permission))
      throw new Error(`Undeclared permission: ${op.permission}`);
  }
  for (const name of Object.keys(definition.resources)) {
    for (const verb of ["read", "write"])
      if (!definition.permissions.includes(`${definition.id}.${name}.${verb}`))
        throw new Error(
          `Resource ${name} requires ${definition.id}.${name}.${verb}`,
        );
  }
  for (const [name, reference] of Object.entries(definition.services ?? {})) {
    if (
      !identifier.test(name) ||
      !(reference.moduleId in definition.dependencies)
    )
      throw new Error(`Service ${name} requires a declared module dependency.`);
    if (!reference.contract.public)
      throw new Error(`Service ${name} is not public.`);
  }
  for (const name of Object.keys(definition.events ?? {}))
    if (!identifier.test(name)) throw new Error(`Invalid event name: ${name}`);
  return definition;
}
export function assertSchema<S extends TSchema>(
  schema: S,
  value: unknown,
): asserts value is Static<S> {
  if (!Value.Check(schema, value)) {
    const errors = [...Value.Errors(schema, value)]
      .slice(0, 5)
      .map((e) => `${e.path || "/"}: ${e.message}`);
    throw new ValidationError(errors.join("; "));
  }
}
export class ValidationError extends Error {
  readonly code = "INVALID_INPUT";
}
export interface MemberPage {
  items: { id: string; name: string }[];
  nextCursor: string | null;
}
export interface ResourceRecord<T = JsonRecord> {
  id: string;
  data: T;
  version: number;
  archived: boolean;
  updatedAt: string;
}
export interface ResourcePage<T = JsonRecord> {
  items: ResourceRecord<T>[];
  nextCursor: string | null;
}
export interface ModuleCall {
  moduleId: string;
  /** Signed module release used to author this request, retained when queued. */
  moduleVersion?: string;
  resource?: string;
  action: "list" | "get" | "create" | "update" | "archive" | "operation";
  operation?: string;
  input: unknown;
  key?: string;
}
export type ModuleTransport = (call: ModuleCall) => Promise<unknown>;
export function createModuleClient<M extends ModuleDefinition>(
  module: M,
  send: ModuleTransport,
) {
  const transport: ModuleTransport = (call) =>
    send({ ...call, moduleVersion: module.version });
  async function call<K extends keyof M["operations"] & string>(
    name: K,
    input: Static<M["operations"][K]["input"]>,
    key: string = crypto.randomUUID(),
  ): Promise<Static<M["operations"][K]["output"]>> {
    const op = module.operations[name];
    assertSchema(op.input, input);
    const result = await transport({
      moduleId: module.id,
      action: "operation",
      operation: name,
      input,
      key,
    });
    assertSchema(op.output, result);
    return result;
  }
  return {
    async attempt<K extends keyof M["operations"] & string>(
      name: K,
      input: Static<M["operations"][K]["input"]>,
      key: string = crypto.randomUUID(),
    ): Promise<
      | { ok: true; value: Static<M["operations"][K]["output"]> }
      | { ok: false; error: import("./context").OperationError<M, K> }
    > {
      try {
        return { ok: true, value: await call(name, input, key) };
      } catch (error) {
        if (!error || typeof error !== "object") throw error;
        const detail = error as {
          code?: string;
          detail?: { moduleId?: string; operation?: string; error?: unknown };
        };
        const schema = module.operations[name].errors;
        if (
          detail.code !== "MODULE_BUSINESS_ERROR" ||
          detail.detail?.moduleId !== module.id ||
          detail.detail.operation !== name ||
          !schema
        )
          throw error;
        assertSchema(schema, detail.detail.error);
        return {
          ok: false,
          error: detail.detail.error as import("./context").OperationError<
            M,
            K
          >,
        };
      }
    },
    call,
    resource<K extends keyof M["resources"] & string>(name: K) {
      type Data = Static<M["resources"][K]["schema"]>;
      return {
        get: (id: string) =>
          transport({
            moduleId: module.id,
            resource: name,
            action: "get",
            input: { id },
          }) as Promise<ResourceRecord<Data>>,
        list: (
          input: {
            search?: string;
            cursor?: string;
            limit?: number;
            archived?: boolean;
          } = {},
        ) =>
          transport({
            moduleId: module.id,
            resource: name,
            action: "list",
            input,
          }) as Promise<ResourcePage<Data>>,
        create: (data: Data, key: string = crypto.randomUUID()) => {
          assertSchema(module.resources[name].schema, data);
          return transport({
            moduleId: module.id,
            resource: name,
            action: "create",
            input: { data },
            key,
          }) as Promise<ResourceRecord<Data>>;
        },
        update: (
          id: string,
          data: Data,
          base: ResourceRecord<Data>,
          key: string = crypto.randomUUID(),
        ) => {
          assertSchema(module.resources[name].schema, data);
          return transport({
            moduleId: module.id,
            resource: name,
            action: "update",
            input: { id, data, baseVersion: base.version, baseData: base.data },
            key,
          }) as Promise<ResourceRecord<Data>>;
        },
        archive: (
          id: string,
          version: number,
          key: string = crypto.randomUUID(),
        ) =>
          transport({
            moduleId: module.id,
            resource: name,
            action: "archive",
            input: { id, baseVersion: version },
            key,
          }) as Promise<ResourceRecord<Data>>,
      };
    },
  };
}
/** Merge only fields unchanged on the server since the submitted base version. */
export function mergeFields(
  base: JsonRecord,
  local: JsonRecord,
  remote: JsonRecord,
): { data: JsonRecord; conflicts: string[] } {
  const data = { ...remote };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (JSON.stringify(base[key]) === JSON.stringify(local[key])) continue;
    if (
      JSON.stringify(remote[key]) !== JSON.stringify(base[key]) &&
      JSON.stringify(remote[key]) !== JSON.stringify(local[key])
    )
      conflicts.push(key);
    else if (key in local) data[key] = local[key];
    else delete data[key];
  }
  return { data, conflicts };
}
/** Restore TypeBox runtime metadata after a signed JSON definition crosses a transport. */
export function hydrateSchema(schema: TSchema): TSchema {
  const copy = { ...schema };
  if (schema.properties)
    copy.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, TSchema>).map(
        ([k, v]) => [k, hydrateSchema(v)],
      ),
    );
  if (schema.patternProperties)
    copy.patternProperties = Object.fromEntries(
      Object.entries(schema.patternProperties as Record<string, TSchema>).map(
        ([key, value]) => [key, hydrateSchema(value)],
      ),
    );
  if (typeof schema.additionalProperties === "object")
    copy.additionalProperties = hydrateSchema(
      schema.additionalProperties as TSchema,
    );
  if (schema.items)
    copy.items = Array.isArray(schema.items)
      ? schema.items.map(hydrateSchema)
      : hydrateSchema(schema.items as TSchema);
  if (Array.isArray(schema.anyOf)) copy.anyOf = schema.anyOf.map(hydrateSchema);
  if (Array.isArray(schema.allOf)) copy.allOf = schema.allOf.map(hydrateSchema);
  const kind =
    schema.const !== undefined
      ? "Literal"
      : schema.not && Object.keys(schema.not).length === 0
        ? "Never"
        : schema.anyOf
          ? "Union"
          : schema.allOf
            ? "Intersect"
            : schema.patternProperties
              ? "Record"
              : Array.isArray(schema.items)
                ? "Tuple"
                : ((
                    {
                      object: "Object",
                      array: "Array",
                      string: "String",
                      integer: "Integer",
                      number: "Number",
                      boolean: "Boolean",
                      null: "Null",
                    } as Record<string, string>
                  )[String(schema.type)] ?? "Unknown");
  if (
    kind === "Unknown" &&
    (schema.type !== undefined || schema.$ref || schema.not || schema.oneOf)
  )
    throw new ValidationError(
      "Unsupported transported schema. Use the SDK field types or an explicitly supported JSON schema contract.",
    );
  return { ...copy, [Symbol.for("TypeBox.Kind")]: kind };
}
export function hydrateModule(module: ModuleDefinition): ModuleDefinition {
  const { client: _client, ...contract } = module as ModuleDefinition & {
    client?: unknown;
  };
  return defineModule({
    ...contract,
    configuration: hydrateSchema(module.configuration) as TObject,
    ...(module.views
      ? {
          views: Object.fromEntries(
            Object.entries(module.views).map(([key, view]) => [
              key,
              {
                ...view,
                ...(view.state
                  ? {
                      state: {
                        ...view.state,
                        schema: hydrateSchema(view.state.schema),
                      },
                    }
                  : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(module.events
      ? {
          events: Object.fromEntries(
            Object.entries(module.events).map(([k, s]) => [
              k,
              hydrateSchema(s),
            ]),
          ),
        }
      : {}),
    ...(module.services
      ? {
          services: Object.fromEntries(
            Object.entries(module.services).map(([k, s]) => [
              k,
              {
                ...s,
                contract: {
                  ...s.contract,
                  input: hydrateSchema(s.contract.input),
                  output: hydrateSchema(s.contract.output),
                  ...(s.contract.errors
                    ? { errors: hydrateSchema(s.contract.errors) }
                    : {}),
                },
              },
            ]),
          ),
        }
      : {}),
    ...(module.stores
      ? {
          stores: Object.fromEntries(
            Object.entries(module.stores).map(([name, store]) => [
              name,
              { ...store, schema: hydrateSchema(store.schema) as TObject },
            ]),
          ),
        }
      : {}),
    resources: Object.fromEntries(
      Object.entries(module.resources).map(([k, r]) => [
        k,
        { ...r, schema: hydrateSchema(r.schema) },
      ]),
    ),
    operations: Object.fromEntries(
      Object.entries(module.operations).map(([k, o]) => [
        k,
        {
          ...o,
          input: hydrateSchema(o.input),
          output: hydrateSchema(o.output),
          ...(o.errors ? { errors: hydrateSchema(o.errors) } : {}),
        },
      ]),
    ),
  });
}

export {
  serviceReference,
  type Configuration,
  type OperationInput,
  type OperationOutput,
  type OperationError,
  type ModuleContext,
  type OperationContext,
} from "./context";
