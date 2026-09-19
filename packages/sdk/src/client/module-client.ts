import {
  createQueuedResource,
  type QueuedResourceClient,
} from "./queued-resource";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import {
  referenceQueryField,
  ReferenceReadPageSchema,
  createReferenceLoader,
  type ReferenceQuery,
  type ReferenceReadPage,
  type ReferenceLoader,
} from "../contracts/references";
import type { ResourceListOptions } from "./resource-query";
import { assertSchema, ValidationError } from "../authoring/validation";
import type { JsonRecord, ModuleDefinition } from "../authoring/module";
import { createQueuedOperations, type ModuleQueue } from "./queued-operation";
import {
  ResourceReadMetadataSchema,
  type ResourceRead,
  resourceRecordSchema,
  resourcePageSchema,
  ResourceResponseError,
  type ResourceRecord,
  type ResourcePage,
} from "../contracts/resource";

export interface ModuleCall {
  moduleId: string;
  /** Signed module release used to author this request, retained when queued. */
  moduleVersion?: string;
  resource?: string;
  action:
    | "list"
    | "get"
    | "references"
    | "create"
    | "update"
    | "archive"
    | "operation";
  operation?: string;
  kind?: "query";
  input: unknown;
  key?: string;
}
export interface ModuleRequestOptions {
  signal?: AbortSignal;
}
export interface ResourceReadOptions extends ModuleRequestOptions {
  /** Available uses the server online and authorized downloads offline. Server never uses downloads. */
  source?: "available" | "server";
}
export type ModuleTransport = (
  call: ModuleCall,
  options?: ResourceReadOptions,
) => Promise<unknown>;
/** Stable within one module client; a new host authorization context gets a new client. */
export interface ResourceClient<Data = JsonRecord> {
  references(
    input: ReferenceQuery,
    options?: ResourceReadOptions,
  ): Promise<ReferenceReadPage>;
  loadReferences: ReferenceLoader;
  get(
    id: string,
    options?: ResourceReadOptions,
  ): Promise<ResourceRead<ResourceRecord<Data>>>;
  list(
    input?: ResourceListOptions<Data>,
    options?: ResourceReadOptions,
  ): Promise<ResourceRead<ResourcePage<Data>>>;
  create(data: Data, key?: string): Promise<ResourceRecord<Data>>;
  update(
    id: string,
    data: Data,
    base: ResourceRecord<Data>,
    key?: string,
  ): Promise<ResourceRecord<Data>>;
  archive(
    id: string,
    version: number,
    key?: string,
  ): Promise<ResourceRecord<Data>>;
}
type ModuleResourceClient<
  M extends ModuleDefinition,
  K extends keyof M["resources"],
> = ResourceClient<Static<M["resources"][K]["schema"]>> &
  ("queued" extends M["resources"][K]["policy"]
    ? { queue: QueuedResourceClient<Static<M["resources"][K]["schema"]>> }
    : {});
