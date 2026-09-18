import { validateHostCapabilities } from "../contracts/host-capabilities";
import { moduleSchemaFormats, type SchemaStringFormat } from "./formats";
import { validateStorageContract, type StorageContract } from "./storage";
import {
  Type,
  type TObject,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";

export {
  Type,
  type Static,
  type TSchema,
  type TObject,
} from "@sinclair/typebox";
export type ExecutionPolicy = "local" | "queued" | "online";
export type JsonRecord = Record<string, unknown>;
export const identifier = /^[a-z][a-z0-9-]{0,63}$/;
export const field = {
  text: (
    options: {
      maxLength?: number;
      minLength?: number;
      title?: string;
      format?: SchemaStringFormat;
    } = {},
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
export interface Resource<
  S extends TSchema = TSchema,
  Standalone extends boolean = boolean,
> {
  schema: S;
  title: string;
  columns: readonly string[];
  policy: ExecutionPolicy;
  standalone: Standalone;
  appendOnly: boolean;
}
export function resource<
  const P extends TProperties,
  const O extends {
    title: string;
    columns?: readonly (keyof P & string)[];
    policy?: ExecutionPolicy;
    standalone?: boolean;
    appendOnly?: boolean;
  },
>(
  properties: P,
  options: O,
): Resource<
  TObject<P>,
  O extends { standalone: true }
    ? true
    : O extends { standalone?: false }
      ? false
      : boolean
> {
  return {
    schema: Type.Object(properties, { additionalProperties: false }),
    title: options.title,
    columns: options.columns ?? Object.keys(properties),
    policy: options.policy ?? "queued",
    standalone: (options.standalone ?? false) as O extends { standalone: true }
      ? true
      : O extends { standalone?: false }
        ? false
        : boolean,
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
  /** Queries are online, read-only server operations without effect receipts. */
  kind?: "command" | "query";
  permission: string;
  title: string;
  legacyOperation?: string;
  /** Expose this operation to explicitly granted module consumers. */
  public?: boolean;
  /** Callable only through a declared, granted module service. */
  serviceOnly?: boolean;
}
export function operation<const O extends Operation>(
  definition: O &
    (O extends { kind: "query" } ? { policy: "online" } : unknown),
): O {
  return definition;
}
export interface ModuleDefinition {
  capabilities?: Record<
    string,
    import("../contracts/host-capabilities").HostCapability
  >;
  storage?: StorageContract;
  /** Standalone profile schemas evolve independently from corporate storage. */
  localStorage?: StorageContract;
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
  audit?: readonly string[];
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
    capabilities?: {
      [K in keyof NonNullable<M["capabilities"]>]: {
        permission: M["permissions"][number];
      };
    };
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
  moduleSchemaFormats(definition);
  validateHostCapabilities(definition);
  if (definition.storage) validateStorageContract(definition.storage);
  if (definition.localStorage) validateStorageContract(definition.localStorage);
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
    if (op.kind && op.kind !== "command" && op.kind !== "query")
      throw Error("Unknown operation kind.");
    if (op.kind === "query" && op.policy !== "online")
      throw Error("Read-only queries require online execution.");
    if (op.serviceOnly && !op.public)
      throw Error(
        "A service-only operation must be public to module consumers.",
      );
    if (!definition.permissions.includes(op.permission))
      throw new Error(`Undeclared permission: ${op.permission}`);
  }
  for (const name of definition.audit ?? [])
    if (
      name.length > 128 ||
      !name.split(".").every((part) => identifier.test(part))
    )
      throw Error(`Invalid audit action: ${name}`);
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
