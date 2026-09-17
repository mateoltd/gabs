import { expect, it } from "vitest";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import {
  defineLocalModule,
  migrateLocalSnapshot,
  type LocalRequest,
  type LocalMigrationContext,
} from "@suite/module-sdk/local";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const link = () => field.reference("local-link-migrations", "targets");
const source = defineModule({
  id: "local-link-migrations",
  name: "Links",
  version: "1.0.0",
  description: "Migration tests",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  permissions: ["notes", "targets"].flatMap((name) =>
    ["read", "write"].map(
      (action) => `local-link-migrations.${name}.${action}`,
    ),
  ),
  configuration: Type.Object({}),
  operations: {},
  resources: {
    targets: resource(
      { name: field.text() },
      { title: "Targets", standalone: true },
    ),
    notes: resource(
      {
        name: field.text(),
        links: Type.Array(link()),
        extra: Type.Optional(Type.String()),
      },
      { title: "Notes", standalone: true },
    ),
  },
});
const target = defineModule({
  ...source,
  version: "2.0.0",
  localStorage: {
    version: 2,
    compatible: { minimum: 2, maximum: 2 },
    migrations: { upgrade: { from: 1, to: 2 } },
  },
});
const request = (): LocalRequest => ({
  profileId: "private",
  call: {
    moduleId: target.id,
    moduleVersion: target.version,
    action: "list",
    input: {},
  },
  configuration: {},
  snapshot: {
    records: {
      targets: [
        {
          id,
          data: { name: "Archived" },
          archived: true,
          version: 2,
          updatedAt: "2026-09-17",
        },
      ],
      notes: [
        {
          id: other,
          data: { name: "Historical", links: [id] },
          archived: false,
          version: 1,
          updatedAt: "2026-09-17",
        },
      ],
    },
    receipts: {
      accepted: { request: "exact historical request", result: "old result" },
    },
  },
});
const run = (
  migration: (ctx: LocalMigrationContext) => Promise<void>,
  input = request(),
  from: import("@suite/module-sdk").ModuleDefinition = source,
) =>
  migrateLocalSnapshot(
    target,
    input,
    1,
    defineLocalModule(target)({}, { upgrade: migration }),
    from,
  );
it("preserves unchanged archived references using the original contract and leaves input/receipts intact", async () => {
  const input = request(),
    before = structuredClone(input);
  const result = await run(async (ctx) => {
    const row = (await ctx.resource("notes").scan()).items[0];
    await ctx
      .resource("notes")
      .write(
        row.id,
        { ...row.data, name: "Updated", links: [id.toUpperCase()] },
        row.version,
      );
  }, input);
  expect(input).toEqual(before);
  expect(result.snapshot.receipts).toEqual(before.snapshot.receipts);
  expect(result.snapshot.records.notes[0].data.name).toBe("Updated");
  expect(result.schemaVersion).toBe(2);
  await expect(
    migrateLocalSnapshot(
      target,
      input,
      1,
      defineLocalModule(target)({}, { upgrade: async () => {} }),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(run(async () => {}, input, target)).rejects.toMatchObject({
    code: "LOCAL_CONTRACT_MISMATCH",
  });
});
it("does not grandfather a newly annotated field, changed target or invalid historical schema", async () => {
  const annotated = defineModule({
    ...target,
    resources: {
      ...target.resources,
      notes: resource(
        {
          name: field.text(),
          links: Type.Array(link()),
          extra: Type.Optional(link()),
        },
        { title: "Notes", standalone: true },
      ),
    },
  });
  const input = request();
  input.snapshot.records.notes[0].data.extra = id;
  await expect(
    migrateLocalSnapshot(
      annotated,
      input,
      1,
      defineLocalModule(annotated)({}, { upgrade: async () => {} }),
      source,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const changed = defineModule({
    ...target,
    resources: {
      ...target.resources,
      notes: resource(
        {
          name: field.text(),
          links: Type.Array(field.reference(source.id, "notes")),
        },
        { title: "Notes", standalone: true },
      ),
    },
  });
  await expect(
    migrateLocalSnapshot(
      changed,
      request(),
      1,
      defineLocalModule(changed)({}, { upgrade: async () => {} }),
      source,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const corrupt = request();
  corrupt.snapshot.records.notes[0].data.name = 42;
  await expect(
    run(async (ctx) => {
      const row = (await ctx.resource("notes").scan()).items[0];
      await ctx
        .resource("notes")
        .write(row.id, { name: "Repaired shape", links: [id] }, row.version);
    }, corrupt),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("rejects copying a historical link to another position or record and intermediate-write laundering", async () => {
  const before = request();
  for (const migration of [
    async (ctx: LocalMigrationContext) => {
      const row = (await ctx.resource("notes").scan()).items[0];
      await ctx
        .resource("notes")
        .write(row.id, { name: "Copied", links: [id, id] }, row.version);
    },
    async (ctx: LocalMigrationContext) => {
      await ctx
        .resource("notes")
        .create({ name: "New copied record", links: [id] });
    },
    async (ctx: LocalMigrationContext) => {
      const created = await ctx
        .resource("notes")
        .create({ name: 42, links: [id] });
      await ctx
        .resource("notes")
        .write(created.id, { name: "Rewritten", links: [id] }, created.version);
    },
  ]) {
    await expect(run(migration, before)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(before).toEqual(request());
  }
});
it("validates final transaction targets, allowing forward references but rejecting targets archived before completion", async () => {
  const next = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const migration =
    (archive: boolean) => async (ctx: LocalMigrationContext) => {
      const row = (await ctx.resource("notes").scan()).items[0];
      await ctx
        .resource("notes")
        .write(row.id, { name: "Forward link", links: [next] }, row.version);
      const created = await ctx
        .resource("targets")
        .create({ name: "Created later" }, next);
      if (archive)
        await ctx.resource("targets").archive(created.id, created.version);
    };
  expect((await run(migration(false))).snapshot.records.targets).toHaveLength(
    2,
  );
  await expect(run(migration(true))).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("checks retained archived rows, no-step installations and more than one scan page", async () => {
  const input = request();
  input.snapshot.records.notes = Array.from({ length: 105 }, (_, i) => ({
    ...input.snapshot.records.notes[0],
    id: String(i),
    archived: i === 104,
  }));
  const result = await run(async () => {}, input);
  expect(result.snapshot.records.notes).toHaveLength(105);
  input.snapshot.records.notes[104].data = {
    name: "New invalid annotation",
    links: [id],
    extra: other,
  };
  const annotated = defineModule({
    ...target,
    resources: {
      ...target.resources,
      notes: resource(
        {
          name: field.text(),
          links: Type.Array(link()),
          extra: Type.Optional(link()),
        },
        { title: "Notes", standalone: true },
      ),
    },
  });
  await expect(
    migrateLocalSnapshot(annotated, input, 2, undefined, source),
  ).rejects.toMatchObject({ code: "LOCAL_CONTRACT_MISMATCH" });
  const compatible = defineModule({
    ...source,
    localStorage: {
      version: 1,
      compatible: { minimum: 1, maximum: 2 },
      migrations: {},
    },
  });
  await expect(
    migrateLocalSnapshot(annotated, input, 2, undefined, compatible),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
