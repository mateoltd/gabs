import { expect, it } from "vitest";
import {
  Type,
  defineModule,
  resource,
  createModuleClient,
  type ResourceRecord,
  type Static,
  type ResourceListOptions,
} from "@suite/module-sdk";
import {
  listResourceRecords,
  validateResourceList,
} from "@suite/module-sdk/queries";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import { executeLocalCall } from "@suite/module-sdk/local";
import { TypedResourceSort } from "@suite/ui-web";
const module = defineModule({
  id: "sort-proof",
  name: "Sort proof",
  description: "Sorting",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: ["sort-proof.records.read", "sort-proof.records.write"],
  operations: {},
  resources: {
    records: resource(
      {
        name: Type.String(),
        amount: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
        approved: Type.Boolean(),
        tags: Type.Array(Type.String()),
        mixed: Type.Union([Type.String(), Type.Number()]),
      },
      { title: "Records", standalone: true },
    ),
  },
  navigation: { path: "/sort-proof", permission: "sort-proof.records.read" },
});
const schema = module.resources.records.schema;
const rows: ResourceRecord<Static<typeof schema>>[] = [
  2,
  1,
  1,
  null,
  undefined,
  -1,
  0,
].map((amount, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  version: 1,
  archived: false,
  updatedAt: "now",
  data: {
    name: ["é", "😀", "\uE000", "A", "Z", "", "0"][i],
    ...(amount !== undefined ? { amount } : {}),
    approved: i % 2 === 0,
    tags: [],
    mixed: "a",
  },
}));
const numbers = (items: readonly ResourceRecord[]) =>
  items.map((row) => Number(row.id.slice(-2)));
