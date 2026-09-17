import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  createModuleClient,
  defineModule,
  resource,
  Type,
  type ModuleCall,
  type ResourceRecord,
  type Static,
} from "@suite/module-sdk";
import {
  listResourceRecords,
  validateResourceList,
} from "../../packages/sdk/src/client/resource-query";
import { executeLocalCall } from "@suite/module-sdk/local";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import { TypedResourceFilters, TypedResourceTable } from "@suite/ui-web";
import contacts from "../../modules/contacts/module";
const module = defineModule({
  ...contacts,
  resources: {
    contacts: resource(
      {
        name: Type.String(),
        approved: Type.Boolean(),
        count: Type.Integer({ minimum: 0 }),
        optional: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        details: Type.Object(
          { city: Type.String(), number: Type.Integer() },
          { additionalProperties: false },
        ),
        tags: Type.Array(Type.String()),
      },
      { title: "Records", standalone: true },
    ),
  },
});
const schema = module.resources.contacts.schema;
const rows: ResourceRecord<Static<typeof schema>>[] = Array.from(
  { length: 6 },
  (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    data: {
      name: i === 0 ? "Literal 50%_value" : `Row ${i}`,
      approved: i % 2 === 0,
      count: i,
      ...(i === 1 ? { optional: null } : i === 2 ? { optional: "" } : {}),
      details: { city: "Madrid", number: 0 },
      tags: ["a", "b"],
    },
    version: 1,
    archived: i === 5,
    updatedAt: "2026-09-17T00:00:00Z",
  }),
);
it("compares full field values without conflating false, zero, null, missing, array order or object key order", () => {
  const run = (where: Record<string, unknown>) =>
    listResourceRecords(schema, rows, { where }).items.map((r) => r.id);
  expect(run({ approved: false, count: 1 })).toEqual([rows[1].id]);
  expect(run({ count: 0 })).toEqual([rows[0].id]);
  expect(run({ optional: null })).toEqual([rows[1].id]);
  expect(run({ optional: "" })).toEqual([rows[2].id]);
  expect(run({ details: { number: 0, city: "Madrid" } })).toHaveLength(5);
  expect(run({ tags: ["a"] })).toEqual([]);
  expect(run({ tags: ["b", "a"] })).toEqual([]);
  expect(listResourceRecords(schema, rows, { search: "%_" }).items).toEqual([
    rows[0],
  ]);
  expect(listResourceRecords(schema, rows, { archived: true }).items).toEqual([
    rows[5],
  ]);
  const page = listResourceRecords(schema, [...rows].reverse(), {
    where: { approved: true },
    limit: 2,
  });
  expect(page.items.map((r) => r.id)).toEqual([rows[0].id, rows[2].id]);
  expect(
    listResourceRecords(schema, rows, {
      where: { approved: true },
      limit: 2,
      cursor: page.nextCursor!,
    }).items,
  ).toEqual([rows[4]]);
  page.items[0].data.details.city = "Changed";
  expect(rows[0].data.details.city).toBe("Madrid");
});
it("rejects invalid filters and bounded list envelopes for authored and transported schemas", () => {
  for (const definition of [schema, JSON.parse(JSON.stringify(schema))]) {
    for (const input of [
      { where: { invented: true } },
      { where: { optional: undefined } },
      { where: { approved: "false" } },
      { where: { count: -1 } },
      { where: { details: { city: "Madrid" } } },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { cursor: "not-an-id" },
      { search: "x".repeat(101) },
      { archived: "false" },
      { extra: true },
      { where: JSON.parse('{"__proto__":1}') },
    ])
      expect(
        () => validateResourceList(definition, input),
        JSON.stringify(input),
      ).toThrow();
    expect(() =>
      validateResourceList(definition, {
        where: { optional: null, count: 0 },
        limit: 100,
      }),
    ).not.toThrow();
  }
});
it("uses the same filters in standalone execution, development simulation and typed clients", async () => {
  const call: ModuleCall = {
    moduleId: module.id,
    moduleVersion: module.version,
    resource: "contacts",
    action: "list",
    input: { where: { approved: false, count: 1 }, limit: 1 },
  };
  const local = await executeLocalCall(module, {
    profileId: "local",
    configuration: {},
    snapshot: { records: { contacts: rows }, receipts: {} },
    call,
  });
  expect(local.result).toEqual({ items: [rows[1]], nextCursor: null });
  const sim = createModuleSimulator(module, {
    fixtures: {
      contacts: rows.filter((row) => !row.archived).map((row) => row.data),
    },
  });
  const client = createModuleClient(module, sim.send);
  const result = await client
    .resource("contacts")
    .list({ where: { approved: false, count: 1 }, limit: 1 });
  expect(result.items.map((row) => row.data)).toEqual([rows[1].data]);
  if (false) {
    // @ts-expect-error Filter field names come from the resource schema.
    void client.resource("contacts").list({ where: { invented: true } });
    // @ts-expect-error Boolean filters cannot be stringified application DTOs.
    void client.resource("contacts").list({ where: { approved: "false" } });
    void client
      .resource("contacts")
      // @ts-expect-error Full nested field values remain typed.
      .list({ where: { details: { city: "Madrid" } } });
    TypedResourceTable({
      schema,
      rows,
      label: "Records",
      columns: ["name"],
      cells: { count: (value) => value.toFixed() },
    });
    TypedResourceTable({
      schema,
      rows,
      label: "Records",
      // @ts-expect-error Table columns cannot widen the schema.
      columns: ["invented"],
    });
    TypedResourceTable({
      schema,
      rows,
      label: "Records",
      // @ts-expect-error Custom cells receive their inferred value type.
      cells: { count: (value: string) => value },
    });
    TypedResourceFilters({
      schema,
      // @ts-expect-error Filters cannot widen the schema.
      value: { approved: "false" },
      onChange: () => {},
    });
  }
});

it("renders unusual schema keys as data, escapes text and respects intentionally empty custom cells", () => {
  const unusual = Type.Object(
    Object.fromEntries([
      ["constructor", Type.Optional(Type.String())],
      ["__proto__", Type.String()],
    ]),
  );
  const row = {
    id: "one",
    version: 1,
    archived: false,
    updatedAt: "now",
    data: Object.fromEntries([["__proto__", "<script>unsafe</script>"]]),
  };
  const html = renderToStaticMarkup(
    createElement(TypedResourceTable, {
      schema: unusual,
      rows: [row],
      label: "Unusual fields",
    }),
  );
  expect(html).toContain("Not set");
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  const hidden = renderToStaticMarkup(
    createElement(TypedResourceTable, {
      schema: unusual,
      rows: [row],
      label: "Unusual fields",
      cells: Object.fromEntries([["__proto__", () => null]]),
    }),
  );
  expect(hidden).not.toContain("unsafe");
});