function checkReadOptions(options: ResourceReadOptions) {
  options.signal?.throwIfAborted();
  if (
    options.source !== undefined &&
    options.source !== "available" &&
    options.source !== "server"
  )
    throw new ValidationError("Unknown resource read source policy.");
}
export function createModuleClient<M extends ModuleDefinition>(
  module: M,
  send: ModuleTransport,
  queue?: ModuleQueue,
) {
  const transport: ModuleTransport = (call, options) =>
    send({ ...call, moduleVersion: module.version }, options);
  const resources = new Map<string, unknown>();
  async function read<T>(
    name: string,
    action: "get" | "list",
    input: unknown,
    schema: TSchema,
    options: ResourceReadOptions = {},
  ): Promise<T> {
    checkReadOptions(options);
    try {
      const result = await transport(
        { moduleId: module.id, resource: name, action, input },
        options,
      );
      validateResponse(schema, result, name, action);
      const metadata = (result as { read?: unknown }).read;
      if (metadata !== undefined)
        assertSchema(ResourceReadMetadataSchema, metadata);
      if (
        options.source === "server" &&
        (metadata as { source?: string } | undefined)?.source !== "server"
      )
        throw Error(
          "A server response is required for this read. Reconnect and try again.",
        );
      return result as T;
    } finally {
      options.signal?.throwIfAborted();
    }
  }
  function validateResponse(
    schema: TSchema,
    result: unknown,
    name: string,
    action: string,
    key?: string,
  ) {
    try {
      assertSchema(schema, result);
    } catch (cause) {
      throw new ResourceResponseError(module.id, name, action, key, cause);
    }
  }
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
      ...(op.kind === "query" ? { kind: "query" as const } : { key }),
    });
    assertSchema(op.output, result);
    return result;
  }
  return {
    ...createQueuedOperations(module, queue),
    async attempt<K extends keyof M["operations"] & string>(
      name: K,
      input: Static<M["operations"][K]["input"]>,
      key: string = crypto.randomUUID(),
    ): Promise<
      | { ok: true; value: Static<M["operations"][K]["output"]> }
      | {
          ok: false;
          error: import("../authoring/context").OperationError<M, K>;
        }
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
          error: detail.detail
            .error as import("../authoring/context").OperationError<M, K>,
        };
      }
    },
    call,
    resource<K extends keyof M["resources"] & string>(
      name: K,
    ): ModuleResourceClient<M, K> {
      type Data = Static<M["resources"][K]["schema"]>;
      if (!Object.hasOwn(module.resources, name))
        throw new ValidationError(`Unknown resource: ${name}`);
      const cached = resources.get(name) as
        ModuleResourceClient<M, K> | undefined;
      if (cached) return cached;
      const recordSchema = resourceRecordSchema(module.resources[name].schema);
      const pageSchema = resourcePageSchema(module.resources[name].schema);
      function mutate(
        action: "create" | "update" | "archive",
        input: unknown,
        key: string,
      ): Promise<ResourceRecord<Data>> {
        const pending = transport({
          moduleId: module.id,
          resource: name,
          action,
          input,
          key,
        }).then((result) => {
          validateResponse(recordSchema, result, name, action, key);
          return result as ResourceRecord<Data>;
        });
        // Hosts track detached operations for transaction rollback. Drain the derived
        // validation promise too, without changing the rejection observed by callers.
        void pending.catch(() => undefined);
        return pending;
      }
      const references = async (
        input: ReferenceQuery,
        options: ResourceReadOptions = {},
      ): Promise<ReferenceReadPage> => {
        checkReadOptions(options);
        referenceQueryField(module.resources[name].schema, input);
        const result = await transport(
          { moduleId: module.id, resource: name, action: "references", input },
          options,
        );
        options.signal?.throwIfAborted();
        assertSchema(ReferenceReadPageSchema, result);
        if (
          options.source === "server" &&
          (result as ReferenceReadPage).read?.source !== "server"
        )
          throw Error(
            "A server response is required for this lookup. Reconnect and try again.",
          );
        return result as ReferenceReadPage;
      };
      const client: ResourceClient<Data> = {
        references,
        loadReferences: createReferenceLoader(
          module.resources[name].schema,
          references,
        ),
        get: (id, options) =>
          read<ResourceRead<ResourceRecord<Data>>>(
            name,
            "get",
            { id },
            recordSchema,
            options,
          ),
        list: (input = {}, options) =>
          read<ResourceRead<ResourcePage<Data>>>(
            name,
            "list",
            input,
            pageSchema,
            options,
          ),
        create: (data: Data, key: string = crypto.randomUUID()) => {
          assertSchema(module.resources[name].schema, data);
          return mutate("create", { data }, key);
        },
        update: (
          id: string,
          data: Data,
          base: ResourceRecord<Data>,
          key: string = crypto.randomUUID(),
        ) => {
          assertSchema(module.resources[name].schema, data);
          return mutate(
            "update",
            { id, data, baseVersion: base.version, baseData: base.data },
            key,
          );
        },
        archive: (
          id: string,
          version: number,
          key: string = crypto.randomUUID(),
        ) => mutate("archive", { id, baseVersion: version }, key),
      };
      const result = Object.assign(client, {
        queue: createQueuedResource(
          {
            moduleId: module.id,
            moduleVersion: module.version,
            resource: name,
          },
          module.resources[name],
          queue?.resources,
        ),
      }) as ModuleResourceClient<M, K>;
      resources.set(name, result);
      return result;
    },
  };
}
