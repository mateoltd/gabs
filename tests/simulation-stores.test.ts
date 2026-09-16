import { expect, it } from "vitest";
import { Type, store } from "@suite/module-sdk";
import { createSimulationStores } from "../packages/module-sdk/src/simulation-stores";
import type { SimulationStoreRecord } from "../packages/module-sdk/src/simulation-fixtures";
import provider from "./fixtures/service-preview/provider/module";

const definition = {
  ...provider,
  stores: {
    items: store(
      {
        name: Type.String(),
        amount: Type.Integer(),
        tags: Type.Array(Type.String()),
        group: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      },
      { unique: ["name"] },
    ),
  },
};
const id = (number: number) =>
  `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
function setup() {
  const rows: SimulationStoreRecord[] = [
    {
      id: id(1),
      version: 1,
      archived: false,
      data: { name: "B 100%", amount: 2, tags: ["red", "blue"], group: "x" },
    },
    {
      id: id(2),
      version: 1,
      archived: false,
      data: { name: "A 100%", amount: 2, tags: ["red"], group: "x" },
    },
    {
      id: id(3),
      version: 1,
      archived: false,
      data: { name: "C", amount: 5, tags: [], group: null },
    },
    {
      id: id(4),
      version: 1,
      archived: true,
      data: { name: "Archived", amount: 900, tags: [] },
    },
  ];
  const audits: string[] = [];
  const execute = createSimulationStores(
    definition,
    () => ({ items: rows }),
    (action) => audits.push(action),
  );
  return {
    rows,
    audits,
    execute: (command: Parameters<typeof execute>[1]) =>
      execute("items", command, "test-request"),
  };
}
it("queries private fixtures with stable keysets, bound cursors, literal search, ranges and aggregates", async () => {
  const { execute, audits } = setup();
  const orderBy = [
    { field: "amount", direction: "desc" },
    { field: "name", direction: "asc" },
  ] as const;
  const first = (await execute({ action: "query", orderBy, limit: 1 })) as {
    items: { id: string }[];
    next: string;
  };
  expect(first.items.map((row) => row.id)).toEqual([id(3)]);
  const second = await execute({
    action: "query",
    orderBy,
    limit: 2,
    cursor: first.next,
  });
  expect(second).toMatchObject({
    items: [{ id: id(2) }, { id: id(1) }],
    next: null,
  });
  await expect(
    execute({ action: "query", cursor: first.next }),
  ).rejects.toMatchObject({ code: "INVALID_STORE_CURSOR" });
  await expect(
    setup().execute({ action: "query", orderBy, cursor: first.next }),
  ).rejects.toMatchObject({ code: "INVALID_STORE_CURSOR" });
  expect(
    await execute({
      action: "aggregate",
      where: { tags: ["red"] },
      search: { fields: ["name"], text: "100%" },
      ranges: { amount: { gte: 2, lt: 3 } },
      sum: ["amount"],
      groupBy: "group",
    }),
  ).toEqual({
    count: 2,
    sums: { amount: 4 },
    groups: [{ key: "x", count: 2, sums: { amount: 4 } }],
  });
  expect(
    await execute({ action: "aggregate", sum: ["amount"], groupBy: "group" }),
  ).toEqual({
    count: 3,
    sums: { amount: 9 },
    groups: [
      { key: "x", count: 2, sums: { amount: 4 } },
      { key: null, count: 1, sums: { amount: 5 } },
    ],
  });
  await expect(
    execute({ action: "aggregate", groupBy: "group", maxGroups: 1 }),
  ).rejects.toMatchObject({ code: "AGGREGATE_GROUP_LIMIT" });
  await expect(
    execute({
      action: "query",
      orderBy: [{ field: "tags", direction: "asc" }],
    }),
  ).rejects.toMatchObject({ code: "INVALID_STORE_QUERY" });
  await expect(
    execute({ action: "aggregate", sum: ["name"] }),
  ).rejects.toMatchObject({ code: "INVALID_STORE_QUERY" });
  await expect(
    execute({
      action: "query",
      orderBy: [
        { field: "name", direction: "asc" },
        { field: "name", direction: "desc" },
      ],
    }),
  ).rejects.toMatchObject({ code: "INVALID_STORE_QUERY" });
  expect(audits).toEqual([]);
});
it("enforces active uniqueness and versions, archives without deleting, and returns isolated data", async () => {
  const { execute, rows, audits } = setup();
  await expect(
    execute({ action: "create", data: { ...rows[0].data } }),
  ).rejects.toMatchObject({ code: "STORE_UNIQUE_CONFLICT" });
  await expect(
    execute({
      action: "replace",
      id: id(1),
      version: 2,
      data: { ...rows[0].data, amount: 4 },
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const read = (await execute({
    action: "get",
    id: id(1).toUpperCase(),
  })) as SimulationStoreRecord;
  read.data.amount = 500;
  expect(rows[0].data.amount).toBe(2);
  await execute({ action: "archive", id: id(1), version: 1 });
  expect(await execute({ action: "get", id: id(1) })).toBeNull();
  expect(rows[0]).toMatchObject({ archived: true, version: 2 });
  await execute({ action: "create", id: id(5), data: { ...rows[0].data } });
  expect(
    await execute({ action: "scan", where: { tags: ["blue"] }, limit: 1 }),
  ).toMatchObject({ items: [{ id: id(5) }], next: null });
  expect(audits).toEqual([
    "preview-provider.store.items.archive",
    "preview-provider.store.items.create",
  ]);
});
