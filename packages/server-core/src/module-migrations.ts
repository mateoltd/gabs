import { validateConfiguredRollouts } from "./module-rollout";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  assertSchema,
  hydrateModule,
  identifier,
  storageContract,
  supportsStorage,
  type MigrationContext,
  type ModuleDefinition,
  type TSchema,
} from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import type { Tx } from "./database";
import { authorize, type Context } from "./authorization";
import type { InstalledModuleServer } from "./module-services";
import { resolveWorkspaceRelease } from "./module-releases";
import { stagedModuleServer } from "./staged-module-server";
import { validateReferences } from "./module-runtime";
import {
  lockModuleStorage,
  moduleStorageVersions,
  invalidateStorageVersions,
  assertModuleStorage,
} from "./module-storage";
import { found, requireCondition } from "./errors";
import { audit, publish } from "./transactions";

/** Uses a savepoint so caught migration failures cannot commit partial data. */
export async function migrateModuleStorage(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  targetVersion: string,
  builtins: readonly InstalledModuleServer[] = [],
) {
  await lockModuleStorage(tx, ctx.workspaceId, true);
  ctx = await authorize(
    tx,
    ctx.actor,
    ctx.workspaceId,
    ctx.requestId,
    "modules.manage",
  );
  await sql`savepoint suite_module_migration`.execute(tx);
  try {
    const result = await applyMigration(
      tx,
      ctx,
      moduleId,
      targetVersion,
      builtins,
    );
    await sql`release savepoint suite_module_migration`.execute(tx);
    return result;
  } catch (error) {
    try {
      await sql`rollback to savepoint suite_module_migration`.execute(tx);
      await sql`release savepoint suite_module_migration`.execute(tx);
    } catch {
      /* A disconnected transaction is rolled back by PostgreSQL. */
    }
    invalidateStorageVersions(tx, ctx.workspaceId);
    throw error;
  }
}
async function applyMigration(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  targetVersion: string,
  builtins: readonly InstalledModuleServer[],
) {
  requireCondition(
    ctx.permissions.includes("modules.manage"),
    403,
    "FORBIDDEN",
    "Module administration permission is required for storage migrations.",
  );
  await lockModuleStorage(tx, ctx.workspaceId, true);
  const packages = await resolveWorkspaceRelease(
    tx,
    ctx.workspaceId,
    moduleId,
    false,
    targetVersion,
  );
  const pkg = found(packages.find((p) => p.module_id === moduleId));
  const module = hydrateModule(pkg.artifact as unknown as ModuleDefinition);
  const storage = storageContract(module);
  const stored = await moduleStorageVersions(tx, ctx.workspaceId);
  const current = stored.get(moduleId) ?? 1;
  const entitlement = await tx
    .selectFrom("suite.entitlements")
    .select("active")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("module_id", "=", moduleId)
    .executeTakeFirst();
  requireCondition(
    entitlement?.active,
    409,
    "NOT_ENTITLED",
    "An active module entitlement is required before migration.",
  );
  for (const dependency of packages.filter((p) => p.module_id !== moduleId))
    await assertModuleStorage(
      tx,
      ctx.workspaceId,
      hydrateModule(dependency.artifact as unknown as ModuleDefinition),
    );
  if (storage.version <= current) {
    requireCondition(
      supportsStorage(module, current),
      409,
      "SCHEMA_DOWNGRADE_FORBIDDEN",
      "This executable cannot use the stored schema. Data migrations are forward-only.",
    );
    return { moduleId, schemaVersion: current, applied: [] as string[] };
  }
  const count = await tx
    .selectFrom("suite.module_records")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("workspace_id", "=", ctx.workspaceId)
    .where("module_id", "=", moduleId)
    .executeTakeFirstOrThrow();
  const initialize = !stored.has(moduleId) && Number(count.count) === 0;
  const steps: { name: string; from: number; to: number }[] = [];
  if (!initialize)
    for (let version = current; version < storage.version; version++) {
      const entry = Object.entries(storage.migrations).find(
        ([, step]) => step.from === version,
      );
      requireCondition(
        entry,
        409,
        "MIGRATION_PATH_MISSING",
        `No reviewed migration from stored schema ${version} for ${moduleId}@${targetVersion}.`,
      );
      steps.push({ name: entry[0], ...entry[1] });
    }
  const server = steps.length
    ? await stagedModuleServer(tx, module, builtins)
    : undefined;
  if (steps.length)
    requireCondition(
      server?.kind === "scoped" &&
        server.migrate &&
        canonical(server.module) === canonical(module),
      409,
      "MIGRATION_BACKEND_UNAVAILABLE",
      "Stage the exact reviewed migration backend before changing stored data.",
    );
  for (const step of steps) {
    let closed = false,
      failed = false,
      failure: unknown;
    const pending = new Set<Promise<unknown>>();
    const guarded = <T>(run: () => Promise<T>) => {
      const task = Promise.resolve().then(() => {
        requireCondition(
          !closed,
          409,
          "MIGRATION_CLOSED",
          "This migration step has finished.",
        );
        return run();
      });
      pending.add(task);
      void task.then(
        () => pending.delete(task),
        (error) => {
          failed = true;
          failure ??= error;
          pending.delete(task);
        },
      );
      return task;
    };
    const context: MigrationContext = {
      workspaceId: ctx.workspaceId,
      from: step.from,
      to: step.to,
      scan: (resource, after) =>
        guarded(async () => {
          requireCondition(
            identifier.test(resource),
            400,
            "INVALID_RESOURCE",
            "Migration resources must be valid names in this module namespace.",
          );
          let query = tx
            .selectFrom("suite.module_records")
            .select(["id", "resource", "data", "version", "archived"])
            .where("workspace_id", "=", ctx.workspaceId)
            .where("module_id", "=", moduleId)
            .where("resource", "=", resource)
            .orderBy("id")
            .limit(101);
          if (after) query = query.where("id", ">", after);
          const rows = await query.execute();
          return {
            items: rows.slice(0, 100),
            next: rows.length > 100 ? rows[99].id : null,
          };
        }),
      create: (resource, data, id = randomUUID()) =>
        guarded(async () => {
          requireCondition(
            Object.hasOwn(module.resources, resource),
            400,
            "INVALID_RESOURCE",
            "Create records only in resources declared by the target module.",
          );
          await validateReferences(tx, ctx, module, resource, data);
          await tx
            .insertInto("suite.module_records")
            .values({
              workspace_id: ctx.workspaceId,
              module_id: moduleId,
              resource,
              id,
              data,
              version: 1,
              archived: false,
              created_by: ctx.actor.id,
              updated_at: new Date(),
            })
            .execute();
          await tx
            .insertInto("suite.module_revisions")
            .values({
              workspace_id: ctx.workspaceId,
              module_id: moduleId,
              resource,
              record_id: id,
              version: 1,
              data,
            })
            .execute();
          return { id, resource, data, version: 1, archived: false };
        }),
      archive: (resource, id, expectedVersion) =>
        guarded(async () => {
          requireCondition(
            identifier.test(resource) && Number.isSafeInteger(expectedVersion),
            400,
            "INVALID_RECORD",
            "Supply a resource and current record version.",
          );
          const row = await tx
            .updateTable("suite.module_records")
            .set({
              archived: true,
              version: expectedVersion + 1,
              updated_at: new Date(),
            })
            .where("workspace_id", "=", ctx.workspaceId)
            .where("module_id", "=", moduleId)
            .where("resource", "=", resource)
            .where("id", "=", id)
            .where("version", "=", expectedVersion)
            .returning("data")
            .executeTakeFirst();
          requireCondition(
            row,
            412,
            "MIGRATION_RECORD_CONFLICT",
            "The record is missing from this module namespace or its version changed.",
          );
          await tx
            .insertInto("suite.module_revisions")
            .values({
              workspace_id: ctx.workspaceId,
              module_id: moduleId,
              resource,
              record_id: id,
              version: expectedVersion + 1,
              data: row.data,
            })
            .execute();
        }),
      write: (resource, id, data, expectedVersion) =>
        guarded(async () => {
          requireCondition(
            identifier.test(resource) && Number.isSafeInteger(expectedVersion),
            400,
            "INVALID_RECORD",
            "Supply a resource and current record version.",
          );
          const properties = module.resources[resource]?.schema.properties as
            Record<string, TSchema> | undefined;
          const references = Object.entries(properties ?? {}).filter(
            ([, field]) => field["x-reference"] || field["x-membership"],
          );
          if (references.length) {
            const previous = found(
              await tx
                .selectFrom("suite.module_records")
                .select("data")
                .where("workspace_id", "=", ctx.workspaceId)
                .where("module_id", "=", moduleId)
                .where("resource", "=", resource)
                .where("id", "=", id)
                .where("version", "=", expectedVersion)
                .forUpdate()
                .executeTakeFirst(),
            );
            // Preserve historical links, including archived targets. New links
            // require the same current membership and cross-module grants as CRUD.
            await validateReferences(
              tx,
              ctx,
              module,
              resource,
              Object.fromEntries(
                references
                  .filter(([key]) => data[key] !== previous.data[key])
                  .map(([key]) => [key, data[key]]),
              ),
            );
          }
          const result = await tx
            .updateTable("suite.module_records")
            .set({ data, version: expectedVersion + 1, updated_at: new Date() })
            .where("workspace_id", "=", ctx.workspaceId)
            .where("module_id", "=", moduleId)
            .where("resource", "=", resource)
            .where("id", "=", id)
            .where("version", "=", expectedVersion)
            .returning("id")
            .executeTakeFirst();
          requireCondition(
            result,
            412,
            "MIGRATION_RECORD_CONFLICT",
            "The record is missing from this module namespace or its version changed.",
          );
          await tx
            .insertInto("suite.module_revisions")
            .values({
              workspace_id: ctx.workspaceId,
              module_id: moduleId,
              resource,
              record_id: id,
              version: expectedVersion + 1,
              data,
            })
            .execute();
        }),
    };
    try {
      await (server!.kind === "scoped"
        ? server!.migrate!(step.name, context)
        : Promise.reject(Error("Unscoped migration")));
    } catch (error) {
      failed = true;
      failure ??= error;
    } finally {
      closed = true;
      while (pending.size) await Promise.allSettled([...pending]);
    }
    if (failed) throw failure;
    await tx
      .insertInto("suite.module_migrations")
      .values({
        workspace_id: ctx.workspaceId,
        module_id: moduleId,
        from_version: step.from,
        to_version: step.to,
        migration_id: step.name,
        release_version: module.version,
        actor_id: ctx.actor.id,
      })
      .execute();
  }
  // Validate every retained record, including archived records, before committing the schema version.
  for (const [resource, definition] of Object.entries(module.resources)) {
    let cursor: string | undefined;
    for (;;) {
      let query = tx
        .selectFrom("suite.module_records")
        .select(["id", "data"])
        .where("workspace_id", "=", ctx.workspaceId)
        .where("module_id", "=", moduleId)
        .where("resource", "=", resource)
        .orderBy("id")
        .limit(100);
      if (cursor) query = query.where("id", ">", cursor);
      const records = await query.execute();
      for (const record of records)
        assertSchema(definition.schema, record.data);
      if (records.length < 100) break;
      cursor = records.at(-1)!.id;
    }
  }
  await tx
    .insertInto("suite.module_storage")
    .values({
      workspace_id: ctx.workspaceId,
      module_id: moduleId,
      schema_version: storage.version,
      release_version: module.version,
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(["workspace_id", "module_id"]).doUpdateSet({
        schema_version: storage.version,
        release_version: module.version,
        updated_at: new Date(),
      }),
    )
    .execute();
  invalidateStorageVersions(tx, ctx.workspaceId);
  await validateConfiguredRollouts(tx, ctx.workspaceId, builtins);
  await audit(
    tx,
    ctx,
    initialize ? "modules.storage.initialized" : "modules.storage.migrated",
    moduleId,
  );
  await publish(tx, ctx, "module.storage.migrated", {
    moduleId,
    releaseVersion: module.version,
    from: current,
    to: storage.version,
    steps: steps.map((s) => s.name),
  });
  return {
    moduleId,
    schemaVersion: storage.version,
    applied: steps.map((s) => s.name),
  };
}