it("orders scalars with nulls last and UUID tie-breaks, and keeps the boundary after anchor deletion", () => {
  const asc = {
    orderBy: [{ field: "amount", direction: "asc" }],
    limit: 2,
  } as const;
  expect(
    numbers(listResourceRecords(schema, rows, { ...asc, limit: 100 }).items),
  ).toEqual([6, 7, 2, 3, 1, 4, 5]);
  expect(
    numbers(
      listResourceRecords(schema, rows, {
        orderBy: [{ field: "amount", direction: "desc" }],
      }).items,
    ),
  ).toEqual([1, 2, 3, 7, 6, 4, 5]);
  expect(
    numbers(
      listResourceRecords(schema, rows, {
        orderBy: [
          { field: "approved", direction: "asc" },
          { field: "amount", direction: "desc" },
        ],
      }).items,
    ),
  ).toEqual([2, 6, 4, 1, 3, 7, 5]);
  expect(
    numbers(
      listResourceRecords(schema, rows, {
        orderBy: [{ field: "name", direction: "asc" }],
      }).items,
    ),
  ).toEqual([6, 7, 4, 5, 1, 3, 2]);
  const first = listResourceRecords(schema, rows, asc, "profile/module");
  expect(first.nextCursor).toMatch(/^lr1\./);
  const remaining = rows.filter((row) => row.id !== first.items.at(-1)!.id);
  const second = listResourceRecords(
    schema,
    remaining,
    { ...asc, cursor: first.nextCursor! },
    "profile/module",
  );
  expect(numbers(second.items)).toEqual([2, 3]);
  const third = listResourceRecords(
    schema,
    remaining,
    { ...asc, cursor: second.nextCursor! },
    "profile/module",
  );
  expect(numbers(third.items)).toEqual([1, 4]);
  expect(
    numbers(
      listResourceRecords(
        schema,
        remaining,
        { ...asc, cursor: third.nextCursor! },
        "profile/module",
      ).items,
    ),
  ).toEqual([5]);
  expect(listResourceRecords(schema, rows, { limit: 1 }).nextCursor).toBe(
    rows[0].id,
  );
});
it("rejects mismatched, malformed and oversized cursors and invalid sort contracts", () => {
  const input = {
    orderBy: [{ field: "name", direction: "asc" }],
    limit: 2,
  } as const;
  const cursor = listResourceRecords(schema, rows, input, "one").nextCursor!;
  for (const query of [
    { ...input, where: { approved: true } },
    { ...input, orderBy: [{ field: "name", direction: "desc" }] },
    { ...input, search: "a" },
    { ...input, archived: true },
    { ...input, ranges: { name: { gte: "A" } } },
  ])
    expect(() =>
      listResourceRecords(
        schema,
        rows,
        { ...query, cursor } as ResourceListOptions<Static<typeof schema>>,
        "one",
      ),
    ).toThrow();
  expect(() =>
    listResourceRecords(schema, rows, { ...input, cursor }, "two"),
  ).toThrow();
  for (const bad of [
    "not-a-cursor",
    rows[0].id,
    "lr1.e30",
    "lr1.bm90LWpzb24",
    "rq1.YWJj",
  ])
    expect(() =>
      listResourceRecords(schema, rows, { ...input, cursor: bad }, "one"),
    ).toThrow();
  expect(() => listResourceRecords(schema, rows, { cursor })).toThrow();
  for (const orderBy of [
    [{ field: "invented", direction: "asc" }],
    [{ field: "tags", direction: "asc" }],
    [{ field: "mixed", direction: "asc" }],
    [{ field: "amount", direction: "up" }],
    [
      { field: "name", direction: "asc" },
      { field: "name", direction: "desc" },
    ],
    Array.from({ length: 4 }, () => ({ field: "name", direction: "asc" })),
  ])
    expect(() => validateResourceList(schema, { orderBy })).toThrow();
  const large = rows
    .slice(0, 2)
    .map((row) => ({ ...row, data: { ...row.data, name: "é".repeat(10000) } }));
  expect(() =>
    listResourceRecords(schema, large, { ...input, limit: 1 }),
  ).toThrow(/too large/);
  for (const contract of [schema, JSON.parse(JSON.stringify(schema))])
    expect(() => validateResourceList(contract, input)).not.toThrow();
});
it("keeps typed clients and local/simulated sorted paging aligned", async () => {
  const input = {
    orderBy: [{ field: "amount", direction: "desc" }],
    limit: 2,
  } as const;
  const sim = createModuleSimulator(module, {
    fixtures: { records: rows.map((row) => row.data) },
  });
  const client = createModuleClient(module, sim.send);
  const first = await client.resource("records").list(input);
  expect(first.items.map((row) => row.data.amount)).toEqual([2, 1]);
  const second = await client
    .resource("records")
    .list({ ...input, cursor: first.nextCursor! });
  expect(second.items.map((row) => row.data.amount)).toEqual([1, 0]);
  const request = {
    profileId: "profile",
    configuration: {},
    snapshot: { records: { records: rows }, receipts: {} },
    call: {
      moduleId: module.id,
      moduleVersion: module.version,
      resource: "records",
      action: "list" as const,
      input,
    },
  };
  const local = await executeLocalCall(module, request);
  expect(numbers((local.result as { items: ResourceRecord[] }).items)).toEqual([
    1, 2,
  ]);
  const localCursor = (local.result as { nextCursor: string }).nextCursor;
  await expect(
    executeLocalCall(module, {
      ...request,
      profileId: "other",
      call: { ...request.call, input: { ...input, cursor: localCursor } },
    }),
  ).rejects.toThrow();
  if (false) {
    const list = client.resource("records").list;
    // @ts-expect-error Structured fields are not sortable.
    void list({ orderBy: [{ field: "tags", direction: "asc" }] });
    // @ts-expect-error Mixed scalar fields have no stable typed ordering.
    void list({ orderBy: [{ field: "mixed", direction: "asc" }] });
    // @ts-expect-error Unknown columns cannot widen inferred sort keys.
    void list({ orderBy: [{ field: "invented", direction: "asc" }] });
    // @ts-expect-error Only ascending and descending directions are accepted.
    void list({ orderBy: [{ field: "name", direction: "up" }] });
    TypedResourceSort({
      schema,
      value: [
        {
          // @ts-expect-error Sort UI cannot widen the inferred schema.
          field: "tags",
          direction: "asc",
        },
      ],
      onChange: () => {},
    });
  }
});
