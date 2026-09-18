import { Type, type Static } from "@sinclair/typebox";
import type { ModuleDefinition } from "../authoring/module";
import { assertSchema, ValidationError } from "../authoring/validation";
import type { ModuleCall } from "./module-client";
import type { OperationError } from "../authoring/context";
import { canonical } from "../contracts/registry";

export class QueueCaptureError extends Error {
  readonly code = "QUEUED_CAPTURE_UNCONFIRMED";
  constructor(
    readonly identity: QueuedOperationIdentity,
    cause: unknown,
  ) {
    super(
      cause instanceof Error
        ? cause.message
        : "Capture could not be confirmed. Check the saved identity before retrying.",
      { cause },
    );
  }
}

/** Works across independently bundled SDK copies; this conveys identity, not authority. */
export function isQueueCaptureError(
  error: unknown,
): error is Pick<QueueCaptureError, "code" | "identity" | "message"> {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: unknown;
    identity?: unknown;
    message?: unknown;
  };
  if (
    value.code !== "QUEUED_CAPTURE_UNCONFIRMED" ||
    typeof value.message !== "string" ||
    !value.identity ||
    typeof value.identity !== "object"
  )
    return false;
  const identity = value.identity as Record<string, unknown>;
  return ["moduleId", "moduleVersion", "operation", "key"].every(
    (key) => typeof identity[key] === "string" && identity[key].length > 0,
  );
}

export type QueuedOperationName<M extends ModuleDefinition> = {
  [
    K in keyof M["operations"] & string
  ]: "queued" extends M["operations"][K]["policy"]
    ? M["operations"][K] extends { kind: "query" } | { serviceOnly: true }
      ? never
      : K
    : never;
}[keyof M["operations"] & string];
export interface QueueOptions {
  key?: string;
  dependencies?: readonly string[];
}
export interface QueuedOperationIdentity {
  moduleId: string;
  moduleVersion: string;
  operation: string;
  key: string;
}
export interface ModuleQueue {
  capture(call: ModuleCall, dependencies: readonly string[]): Promise<unknown>;
  get(identity: QueuedOperationIdentity): Promise<unknown>;
}
export type QueuedOperation<I, O, E = never> = QueuedOperationIdentity & {
  input: I;
  dependencies: string[];
} & (
    | { state: "pending"; delivery: "unsubmitted" | "uncertain" }
    | { state: "accepted"; value: O }
    | {
        state: "rejected" | "conflict";
        error: { message: string; code?: string; businessError?: E };
      }
  );
const keySchema = Type.String({
  minLength: 8,
  maxLength: 128,
  pattern: "^[^\u0000]*$",
});
const dependenciesSchema = Type.Array(keySchema, {
  maxItems: 100,
  uniqueItems: true,
});

/** Capture has its own result contract: pending input is never an operation output. */
export function createQueuedOperations<M extends ModuleDefinition>(
  module: M,
  queue?: ModuleQueue,
) {
  function operation(name: string) {
    if (!Object.hasOwn(module.operations, name))
      throw new ValidationError(`Unknown operation: ${name}`);
    const op = module.operations[name];
    if (op.policy !== "queued" || op.kind === "query" || op.serviceOnly)
      throw new ValidationError(
        "Only a public client queued command can be captured.",
      );
    return op;
  }
  function validate<K extends QueuedOperationName<M>>(
    name: K,
    key: string,
    value: unknown,
  ) {
    const op = operation(name);
    const common = {
      moduleId: Type.Literal(module.id),
      moduleVersion: Type.Literal(module.version),
      operation: Type.Literal(name),
      key: Type.Literal(key),
      input: op.input,
      dependencies: dependenciesSchema,
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
          { ...common, state: Type.Literal("accepted"), value: op.output },
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
              {
                message: Type.String(),
                code: Type.Optional(Type.String()),
                ...(op.errors
                  ? { businessError: Type.Optional(op.errors) }
                  : {}),
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      ]),
      value,
    );
    return value as QueuedOperation<
      Static<M["operations"][K]["input"]>,
      Static<M["operations"][K]["output"]>,
      OperationError<M, K>
    >;
  }
  function host() {
    if (!queue)
      throw Error("This host does not support durable queued operations.");
    return queue;
  }
  return {
    async queue<K extends QueuedOperationName<M>>(
      name: K,
      input: Static<M["operations"][K]["input"]>,
      options: QueueOptions = {},
    ) {
      const op = operation(name);
      assertSchema(op.input, input);
      const capturedInput = structuredClone(input);
      const key = options.key ?? crypto.randomUUID();
      const dependencies = [...(options.dependencies ?? [])];
      assertSchema(keySchema, key);
      assertSchema(dependenciesSchema, dependencies);
      if (dependencies.includes(key))
        throw new ValidationError(
          "A queued operation cannot depend on itself.",
        );
      const identity = {
        moduleId: module.id,
        moduleVersion: module.version,
        operation: name,
        key,
      };
      try {
        const result = await host().capture(
          {
            moduleId: module.id,
            moduleVersion: module.version,
            action: "operation",
            operation: name,
            input: structuredClone(capturedInput),
            key,
          },
          dependencies,
        );
        const checked = validate(name, key, result);
        if (canonical(checked.input) !== canonical(capturedInput))
          throw new ValidationError(
            "The host returned a different saved command.",
          );
        return checked;
      } catch (cause) {
        throw new QueueCaptureError(identity, cause);
      }
    },
    async queued<K extends QueuedOperationName<M>>(name: K, key: string) {
      operation(name);
      assertSchema(keySchema, key);
      const result = await host().get({
        moduleId: module.id,
        moduleVersion: module.version,
        operation: name,
        key,
      });
      return result === undefined ? undefined : validate(name, key, result);
    },
  };
}
