import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  Type,
  field,
  resource,
  defineModule,
  createModuleClient,
  type ResourceRecord,
  type Static,
} from "@suite/module-sdk";
import {
  listResourceRecords,
  validateResourceList,
  resourceRangeKind,
  compareResourceScalars,
} from "@suite/module-sdk/queries";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import { executeLocalCall } from "@suite/module-sdk/local";
import { TypedResourceRanges } from "@suite/ui-web";
import contacts from "../modules/contacts/module";
const module = defineModule({
  ...contacts,
  permissions: [
    ...contacts.permissions,
    "contacts.records.read",
    "contacts.records.write",
  ],
  resources: {
    records: resource(
      {
        name: Type.String(),
        amount: Type.Optional(
          Type.Union([Type.Number({ minimum: -10 }), Type.Null()]),
        ),
        date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        approved: Type.Boolean(),
        tags: Type.Array(Type.String()),
        mixed: Type.Union([Type.String(), Type.Number()]),
      },
      { title: "Range records", standalone: true },
    ),
  },
});
const schema = module.resources.records.schema;
const rows: ResourceRecord<Static<typeof schema>>[] = [
  undefined,
  null,
  -1,
  0,
  0.5,
  2,
].map((amount, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  version: 1,
  archived: false,
  updatedAt: "2026-09-17T00:00:00Z",
  data: {
    name: ["", "A", "Z", "é", "\uE000", "😀"][i],
    ...(amount !== undefined ? { amount } : {}),
    date: `2026-09-${String(10 + i).padStart(2, "0")}`,
    approved: true,
    tags: [],
    mixed: "a",
  },
}));
it("compares numeric/date/text bounds consistently without treating null or missing as zero", () => {
  expect(
    listResourceRecords(schema, rows, { ranges: { amount: { gte: 0, lt: 2 } } })
      .items,
  ).toEqual(rows.slice(3, 5));
  expect(
    listResourceRecords(schema, rows, {
      ranges: { amount: { gte: 0, lte: 0 } },
    }).items,
  ).toEqual([rows[3]]);
  expect(
    listResourceRecords(schema, rows, {
      ranges: { date: { gt: "2026-09-11", lte: "2026-09-13" } },
      where: { approved: true },
    }).items,
  ).toEqual(rows.slice(2, 4));
  expect(
    listResourceRecords(schema, rows, {
      ranges: { name: { gte: "", lt: "A" } },
    }).items,
  ).toEqual([rows[0]]);
  expect(
    resourceRangeKind(Type.Union([Type.Integer(), Type.Number(), Type.Null()])),
  ).toBe("number");
  expect(compareResourceScalars("😀", "\uE000")).toBe(1);
  expect(
    listResourceRecords(schema, rows, { ranges: { name: { gt: "\uE000" } } })
      .items,
  ).toEqual([rows[5]]);
  const input = { ranges: { amount: { gte: -1 } }, limit: 2 };
  const first = listResourceRecords(schema, rows, input);
  expect(first.items).toEqual(rows.slice(2, 4));
  expect(
    listResourceRecords(schema, rows, { ...input, cursor: first.nextCursor! })
      .items,
  ).toEqual(rows.slice(4));
});
it("rejects unsafe, malformed or contradictory ranges on authored and transported schemas", () => {
  for (const contract of [schema, JSON.parse(JSON.stringify(schema))]) {
    for (const ranges of [
      { unknown: { gte: 1 } },
      { approved: { gte: true } },
      { tags: { gte: "a" } },
      { mixed: { gte: 1 } },
      { amount: {} },
      { amount: { gte: null } },
      { amount: { gte: "0" } },
      { amount: { gte: -11 } },
      { amount: { gte: 0, gt: 1 } },
      { amount: { lt: 2, lte: 3 } },
      { amount: { gte: 2, lte: 1 } },
      { amount: { gt: 0, lte: 0 } },
      { date: { gte: "tomorrow" } },
      { name: { ilike: "%" } },
      { amount: { gte: NaN } },
      JSON.parse('{"__proto__":{"gte":1}}'),
    ])
      expect(() => validateResourceList(contract, { ranges })).toThrow();
    expect(() =>
      validateResourceList(contract, { ranges: { amount: { gte: 0 } } }),
    ).not.toThrow();
  }
  const annotated = Type.Object({
    contact: Type.Union([field.reference("contacts", "contacts"), Type.Null()]),
    member: Type.Optional(Type.Union([field.member(), Type.Null()])),
  });
  expect(
    renderToStaticMarkup(
      createElement(TypedResourceRanges, {
        schema: annotated,
        value: {},
        onChange: () => {},
      }),
    ),
  ).toBe("");
  const many = Type.Object(
    Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`v${i}`, Type.Number()]),
    ),
  );
  expect(() =>
    validateResourceList(many, {
      ranges: Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [`v${i}`, { gte: 0 }]),
      ),
    }),
  ).toThrow();
});
it("derives range types and shares runtime validation across simulator and local workers", async () => {
  const sim = createModuleSimulator(module, {
    fixtures: { records: rows.map((row) => row.data) },
  });
  const client = createModuleClient(module, sim.send);
  const input = {
    ranges: { amount: { gte: 0, lt: 2 } },
    where: { approved: true },
  };
  expect(
    (await client.resource("records").list(input)).items
      .map((row) => row.data)
      .sort((a, b) => a.amount! - b.amount!),
  ).toEqual(rows.slice(3, 5).map((row) => row.data));
  const result = await executeLocalCall(module, {
    profileId: "ranges",
    configuration: {},
    snapshot: { records: { records: rows }, receipts: {} },
    call: {
      moduleId: module.id,
      moduleVersion: module.version,
      resource: "records",
      action: "list",
      input,
    },
  });
  expect(result.result).toEqual({ items: rows.slice(3, 5), nextCursor: null });
  if (false) {
    // @ts-expect-error A numeric field cannot compare a string bound.
    void client.resource("records").list({ ranges: { amount: { gte: "0" } } });
    void client
      .resource("records")
      // @ts-expect-error Boolean fields have equality, not ordered ranges.
      .list({ ranges: { approved: { gte: true } } });
    // @ts-expect-error Heterogeneous string/number unions are not orderable.
    void client.resource("records").list({ ranges: { mixed: { gte: 1 } } });
    // @ts-expect-error Unknown range fields cannot widen the contract.
    void client.resource("records").list({ ranges: { invented: { gte: 1 } } });
    TypedResourceRanges({
      schema,
      // @ts-expect-error The UI infers the same numeric boundary types.
      value: { amount: { gte: "0" } },
      onChange: () => {},
    });
  }
});
