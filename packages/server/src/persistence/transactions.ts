import type { AttemptSettlement } from "@suite/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "./database";
import type { Context } from "../identity/authorization";
import { lockKey } from "../identity/authorization";
import { requireCondition } from "../errors";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
async function lockedReceipt(
  tx: Tx,
  ctx: Context,
  key: string | undefined,
  operation: string,
  input: unknown,
) {
  requireCondition(
    key && key.length >= 8 && key.length <= 128,
    400,
    "IDEMPOTENCY_REQUIRED",
    "Provide an idempotency key for this operation.",
  );
  await lockKey(tx, `${ctx.workspaceId}:${ctx.actor.id}:${key}`);
  const hash = createHash("sha256").update(canonical(input)).digest("hex");
  const previous = await tx
    .selectFrom("suite.idempotency")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("actor_id", "=", ctx.actor.id)
    .where("key", "=", key)
    .executeTakeFirst();
  if (previous) {
    requireCondition(
      previous.operation === operation && previous.request_hash === hash,
      409,
      "IDEMPOTENCY_CONFLICT",
      "This request key was already used with different input.",
    );
  }
  return { hash, previous };
}
export async function idempotent<T>(
  tx: Tx,
  ctx: Context,
  key: string | undefined,
  operation: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const { hash, previous } = await lockedReceipt(
    tx,
    ctx,
    key,
    operation,
    input,
  );
  if (previous) {
    requireCondition(
      previous.outcome !== "cancelled",
      409,
      "ATTEMPT_CANCELLED",
      "This request was cancelled during outcome recovery. Resolve its outcome before reviewing a correction.",
    );
    return previous.response as T;
  }
  const response = await fn();
  await tx
    .insertInto("suite.idempotency")
    .values({
      workspace_id: ctx.workspaceId,
      actor_id: ctx.actor.id,
      key: key!,
      operation,
      request_hash: hash,
      response: JSON.stringify(response),
    })
    .execute();
  return response;
}
/** Shares execution's lock and fingerprint. Absence becomes a permanent fence, never a guess. */
export async function settleIdempotent(
  tx: Tx,
  ctx: Context,
  key: string,
  operation: string,
  input: unknown,
): Promise<AttemptSettlement> {
  const { hash, previous } = await lockedReceipt(
    tx,
    ctx,
    key,
    operation,
    input,
  );
  if (previous)
    return previous.outcome === "cancelled"
      ? { key, outcome: "cancelled" }
      : { key, outcome: "accepted", result: previous.response };
  await tx
    .insertInto("suite.idempotency")
    .values({
      workspace_id: ctx.workspaceId,
      actor_id: ctx.actor.id,
      key,
      operation,
      request_hash: hash,
      outcome: "cancelled",
      response: "null",
    })
    .execute();
  await audit(tx, ctx, "module.attempt.cancel", key);
  return { key, outcome: "cancelled" };
}
export async function audit(
  tx: Tx,
  ctx: Context,
  action: string,
  targetId: string,
) {
  await tx
    .insertInto("suite.audit")
    .values({
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      actor_id: ctx.actor.id,
      action,
      target_id: targetId,
      request_id: ctx.requestId,
    })
    .execute();
}
export async function publish(
  tx: Tx,
  ctx: Context,
  type: string,
  payload: Record<string, unknown>,
) {
  await tx
    .insertInto("suite.outbox")
    .values({
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      actor_id: ctx.actor.id,
      event_type: type,
      payload,
      locked_until: null,
      claim_token: null,
      completed_at: null,
      failed_at: null,
      last_error: null,
    })
    .execute();
}
export function requireVersion(current: number, header: string | undefined) {
  requireCondition(
    header,
    428,
    "VERSION_REQUIRED",
    "A record version is required.",
  );
  requireCondition(
    header === `"${current}"`,
    412,
    "VERSION_CONFLICT",
    "Someone changed this record. Review the latest version before saving.",
  );
}
export function iso(value: Date | string) {
  return new Date(value).toISOString();
}
