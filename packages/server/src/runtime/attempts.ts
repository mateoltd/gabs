import type { AttemptSettlementRequest } from "@suite/contracts";
import type { Tx } from "../persistence/database";
import type { Context } from "../identity/authorization";
import { authorize, lockKey } from "../identity/authorization";
import { receiptContract } from "../registry/module-rollout";
import { requireCondition, found } from "../errors";
import { settleIdempotent } from "../persistence/transactions";

export async function settleModuleAttempt(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  version: string | string[] | undefined,
  request: AttemptSettlementRequest,
) {
  // A competing execution may hold this lock for a while. Recheck authority
  // after it settles, before disclosing a receipt or creating a cancellation.
  await lockKey(tx, `${ctx.workspaceId}:${ctx.actor.id}:${request.key}`);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    ctx.runtime,
    undefined,
    moduleId,
  );
  const { current, original } = await receiptContract(
    tx,
    ctx.workspaceId,
    ctx.runtime.catalog,
    moduleId,
    version,
  );
  const { call } = request;
  let operation: string;
  let input: unknown;
  if (call.action === "operation") {
    const definition = Object.hasOwn(original.operations, call.operation)
      ? original.operations[call.operation]
      : undefined;
    found(definition);
    const active = Object.hasOwn(current.operations, call.operation)
      ? current.operations[call.operation]
      : undefined;
    // Settlement only reads an original receipt or fences its exact retry key.
    // It never invokes a handler from either the original or installed release.
    requireCondition(
      definition &&
        definition.kind !== "query" &&
        definition.policy !== "local" &&
        !definition.serviceOnly,
      403,
      "INVALID_RECOVERY_TARGET",
      "Only corporate commands can be settled here.",
    );
    requireCondition(
      ctx.permissions.includes(definition.permission) &&
        (!active || ctx.permissions.includes(active.permission)),
      403,
      "FORBIDDEN",
      "Your role does not allow this action.",
    );
    operation = `${moduleId}.${call.operation}`;
    input = call.input;
  } else {
    requireCondition(
      Object.hasOwn(original.resources, call.resource),
      404,
      "NOT_FOUND",
      "This resource is not available in the original release.",
    );
    requireCondition(
      ctx.permissions.includes(`${moduleId}.${call.resource}.read`) &&
        ctx.permissions.includes(`${moduleId}.${call.resource}.write`),
      403,
      "FORBIDDEN",
      "Your role does not allow this action.",
    );
    operation = `${moduleId}.${call.resource}.${call.action}`;
    input = { action: call.action, resource: call.resource, input: call.input };
  }
  return settleIdempotent(
    tx,
    ctx,
    request.key,
    operation,
    version === undefined ? input : { moduleVersion: version, input },
  );
}
