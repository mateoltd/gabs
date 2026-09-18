import type { ReceiptLookupResult } from "@suite/contracts";
import type { Tx } from "../persistence/database";
import type { Context } from "../identity/authorization";
import { checkModule } from "../identity/authorization";
import { workspaceModule } from "../registry/module-releases";
import { AppError } from "../errors";

/** Committed acknowledgements only: never invoke handlers or disclose response payloads. */
export async function lookupModuleReceipts(
  tx: Tx,
  ctx: Context,
  keys: readonly string[],
): Promise<ReceiptLookupResult> {
  if (!keys.length) return { accepted: [] };
  const rows = await tx
    .selectFrom("suite.idempotency")
    .select(["key", "operation"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("actor_id", "=", ctx.actor.id)
    .where("key", "in", [...keys])
    .execute();
  const definitions = new Map<
    string,
    Awaited<ReturnType<typeof workspaceModule>> | null
  >();
  const accepted = new Set<string>();
  for (const row of rows) {
    const parts = row.operation.split(".");
    if (parts.length !== 2 && parts.length !== 3) continue;
    const [id, target, action] = parts;
    if (!definitions.has(id)) {
      try {
        await checkModule(
          tx,
          ctx.workspaceId,
          ctx.membershipId,
          id,
          ctx.runtime,
        );
        definitions.set(
          id,
          await workspaceModule(tx, ctx.workspaceId, id, ctx.runtime.catalog),
        );
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          ![403, 404, 409].includes(error.status)
        )
          throw error;
        definitions.set(id, null);
      }
    }
    const module = definitions.get(id);
    if (!module) continue;
    if (parts.length === 3) {
      if (
        !["create", "update", "archive"].includes(action) ||
        !Object.hasOwn(module.resources, target)
      )
        continue;
      if (
        !ctx.permissions.includes(`${id}.${target}.read`) ||
        !ctx.permissions.includes(`${id}.${target}.write`)
      )
        continue;
    } else {
      const operation = Object.hasOwn(module.operations, target)
        ? module.operations[target]
        : undefined;
      if (
        !operation ||
        operation.serviceOnly ||
        operation.kind === "query" ||
        !ctx.permissions.includes(operation.permission)
      )
        continue;
    }
    accepted.add(row.key);
  }
  return { accepted: keys.filter((key) => accepted.has(key)) };
}
