import type { StoreQueries, StoreQueryCommand } from "./store-query";
import {
  Type,
  type Static,
  type TObject,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";
import { assertSchema, type JsonRecord, type ModuleDefinition } from "./index";

/** Private transactional records, accessible only from a reviewed server handler. */
export interface Store<S extends TSchema = TSchema> {
  schema: S;
  unique: readonly string[];
}
export function store<const P extends TProperties>(
  properties: P,
  options: { unique?: readonly (keyof P & string)[] } = {},
): Store<TObject<P>> {
  return {
    schema: Type.Object(properties, { additionalProperties: false }),
    unique: options.unique ?? [],
  };
}
export interface StoreRecord<T> {
  id: string;
  data: T;
  version: number;
}
export interface StorePage<T> {
  items: StoreRecord<T>[];
  next: string | null;
}
export type StoreCommand =
  | StoreQueryCommand
  | { action: "get"; id: string; lock?: boolean }
  | { action: "scan"; where?: JsonRecord; after?: string; limit?: number }
  | { action: "create"; id?: string; data: JsonRecord }
  | { action: "replace"; id: string; version: number; data: JsonRecord }
  | { action: "archive"; id: string; version: number };
export type StoreTransport = (
  name: string,
  command: StoreCommand,
) => Promise<unknown>;
type Stores<M extends ModuleDefinition> = M extends {
  stores: infer S extends Record<string, Store>;
}
  ? S
  : Record<string, never>;
export interface StoreClient<T> extends StoreQueries<T> {
  get(id: string, options?: { lock?: boolean }): Promise<StoreRecord<T> | null>;
  scan(options?: {
    where?: Partial<T>;
    after?: string;
    limit?: number;
  }): Promise<StorePage<T>>;
  create(data: T, options?: { id?: string }): Promise<StoreRecord<T>>;
  replace(id: string, version: number, data: T): Promise<StoreRecord<T>>;
  archive(id: string, version: number): Promise<void>;
}
export type ModuleStores<M extends ModuleDefinition> = <
  K extends keyof Stores<M> & string,
>(
  name: K,
) => StoreClient<Static<Stores<M>[K]["schema"]>>;

export function createStores<M extends ModuleDefinition>(
  module: M,
  transport?: StoreTransport,
): ModuleStores<M> {
  return ((name: string) => {
    if (!Object.hasOwn(module.stores ?? {}, name))
      throw Error(`Undeclared store: ${module.id}.${name}`);
    const schema = module.stores![name].schema;
    const call = (command: StoreCommand) => {
      if (!transport)
        throw Error("Private stores require a server transaction.");
      const pending = transport(name, structuredClone(command));
      void pending.catch(() => undefined);
      return pending;
    };
    const validate = (record: StoreRecord<JsonRecord>) => {
      assertSchema(schema, record.data);
      return record;
    };
    const track = <T>(task: Promise<T>) => {
      void task.catch(() => undefined);
      return task;
    };
    return {
      get(id: string, options: { lock?: boolean } = {}) {
        return track(
          call({ action: "get", id, ...options }).then((value) =>
            value ? validate(value as StoreRecord<JsonRecord>) : null,
          ),
        );
      },
      scan(
        options: { where?: JsonRecord; after?: string; limit?: number } = {},
      ) {
        return track(
          call({ action: "scan", ...options }).then((value) => {
            const page = value as StorePage<JsonRecord>;
            page.items.forEach(validate);
            return page;
          }),
        );
      },
      query(
        options: Omit<
          Extract<StoreQueryCommand, { action: "query" }>,
          "action"
        > = {},
      ) {
        return track(
          call({ action: "query", ...options }).then((value) => {
            const page = value as StorePage<JsonRecord>;
            page.items.forEach(validate);
            return page;
          }),
        );
      },
      aggregate(
        options: Omit<
          Extract<StoreQueryCommand, { action: "aggregate" }>,
          "action"
        > = {},
      ) {
        return track(call({ action: "aggregate", ...options }));
      },
      create(data: JsonRecord, options: { id?: string } = {}) {
        return track(
          call({ action: "create", data, ...options }).then((value) =>
            validate(value as StoreRecord<JsonRecord>),
          ),
        );
      },
      replace(id: string, version: number, data: JsonRecord) {
        return track(
          call({ action: "replace", id, version, data }).then((value) =>
            validate(value as StoreRecord<JsonRecord>),
          ),
        );
      },
      archive(id: string, version: number) {
        return track(
          call({ action: "archive", id, version }).then(() => undefined),
        );
      },
    };
  }) as ModuleStores<M>;
}
