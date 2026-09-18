import { Type, type Static } from "@sinclair/typebox";
import { assertSchema } from "../authoring/validation";
import type { JournalEntry } from "./sync";
const uuid = Type.String({ format: "uuid" });
const retryId = Type.String({ minLength: 8, maxLength: 128 });
const name = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
export const PendingRelaySchema = Type.Object(
  {
    id: retryId,
    userId: uuid,
    workspaceId: uuid,
    state: Type.Literal("pending"),
    dependencies: Type.Array(retryId, { maxItems: 100, uniqueItems: true }),
    createdAt: Type.Number({ minimum: 0 }),
    attempts: Type.Integer({ minimum: 0 }),
    call: Type.Object(
      {
        moduleId: name,
        moduleVersion: Type.String({ minLength: 1, maxLength: 100 }),
        resource: Type.Optional(name),
        operation: Type.Optional(name),
        key: Type.Optional(retryId),
        action: Type.Union([
          Type.Literal("create"),
          Type.Literal("update"),
          Type.Literal("archive"),
          Type.Literal("operation"),
        ]),
        input: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type PendingRelay = Static<typeof PendingRelaySchema>;
/** Bound untrusted input before handing it to IPC, rendering, or module validators. */
export function assertPendingRelay(
  value: unknown,
): asserts value is PendingRelay {
  assertSchema(PendingRelaySchema, value);
  let nodes = 0;
  const visit = (input: unknown, depth: number) => {
    if (depth > 32 || ++nodes > 10000)
      throw Error("The pending change is too complex to relay.");
    if (typeof input === "number" && !Number.isFinite(input))
      throw Error("Relay numbers must be finite.");
    if (input && typeof input === "object")
      for (const item of Object.values(input)) visit(item, depth + 1);
  };
  visit(value.call.input, 0);
  if (
    (value.call.key && value.call.key !== value.id) ||
    value.dependencies.includes(value.id)
  )
    throw Error("The relay retry identity or dependency list is invalid.");
}

/** Build transport input from a durable queued entry. Receipt never grants business authority. */
export function pendingRelay(entry: JournalEntry) {
  if (entry.state !== "pending" || entry.supersededBy)
    throw Error("Only an active pending change can be relayed.");
  const value = {
    id: entry.id,
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    state: entry.state,
    dependencies: entry.dependencies,
    createdAt: entry.createdAt,
    attempts: 0,
    call: entry.call,
  };
  assertPendingRelay(value);
  const payload = JSON.stringify(value);
  if (payload.length > 200000)
    throw Error("The pending change exceeds the relay size limit.");
  return { kind: "pending" as const, id: value.id, payload };
}
