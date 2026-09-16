import { sql } from "kysely";
import { supportsStorage, type ModuleDefinition } from "@suite/module-sdk";
import type { Tx } from "./database";
import { requireCondition } from "./errors";
const locks = new WeakMap<Tx, Map<string, "shared" | "exclusive">>();
const versions = new WeakMap<Tx, Map<string, Promise<Map<string, number>>>>();
/** A workspace lock also covers cross-module calls; schema changes cannot race business transactions. */
export async function lockModuleStorage(
  tx: Tx,
  workspaceId: string,
  exclusive = false,
) {
  let held = locks.get(tx);
  if (!held) {
    held = new Map();
    locks.set(tx, held);
  }
  const mode = held.get(workspaceId);
  requireCondition(
    !exclusive || mode !== "shared",
    409,
    "MIGRATION_LOCK_ORDER",
    "Start a migration before reading module releases in this transaction.",
  );
  if (mode) return;
  const key = `module-storage:${workspaceId}`;
  if (exclusive)
    await sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(
      tx,
    );
  else
    await sql`select pg_advisory_xact_lock_shared(hashtextextended(${key},0))`.execute(
      tx,
    );
  held.set(workspaceId, exclusive ? "exclusive" : "shared");
}
export async function moduleStorageVersions(tx: Tx, workspaceId: string) {
  await lockModuleStorage(tx, workspaceId);
  let cached = versions.get(tx);
  if (!cached) {
    cached = new Map();
    versions.set(tx, cached);
  }
  if (!cached.has(workspaceId))
    cached.set(
      workspaceId,
      tx
        .selectFrom("suite.module_storage")
        .select(["module_id", "schema_version"])
        .where("workspace_id", "=", workspaceId)
        .execute()
        .then(
          (rows) => new Map(rows.map((r) => [r.module_id, r.schema_version])),
        ),
    );
  return cached.get(workspaceId)!;
}
export function invalidateStorageVersions(tx: Tx, workspaceId: string) {
  versions.get(tx)?.delete(workspaceId);
}
export async function assertModuleStorage(
  tx: Tx,
  workspaceId: string,
  module: ModuleDefinition,
) {
  const version =
    (await moduleStorageVersions(tx, workspaceId)).get(module.id) ?? 1;
  requireCondition(
    supportsStorage(module, version),
    409,
    "MODULE_SCHEMA_INCOMPATIBLE",
    `${module.name}@${module.version} cannot use stored schema ${version}. Apply its reviewed migration or choose a compatible release.`,
  );
}
