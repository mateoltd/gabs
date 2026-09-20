import type { Context } from "../identity/authorization";
import { lockWorkspace } from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { audit } from "../persistence/transactions";
import { organizationPolicy } from "./module-policy";
import { reconcileModulePolicies } from "./module-assignments";

/** Adopt already-authorized policy intent after reviewed registry publication. */
export async function refreshModulePolicies(tx: Tx, ctx: Context) {
  const revision = (
    await tx
      .selectFrom("suite.registry_revision")
      .select("revision")
      .where("id", "=", true)
      .executeTakeFirstOrThrow()
  ).revision;
  const applied = () =>
    tx
      .selectFrom("suite.module_policy_refresh")
      .select("registry_revision")
      .where("workspace_id", "=", ctx.workspaceId)
      .executeTakeFirst();
  const current = async () =>
    BigInt((await applied())?.registry_revision ?? "-1") >= BigInt(revision);
  if (await current()) return;
  await lockWorkspace(tx, ctx.workspaceId);
  // Another request can finish this exact revision while we wait for the lock.
  if (await current()) return;
  const policy = await organizationPolicy(tx, ctx.workspaceId);
  if (
    [...(policy?.groups ?? []), ...(policy?.tags ?? [])].some(
      (source) => source.modules?.length,
    )
  ) {
    const changes = await reconcileModulePolicies(
      tx,
      ctx.workspaceId,
      ctx.runtime.catalog,
      "available",
    );
    if (changes.added || changes.removed)
      await audit(tx, ctx, "modules.policy_refreshed", `registry:${revision}`);
  }
  await tx
    .insertInto("suite.module_policy_refresh")
    .values({ workspace_id: ctx.workspaceId, registry_revision: revision })
    .onConflict((oc) =>
      oc.column("workspace_id").doUpdateSet({ registry_revision: revision }),
    )
    .execute();
}
