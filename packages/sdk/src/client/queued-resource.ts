import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type { Resource } from "../authoring/module";
import { assertSchema, ValidationError } from "../authoring/validation";
import {
  resourceRecordSchema,
  type ResourceRecord,
} from "../contracts/resource";
import { canonical } from "../contracts/registry";
import type { ModuleCall } from "./module-client";
import {
  QueueCaptureError,
  queueKeySchema,
  queueDependenciesSchema,
  type QueueOptions,
} from "./queued-operation";

export type ResourceMutation = "create" | "update" | "archive";
export interface QueuedResourceIdentity {
  moduleId: string;
  moduleVersion: string;
  resource: string;
  action: ResourceMutation;
  key: string;
}
export type ResourceMutationInput<
  D,
  A extends ResourceMutation,
> = A extends "create"
  ? { id: string; data: D }
  : A extends "update"
    ? { id: string; data: D; baseVersion: number; baseData: D }
    : { id: string; baseVersion: number };
export type QueuedResource<
  D,
  A extends ResourceMutation = ResourceMutation,
> = A extends ResourceMutation
  ? Omit<QueuedResourceIdentity, "action"> & {
      action: A;
      input: ResourceMutationInput<D, A>;
      dependencies: string[];
    } & (
        | { state: "pending"; delivery: "unsubmitted" | "uncertain" }
        | { state: "accepted"; value: ResourceRecord<D> }
        | {
            state: "rejected" | "conflict";
            error: { message: string; code?: string };
          }
      )
  : never;
export interface ModuleResourceQueue {
  capture(call: ModuleCall, dependencies: readonly string[]): Promise<unknown>;
  get(identity: QueuedResourceIdentity): Promise<unknown>;
}
export interface QueuedResourceClient<D> {
  create(
    data: D,
    options?: QueueOptions & { id?: string },
  ): Promise<QueuedResource<D, "create">>;
  update(
    id: string,
    data: D,
    base: ResourceRecord<D>,
    options?: QueueOptions,
  ): Promise<QueuedResource<D, "update">>;
  archive(
    id: string,
    version: number,
    options?: QueueOptions,
  ): Promise<QueuedResource<D, "archive">>;
  get<A extends ResourceMutation>(
    action: A,
    key: string,
  ): Promise<QueuedResource<D, A> | undefined>;
}

/** Shared by SDK capture and the durable host; no pending write is a confirmed record. */
export function resourceMutationSchema(
  schema: TSchema,
  action: ResourceMutation,
) {
  const id = Type.String({ format: "uuid" });
  const baseVersion = Type.Integer({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  });
  return Type.Object(
    action === "create"
      ? { id, data: schema }
      : action === "update"
        ? { id, data: schema, baseVersion, baseData: schema }
        : { id, baseVersion },
    { additionalProperties: false },
  );
}
export function createQueuedResource<S extends TSchema>(
  identity: { moduleId: string; moduleVersion: string; resource: string },
  definition: Resource<S>,
  queue?: ModuleResourceQueue,
): QueuedResourceClient<Static<S>> {
  type Data = Static<S>;
  function host(action: ResourceMutation) {
    if (
      !["create", "update", "archive"].includes(action) ||
      definition.policy !== "queued" ||
      (definition.appendOnly && action !== "create")
    )
      throw new ValidationError(
        "This resource action does not allow queued capture.",
      );
    if (!queue)
      throw Error("This host does not support durable queued resource writes.");
    return queue;
  }
  function validate<A extends ResourceMutation>(
    action: A,
    key: string,
    value: unknown,
  ): QueuedResource<Data, A> {
    const common = {
      moduleId: Type.Literal(identity.moduleId),
      moduleVersion: Type.Literal(identity.moduleVersion),
      resource: Type.Literal(identity.resource),
      action: Type.Literal(action),
      key: Type.Literal(key),
      input: resourceMutationSchema(definition.schema, action),
      dependencies: queueDependenciesSchema,
    };
    assertSchema(
      Type.Union([
        Type.Object(
          {
            ...common,
            state: Type.Literal("pending"),
            delivery: Type.Union([
              Type.Literal("unsubmitted"),
              Type.Literal("uncertain"),
            ]),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            ...common,
            state: Type.Literal("accepted"),
            value: resourceRecordSchema(definition.schema),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            ...common,
            state: Type.Union([
              Type.Literal("rejected"),
              Type.Literal("conflict"),
            ]),
            error: Type.Object(
              { message: Type.String(), code: Type.Optional(Type.String()) },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      ]),
      value,
    );
    const checked = value as QueuedResource<Data, A>;
    if (checked.state === "accepted" && checked.value.id !== checked.input.id)
      throw new ValidationError(
        "The host returned a different resource record.",
      );
    return checked;
  }
  async function get<A extends ResourceMutation>(action: A, key: string) {
    assertSchema(queueKeySchema, key);
    const result = await host(action).get({ ...identity, action, key });
    return result === undefined ? undefined : validate(action, key, result);
  }
  async function capture<A extends ResourceMutation>(
    action: A,
    input: ResourceMutationInput<Data, A>,
    options: QueueOptions,
  ) {
    const key = options.key ?? crypto.randomUUID();
    const dependencies = [...(options.dependencies ?? [])];
    assertSchema(queueKeySchema, key);
    assertSchema(queueDependenciesSchema, dependencies);
    assertSchema(resourceMutationSchema(definition.schema, action), input);
    if (dependencies.includes(key))
      throw new ValidationError(
        "A queued resource write cannot depend on itself.",
      );
    const original = structuredClone(input);
    try {
      const result = await host(action).capture(
        { ...identity, action, input: structuredClone(original), key },
        dependencies,
      );
      const checked = validate(action, key, result);
      // A separately reviewed continuation may remap scheduling prerequisites.
      // The durable host still checks the originally requested dependency set on retries.
      if (canonical(checked.input) !== canonical(original))
        throw new ValidationError("The host returned different saved input.");
      return checked;
    } catch (cause) {
      throw new QueueCaptureError({ ...identity, action, key }, cause);
    }
  }
  return {
    async create(data, options = {}) {
      options = { ...options, dependencies: [...(options.dependencies ?? [])] };
      assertSchema(definition.schema, data);
      const originalData = structuredClone(data);
      const key = options.key ?? crypto.randomUUID();
      // An explicit retry key reuses an already captured record identifier, never a fresh target.
      let id = options.id;
      if (!id && options.key) {
        try {
          id = (await get("create", key))?.input.id;
        } catch (cause) {
          throw new QueueCaptureError(
            { ...identity, action: "create", key },
            cause,
          );
        }
      }
      return capture(
        "create",
        { id: id ?? crypto.randomUUID(), data: originalData },
        { ...options, key },
      );
    },
    update(id, data, base, options = {}) {
      if (base.id !== id)
        throw new ValidationError("The base record belongs to another target.");
      return capture(
        "update",
        { id, data, baseVersion: base.version, baseData: base.data },
        options,
      );
    },
    archive: (id, baseVersion, options = {}) =>
      capture("archive", { id, baseVersion }, options),
    get,
  };
}
