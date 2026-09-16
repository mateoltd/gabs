import "dotenv/config";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { sql } from "kysely";
import type { ModuleDefinition } from "@suite/module-sdk";
import {
  connectDatabase,
  inWorkspace,
  identify,
  provisionWorkspace,
  authorize,
  type Actor,
} from "../packages/server-core/src";
import { workspaceModule } from "../packages/server-core/src/module-releases";
import { migrateModuleStorage } from "../packages/server-core/src/module-migrations";
import { assertModuleStorage } from "../packages/server-core/src/module-storage";
import { executeResource } from "../packages/server-core/src/module-runtime";
import { signPackage } from "../packages/module-sdk/node/signing";
import { buildServerPackage } from "../packages/module-sdk/node/build-server";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../tooling/registry-review";

it("migrates only its workspace namespace, rolls back failed/interrupted work, and preserves compatible executable pins", async () => {
  const db = connectDatabase();
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  const id = `migration-${randomUUID().slice(0, 8)}`,
    workspace = randomUUID(),
    foreign = randomUUID(),
    emptyWorkspace = randomUUID();
  const first = "00000000-0000-4000-8000-000000000001",
    second = "00000000-0000-4000-8000-000000000002";
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/migration-fixture-"));
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      name: "Migration operator",
      email: `${randomUUID()}@test.local`,
      emailVerified: true,
    });
    const actor: Actor = {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: true,
      mfa: true,
    };
    for (const ws of [workspace, foreign, emptyWorkspace])
      await inWorkspace(db, ws, (tx) =>
        provisionWorkspace(tx, {
          id: ws,
          userId: user.id,
          name: "Migration fixture",
          kind: "company",
        }),
      );
    const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
      publicKey = await readFile(`${keys}/public.pem`, "utf8");
    for (const [version, schema, max] of [
      ["1.0.0", 1, 1],
      ["1.1.0", 1, 2],
      ["2.0.0", 2, 2],
    ] as const) {
      const folder = resolve(directory, version);
      await mkdir(folder);
      const properties =
        max === 1
          ? "name:field.text()"
          : `name:field.text(), category:${schema === 2 ? "field.text()" : "Type.Optional(field.text())"}`;
      await writeFile(
        resolve(folder, "module.ts"),
        `import {defineModule,resource,field,Type} from '@suite/module-sdk'; export default defineModule({id:'${id}',name:'Migration notes',version:'${version}',description:'Migration acceptance',host:'^1.0.0',backend:'^1.0.0',publisher:'suite',dependencies:{},permissions:['${id}.notes.read','${id}.notes.write'],configuration:Type.Object({}),operations:{},resources:{notes:resource({${properties},sibling:Type.Optional(field.reference('${id}','notes')),assignee:Type.Optional(field.member()),contact:Type.Optional(field.reference('contacts','people'))},{title:'Notes'})},storage:{version:${schema},compatible:{minimum:${schema},maximum:${max}},migrations:${schema === 2 ? "{'add-category':{from:1,to:2}}" : "{}"}}});`,
      );
      if (schema === 2)
        await writeFile(
          resolve(folder, "module-server.ts"),
          `import {defineModuleServer} from '@suite/module-sdk/server'; import module from './module'; export default defineModuleServer(module)({}, {'add-category':async(ctx)=>{let cursor;do{const page=await ctx.scan('notes',cursor);for(const row of page.items){await ctx.write('notes',row.id,{...row.data,category:'general',...(row.data.name==='invalid-write'?{sibling:'ffffffff-ffff-4fff-8fff-ffffffffffff'}:{}),...(row.data.name==='invalid-member'?{assignee:'ffffffff-ffff-4fff-8fff-ffffffffffff'}:{}),...(row.data.name==='invalid-cross-module'?{contact:'ffffffff-ffff-4fff-8fff-ffffffffffff'}:{})},row.version);if(row.data.name==='invalid-create')await ctx.create('notes',{name:'Invalid',category:'general',sibling:'ffffffff-ffff-4fff-8fff-ffffffffffff'});if(row.data.name==='fail')throw Error('Fixture migration rejected');}cursor=page.next??undefined;}while(cursor);const legacy=await ctx.scan('legacy');for(const row of legacy.items){await ctx.create('notes',{name:row.data.name,category:'general'},row.id);await ctx.archive('legacy',row.id,row.version);}}});`,
        );
      const module = (
        await import(pathToFileURL(resolve(folder, "module.ts")).href)
      ).default as ModuleDefinition;
      const pkg = signPackage(module, privateKey);
      const server =
        schema === 2
          ? await buildServerPackage(module, folder, privateKey)
          : null;
      const submission = await submitRelease(registry, pkg, server, publicKey);
      await reviewRelease(
        registry,
        submission,
        "approved",
        "Reviewed migration fixture",
        publicKey,
      );
      if (server) await stageRelease(registry, submission, publicKey);
      await publishRelease(registry, submission, publicKey);
    }
    for (const ws of [workspace, foreign])
      await inWorkspace(db, ws, async (tx) => {
        await tx
          .insertInto("suite.entitlements")
          .values({ workspace_id: ws, module_id: id, active: true })
          .execute();
        await tx
          .insertInto("suite.module_records")
          .values([
            {
              workspace_id: ws,
              module_id: id,
              resource: "notes",
              id: first,
              data: { name: "first" },
              created_by: user.id,
              version: 1,
              archived: false,
              updated_at: new Date(),
            },
            {
              workspace_id: ws,
              module_id: id,
              resource: "notes",
              id: second,
              data: { name: "fail" },
              created_by: user.id,
              version: 1,
              archived: true,
              updated_at: new Date(),
            },
            {
              workspace_id: ws,
              module_id: id,
              resource: "legacy",
              id: "00000000-0000-4000-8000-000000000003",
              data: { name: "Migrated legacy record" },
              created_by: user.id,
              version: 1,
              archived: false,
              updated_at: new Date(),
            },
            {
              workspace_id: ws,
              module_id: "foreign-module",
              resource: "notes",
              id: first,
              data: { name: "isolated" },
              created_by: user.id,
              version: 1,
              archived: false,
              updated_at: new Date(),
            },
          ])
          .execute();
      });
    await inWorkspace(db, emptyWorkspace, async (tx) => {
      await tx
        .insertInto("suite.entitlements")
        .values({ workspace_id: emptyWorkspace, module_id: id, active: true })
        .execute();
      const ctx = await authorize(
        tx,
        actor,
        emptyWorkspace,
        randomUUID(),
        "modules.manage",
      );
      expect(await migrateModuleStorage(tx, ctx, id, "2.0.0")).toEqual({
        moduleId: id,
        schemaVersion: 2,
        applied: [],
      });
      expect(await migrateModuleStorage(tx, ctx, id, "2.0.0")).toEqual({
        moduleId: id,
        schemaVersion: 2,
        applied: [],
      });
      expect((await workspaceModule(tx, emptyWorkspace, id)).version).toBe(
        "2.0.0",
      );
      expect(
        await tx
          .selectFrom("suite.module_migrations")
          .selectAll()
          .where("workspace_id", "=", emptyWorkspace)
          .execute(),
      ).toEqual([]);
    });
    const context = (tx: Parameters<typeof authorize>[0]) =>
      authorize(tx, actor, workspace, randomUUID(), "modules.manage");
    const apply = () =>
      inWorkspace(db, workspace, async (tx) =>
        migrateModuleStorage(tx, await context(tx), id, "2.0.0"),
      );
    expect(
      await inWorkspace(
        db,
        workspace,
        async (tx) => (await workspaceModule(tx, workspace, id)).version,
      ),
    ).toBe("1.1.0");
    // Catching the handler failure must not commit its earlier writes or history.
    await inWorkspace(db, workspace, async (tx) => {
      await expect(
        migrateModuleStorage(tx, await context(tx), id, "2.0.0"),
      ).rejects.toThrow("Fixture migration rejected");
    });
    const snapshot = async () =>
      (
        await admin.query(
          "select data,version from suite.module_records where workspace_id=$1 and module_id=$2 and resource='notes' order by id",
          [workspace, id],
        )
      ).rows;
    expect(await snapshot()).toEqual([
      { data: { name: "first" }, version: 1 },
      { data: { name: "fail" }, version: 1 },
    ]);
    expect(
      (
        await admin.query(
          "select count(*) from suite.module_migrations where workspace_id=$1 and module_id=$2",
          [workspace, id],
        )
      ).rows[0].count,
    ).toBe("0");
    await admin.query(
      "update suite.module_records set data=$3 where workspace_id=$1 and module_id=$2 and id=$4",
      [workspace, id, { name: "second" }, second],
    );
    for (const [name, code] of [
      ["invalid-write", "NOT_FOUND"],
      ["invalid-create", "NOT_FOUND"],
      ["invalid-member", "INVALID_MEMBER"],
      ["invalid-cross-module", "UNDECLARED_DEPENDENCY"],
    ]) {
      await admin.query(
        "update suite.module_records set data=$3 where workspace_id=$1 and module_id=$2 and id=$4",
        [workspace, id, { name }, second],
      );
      await expect(apply()).rejects.toMatchObject({ code });
      expect((await snapshot())[0]).toEqual({
        data: { name: "first" },
        version: 1,
      });
    }
    await admin.query(
      "update suite.module_records set data=$3 where workspace_id=$1 and module_id=$2 and id=$4",
      [workspace, id, { name: "second" }, second],
    );
    // Hold the second record so the migration has changed the first when its connection is interrupted.
    const blocker = await admin.connect();
    await blocker.query("begin");
    await blocker.query(
      "select id from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3 for update",
      [workspace, id, second],
    );
    let pid = 0;
    const interrupted = inWorkspace(db, workspace, async (tx) => {
      pid = (
        await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)
      ).rows[0].pid;
      return migrateModuleStorage(tx, await context(tx), id, "2.0.0");
    });
    const failed = expect(interrupted).rejects.toThrow();
    try {
      await expect
        .poll(async () =>
          pid
            ? (
                await admin.query(
                  "select wait_event_type from pg_stat_activity where pid=$1",
                  [pid],
                )
              ).rows[0]?.wait_event_type
            : "starting",
        )
        .toBe("Lock");
      let readerPid = 0;
      const reader = inWorkspace(db, workspace, async (tx) => {
        readerPid = (
          await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)
        ).rows[0].pid;
        return (await workspaceModule(tx, workspace, id)).version;
      });
      await expect
        .poll(async () =>
          readerPid
            ? (
                await admin.query(
                  "select wait_event_type from pg_stat_activity where pid=$1",
                  [readerPid],
                )
              ).rows[0]?.wait_event_type
            : "starting",
        )
        .toBe("Lock");
      await admin.query("select pg_terminate_backend($1)", [pid]);
      await failed;
      expect(await reader).toBe("1.1.0");
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
    expect(await snapshot()).toEqual([
      { data: { name: "first" }, version: 1 },
      { data: { name: "second" }, version: 1 },
    ]);
    await inWorkspace(db, workspace, async (tx) => {
      await tx
        .insertInto("suite.module_records")
        .values(
          Array.from({ length: 101 }, (_, i) => ({
            workspace_id: workspace,
            module_id: id,
            resource: "notes",
            id: randomUUID(),
            data: { name: `Page record ${i}` },
            created_by: user.id,
            version: 1,
            archived: false,
            updated_at: new Date(),
          })),
        )
        .execute();
    });
    // Preserve an existing historical link to an archived record.
    await admin.query(
      "update suite.module_records set data=$3 where workspace_id=$1 and module_id=$2 and id=$4",
      [workspace, id, { name: "first", sibling: second }, first],
    );
    const results = await Promise.all([apply(), apply()]);
    expect(results.map((r) => r.applied.length).sort()).toEqual([0, 1]);
    const migrated = await snapshot();
    expect(migrated).toHaveLength(104);
    expect(migrated.every((r) => r.data.category === "general")).toBe(true);
    expect(migrated.slice(0, 2)).toEqual([
      {
        data: { name: "first", category: "general", sibling: second },
        version: 2,
      },
      { data: { name: "second", category: "general" }, version: 2 },
    ]);
    expect(
      (
        await admin.query(
          "select archived,data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='legacy'",
          [workspace, id],
        )
      ).rows,
    ).toEqual([{ archived: true, data: { name: "Migrated legacy record" } }]);
    expect(
      (
        await admin.query(
          "select count(*) from suite.module_migrations where workspace_id=$1 and module_id=$2",
          [workspace, id],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await admin.query(
          "select data from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3",
          [foreign, id, first],
        )
      ).rows[0].data,
    ).toEqual({ name: "first" });
    expect(
      (
        await admin.query(
          "select data from suite.module_records where workspace_id=$1 and module_id='foreign-module'",
          [workspace],
        )
      ).rows[0].data,
    ).toEqual({ name: "isolated" });
    await expect(
      inWorkspace(db, workspace, async (tx) =>
        migrateModuleStorage(tx, await context(tx), id, "1.0.0"),
      ),
    ).rejects.toMatchObject({ code: "SCHEMA_DOWNGRADE_FORBIDDEN" });
    await admin.query(
      "insert into suite.platform_settings(workspace_id,key,value) values($1,$2,$3)",
      [workspace, `pin:${id}`, { version: "1.0.0" }],
    );
    await expect(
      inWorkspace(db, workspace, async (tx) =>
        assertModuleStorage(
          tx,
          workspace,
          await workspaceModule(tx, workspace, id),
        ),
      ),
    ).rejects.toMatchObject({ code: "MODULE_SCHEMA_INCOMPATIBLE" });
    await admin.query(
      "update suite.platform_settings set value=$3 where workspace_id=$1 and key=$2",
      [workspace, `pin:${id}`, { version: "1.1.0" }],
    );
    await inWorkspace(db, workspace, async (tx) => {
      const module = await workspaceModule(tx, workspace, id);
      expect(module.version).toBe("1.1.0");
      await assertModuleStorage(tx, workspace, module);
    });
    await inWorkspace(db, workspace, async (tx) => {
      const ctx = await context(tx);
      const owner = await tx
        .selectFrom("suite.roles")
        .select(["id", "permissions"])
        .where("workspace_id", "=", workspace)
        .where("name", "=", "Owner")
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: owner.permissions.filter((p) => p !== "modules.manage"),
        })
        .where("id", "=", owner.id)
        .execute();
      await expect(
        migrateModuleStorage(tx, ctx, id, "2.0.0"),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await tx
        .updateTable("suite.roles")
        .set({ permissions: owner.permissions })
        .where("id", "=", owner.id)
        .execute();
    });
    // Even a forward-compatible old executable cannot write invalid data into the newer stored schema.
    await inWorkspace(db, workspace, async (tx) => {
      const ctx = await context(tx);
      ctx.permissions.push(`${id}.notes.read`, `${id}.notes.write`);
      await tx
        .insertInto("suite.module_activations")
        .values({
          workspace_id: workspace,
          module_id: id,
          state: "enabled",
          access_policy: "admin",
          config: {},
        })
        .execute();
      await tx
        .insertInto("suite.module_assignments")
        .values({
          workspace_id: workspace,
          module_id: id,
          membership_id: ctx.membershipId,
        })
        .execute();
      await expect(
        executeResource(tx, ctx, id, {
          action: "create",
          resource: "notes",
          input: { id: randomUUID(), data: { name: "Invalid old write" } },
        }),
      ).rejects.toThrow();
      await executeResource(tx, ctx, id, {
        action: "create",
        resource: "notes",
        input: {
          id: randomUUID(),
          data: { name: "Compatible old write", category: "general" },
        },
      });
    });
  } finally {
    await db.destroy();
    await registry.end();
    await admin.query("delete from suite.module_releases where module_id=$1", [
      id,
    ]);
    await admin.query(
      "delete from suite.module_review_events where submission_id in (select id from suite.module_submissions where module_id=$1)",
      [id],
    );
    await admin.query(
      "delete from suite.module_submissions where module_id=$1",
      [id],
    );
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
