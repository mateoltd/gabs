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
export async function idempotent<T>(
  tx: Tx,
  ctx: Context,
  key: string | undefined,
  operation: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
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
    return previous.response as T;
  }
  const response = await fn();
  await tx
    .insertInto("suite.idempotency")
    .values({
      workspace_id: ctx.workspaceId,
      actor_id: ctx.actor.id,
      key,
      operation,
      request_hash: hash,
      response: JSON.stringify(response),
    })
    .execute();
  return response;
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
