import type { Context, Tx } from "@suite/server-core";
import { requireCondition } from "@suite/server-core";
import { moduleServers } from "@suite/module-catalog/server";
import { moduleStorageVersions } from "@suite/server-core/persistence/module-storage";
import { workspaceModule } from "@suite/server-core/registry/module-releases";
import { executeModuleOperation } from "@suite/server-core/runtime/services";
import { assertHostModuleRollout } from "@suite/server-core/registry/module-rollout";
import {
  legacyInventory as inventory,
  legacyOrders as orders,
} from "@suite/module-catalog/business";

/** Transitional host routes use the selected module's public queries after cutover. */
export async function businessQuery(
  tx: Tx,
  ctx: Context,
  moduleId: "orders" | "inventory",
  operation: string,
  input: unknown,
  legacy: () => Promise<unknown>,
) {
  if (
    ((await moduleStorageVersions(tx, ctx.workspaceId)).get(moduleId) ?? 1) ===
    1
  ) {
    if (
      input &&
      typeof input === "object" &&
      "cursor" in input &&
      input.cursor !== undefined
    )
      requireCondition(
        typeof input.cursor === "string" &&
          /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
            input.cursor,
          ),
        400,
        "INVALID_INPUT",
        "The legacy page cursor must be a record identifier.",
      );
    await assertHostModuleRollout(
      tx,
      ctx.workspaceId,
      ctx.runtime.catalog,
      moduleId === "orders" ? orders : inventory,
      moduleServers,
    );
    return legacy();
  }
  const definition = await workspaceModule(
    tx,
    ctx.workspaceId,
    moduleId,
    ctx.runtime.catalog,
  );
  requireCondition(
    definition.operations[operation]?.kind === "query",
    409,
    "QUERY_CONTRACT_REQUIRED",
    "Update the business module to a release supporting this read-only view.",
  );
  return executeModuleOperation(
    tx,
    ctx,
    definition,
    operation,
    input,
    moduleServers,
  );
}
