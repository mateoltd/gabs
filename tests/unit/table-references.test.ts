import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Type, field, type ResourceRecord } from "@suite/module-sdk";
import { TypedResourceTable } from "@suite/ui-web";
import { tableReferencePlan } from "../../packages/ui/web/src/tables/resource-references";
const id = "abcdef00-0000-4000-8000-000000000105";
const link = field.reference("contacts", "contacts");
const schema = Type.Object({
  pair: Type.Tuple([link, Type.Boolean({ title: "Approved" })]),
  map: Type.Record(Type.String(), Type.Object({ link, count: Type.Integer() })),
  choice: Type.Union([
    Type.Object({ kind: Type.Literal("linked"), link }),
    Type.Object({ kind: Type.Literal("plain"), text: Type.String() }),
  ]),
});
const row: ResourceRecord = {
  id: "row",
  version: 1,
  archived: false,
  updatedAt: "now",
  data: {
    pair: [id.toUpperCase(), false],
    map: { "a/b~c": { link: id, count: 0 } },
    choice: { kind: "plain", text: id },
  },
};
it("deduplicates visible nested references by target and UUID without interpreting inactive branches or invalid drafts", () => {
  const plan = tableReferencePlan(
    schema,
    [row, { ...row, id: "second" }],
    ["pair", "map", "choice"],
  );
  expect(plan.requests).toHaveLength(1);
  expect([...plan.rows.get("row")!.keys()]).toEqual([
    "/pair/0",
    "/map/a~1b~0c/link",
  ]);
  expect(tableReferencePlan(schema, [row], ["choice"]).requests).toEqual([]);
  expect(
    tableReferencePlan(
      schema,
      [{ ...row, data: { ...row.data, pair: ["invalid", false] } }],
      ["pair", "map"],
    ).requests,
  ).toEqual([]);
  const mixed = Type.Object({
    link: Type.Intersect([link, field.reference("projects", "projects")]),
  });
  const ambiguous = tableReferencePlan(
    mixed,
    [{ ...row, data: { link: id } }],
    ["link"],
  );
  expect(ambiguous.requests).toEqual([]);
  expect(ambiguous.rows.get("row")?.get("/link")).toBe("ambiguous");
});
it("renders tuple titles, escaped nested labels and falsy structured values without raw object coercion", () => {
  const html = renderToStaticMarkup(
    createElement(TypedResourceTable, {
      schema,
      rows: [row],
      label: "Structured values",
      references: {
        "/pair/0": [{ value: id, label: "Target 105" }],
        "/map/a~1b~0c/link": [{ value: id, label: "<Target 105>" }],
      },
    }),
  );
  expect(html).toContain("Approved");
  expect(html).toContain("Target 105");
  expect(html).toContain("&lt;Target 105&gt;");
  expect(html).toContain(">No<");
  expect(html).toContain(">0<");
  expect(html).toContain(id); // The unannotated plain branch remains literal text.
  expect(html).not.toContain("[object Object]");
});
