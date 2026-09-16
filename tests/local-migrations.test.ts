import { expect, it } from "vitest";
import {
  defineModule,
  resource,
  field,
  Type,
  localStorageContract,
} from "@suite/module-sdk";
import {
  defineLocalModule,
  migrateLocalSnapshot,
  type LocalRequest,
  type LocalMigrationContext,
} from "@suite/module-sdk/local";
import {
  requiresLocalCode,
  requiresServer,
} from "@suite/module-sdk/local-artifact";
const module = defineModule({
  id: "local-migrations",
  name: "Local migration proof",
  description: "Profile data",
  version: "3.0.0",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: {},
  permissions: ["local-migrations.notes.read", "local-migrations.notes.write"],
  configuration: Type.Object({}),
  operations: {},
  localStorage: {
    version: 3,
    compatible: { minimum: 3, maximum: 3 },
    migrations: { rename: { from: 1, to: 2 }, normalize: { from: 2, to: 3 } },
  },
  resources: {
    notes: resource(
      { body: field.text(), normalized: field.boolean() },
      { title: "Notes", standalone: true },
    ),
  },
});
const request = (): LocalRequest => ({
  profileId: "private",
  configuration: {},
  call: {
    moduleId: module.id,
    moduleVersion: module.version,
    action: "list",
    input: {},
  },
  snapshot: {
    records: {
      oldNotes: [
        {
          id: "one",
          version: 2,
          archived: true,
          updatedAt: "2026-01-01",
          data: { text: "Retained" },
        },
      ],
    },
    receipts: {
      key: { request: "historical request", result: "historical result" },
    },
  },
});
const rename = async (ctx: LocalMigrationContext) => {
  const page = await ctx.resource("oldNotes").scan();
  for (const row of page.items)
    await ctx
      .resource("oldNotes")
      .write(row.id, { body: row.data.text }, row.version);
  await ctx.renameResource("oldNotes", "notes");
};
const normalize = async (ctx: LocalMigrationContext) => {
  for (const row of (await ctx.resource("notes").scan()).items)
    await ctx
      .resource("notes")
      .write(row.id, { ...row.data, normalized: true }, row.version);
};
it("migrates archived data through a complete local path while preserving original snapshots and historical receipts", async () => {
  const initial = request(),
    original = structuredClone(initial);
  const result = await migrateLocalSnapshot(
    module,
    initial,
    1,
    defineLocalModule(module)({}, { rename, normalize }),
  );
  expect(initial).toEqual(original);
  expect(result).toMatchObject({
    schemaVersion: 3,
    migrations: ["rename", "normalize"],
    snapshot: {
      receipts: initial.snapshot.receipts,
      records: {
        notes: [
          {
            id: "one",
            version: 4,
            archived: true,
            data: { body: "Retained", normalized: true },
          },
        ],
      },
    },
  });
  expect(result.snapshot.records).not.toHaveProperty("oldNotes");
  expect(requiresLocalCode(module)).toBe(true);
  expect(requiresServer(module)).toBe(false);
  expect(
    localStorageContract(
      defineModule({
        ...module,
        storage: {
          version: 99,
          compatible: { minimum: 99, maximum: 99 },
          migrations: {},
        },
      }),
    ).version,
  ).toBe(3);
});
it("rejects missing paths, incompatible rollback, caught capability failures and invalid final data without changing the source", async () => {
  const source = request(),
    before = structuredClone(source);
  await expect(migrateLocalSnapshot(module, source, 1)).rejects.toMatchObject({
    code: "LOCAL_MIGRATION_MISSING",
  });
  await expect(migrateLocalSnapshot(module, source, 4)).rejects.toMatchObject({
    code: "LOCAL_SCHEMA_INCOMPATIBLE",
  });
  const caught = defineLocalModule(module)(
    {},
    {
      rename: async (ctx) => {
        try {
          await ctx.resource("another-module").scan();
        } catch {}
        await rename(ctx);
      },
      normalize,
    },
  );
  await expect(
    migrateLocalSnapshot(module, source, 1, caught),
  ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
  await expect(
    migrateLocalSnapshot(
      module,
      source,
      1,
      defineLocalModule(module)({}, { rename, normalize: async () => {} }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    migrateLocalSnapshot(
      module,
      source,
      1,
      defineLocalModule(module)(
        {},
        {
          rename: async (ctx) => {
            await rename(ctx);
            throw Error("Migration failure");
          },
          normalize,
        },
      ),
    ),
  ).rejects.toThrow("Migration failure");
  expect(source).toEqual(before);
});
it("drains detached writes, closes capabilities and refuses malformed migration contracts", async () => {
  let retained: LocalMigrationContext | undefined;
  const implementation = defineLocalModule(module)(
    {},
    {
      rename,
      normalize: async (ctx) => {
        retained = ctx;
        const row = (await ctx.resource("notes").scan()).items[0];
        void ctx
          .resource("notes")
          .write(row.id, { ...row.data, normalized: true }, row.version);
      },
    },
  );
  const result = await migrateLocalSnapshot(
    module,
    request(),
    1,
    implementation,
  );
  expect(result.snapshot.records.notes[0].data.normalized).toBe(true);
  await expect(
    retained!.resource("notes").write("one", {}, 4),
  ).rejects.toMatchObject({ code: "LOCAL_TRANSACTION_CLOSED" });
  expect(() =>
    defineModule({
      ...module,
      localStorage: {
        ...module.localStorage,
        migrations: { invalid: { from: 1, to: 3 } },
      },
    }),
  ).toThrow(/migration/);
});
function compileTime() {
  defineLocalModule(module)(
    {},
    {
      rename: async (ctx) => {
        // @ts-expect-error Migration configuration is inferred from the module schema.
        ctx.configuration.missing;
        // @ts-expect-error Rename targets must be declared standalone resources.
        await ctx.renameResource("oldNotes", "foreign");
        const row = (await ctx.resource("oldNotes").scan()).items[0];
        // @ts-expect-error Historical fields require source validation before use.
        row.data.text.toUpperCase();
      },
      normalize,
    },
  );
  // @ts-expect-error Every declared local migration requires a handler.
  defineLocalModule(module)({});
  // @ts-expect-error Migration names are inferred from localStorage.
  defineLocalModule(module)({}, { rename, typo: normalize });
}
void compileTime;

it("visits every migration record once across pages with mixed-case identifiers", async () => {
  const source = request();
  const ids = Array.from(
    { length: 160 },
    (_, i) => `${i % 2 ? "A" : "a"}-${String(i).padStart(3, "0")}`,
  );
  source.snapshot.records = {
    notes: ids.map((id) => ({
      id,
      version: 1,
      archived: false,
      updatedAt: "2026-01-01",
      data: { body: id, normalized: false },
    })),
  };
  const visited: string[] = [];
  const implementation = defineLocalModule(module)(
    {},
    {
      rename,
      normalize: async (ctx) => {
        let after: string | undefined;
        do {
          const page = await ctx.resource("notes").scan(after);
          for (const row of page.items) {
            visited.push(row.id);
            await ctx
              .resource("notes")
              .write(row.id, { ...row.data, normalized: true }, row.version);
          }
          after = page.nextCursor ?? undefined;
        } while (after);
      },
    },
  );
  const result = await migrateLocalSnapshot(module, source, 2, implementation);
  expect(visited).toEqual([...ids].sort());
  expect(
    result.snapshot.records.notes.every((row) => row.data.normalized),
  ).toBe(true);
});

it("can create derived records and archive them without deleting retained data", async () => {
  const implementation = defineLocalModule(module)(
    {},
    {
      rename,
      normalize: async (ctx) => {
        await normalize(ctx);
        const created = await ctx
          .resource("notes")
          .create({ body: "Derived", normalized: true }, "derived");
        await ctx.resource("notes").archive(created.id, created.version);
      },
    },
  );
  const result = await migrateLocalSnapshot(
    module,
    request(),
    1,
    implementation,
  );
  expect(result.snapshot.records.notes).toHaveLength(2);
  expect(
    result.snapshot.records.notes.find((row) => row.id === "derived"),
  ).toMatchObject({
    archived: true,
    version: 2,
    data: { body: "Derived", normalized: true },
  });
});
