import { expect, it } from "vitest";
import { Type, field } from "@suite/module-sdk";
import {
  referenceFields,
  referenceValues,
  referenceTarget,
} from "@suite/module-sdk/references";
const id = "00000000-0000-4000-8000-000000000001";
const record = () => field.reference("contacts", "contacts");
const member = () => field.member();
const schema = Type.Object({
  "a/b~c": Type.Object({ contact: record() }),
  rows: Type.Array(
    Type.Object({
      owner: member(),
      linked: Type.Optional(Type.Union([record(), Type.Null()])),
    }),
  ),
  tuple: Type.Tuple([record(), member()]),
  lookup: Type.Record(Type.String(), record()),
  other: Type.Object({}, { additionalProperties: member() }),
  choice: Type.Union([
    Type.Object({ kind: Type.Literal("linked"), value: record() }),
    Type.Object({ kind: Type.Literal("text"), value: Type.String() }),
  ]),
  combined: Type.Intersect([
    Type.Object({ first: record() }),
    Type.Object({ second: member() }),
  ]),
});
const data = {
  "a/b~c": { contact: id },
  rows: [{ owner: id, linked: id }, { owner: id, linked: null }, { owner: id }],
  tuple: [id, id],
  lookup: { "a/b": id, constructor: id },
  other: { person: id },
  choice: { kind: "text", value: "A free-text note" },
  combined: { first: id, second: id },
};
it("discovers all declared reference locations and validates actual nested values after schema transport", () => {
  for (const contract of [schema, JSON.parse(JSON.stringify(schema))]) {
    const declarations = referenceFields(contract);
    expect(declarations).toHaveLength(10);
    expect(declarations.map((item) => item.schemaPath)).toContain(
      "/properties/a~1b~0c/properties/contact",
    );
    const values = referenceValues(contract, data);
    expect(values.map((item) => item.path)).toEqual([
      "/a~1b~0c/contact",
      "/rows/0/owner",
      "/rows/0/linked",
      "/rows/1/owner",
      "/rows/2/owner",
      "/tuple/0",
      "/tuple/1",
      "/lookup/a~1b",
      "/lookup/constructor",
      "/other/person",
      "/combined/first",
      "/combined/second",
    ]);
    expect(values.every((item) => item.value === id)).toBe(true);
    expect(values.filter((item) => item.target.kind === "member")).toHaveLength(
      6,
    );
    expect(
      referenceValues(contract, {
        ...data,
        choice: { kind: "linked", value: id },
      }).map((item) => item.path),
    ).toContain("/choice/value");
    expect(() =>
      referenceValues(contract, {
        ...data,
        rows: [{ owner: "foreign-invalid-id" }],
      }),
    ).toThrow();
  }
});
it("enforces every applicable reference annotation and rejects malformed declaration or identifier data", () => {
  const overlap = Type.Union([record(), Type.String()]);
  expect(referenceValues(overlap, "A note")).toEqual([]);
  expect(referenceValues(overlap, id)).toHaveLength(1);
  expect(() => referenceValues(record(), "-".repeat(36))).toThrow(/identifier/);
  for (const annotation of [
    null,
    [],
    { module: "contacts", resource: "contacts", extra: true },
    { module: "Bad module", resource: "contacts" },
    { module: "contacts" },
  ])
    expect(() =>
      referenceFields(Type.String({ "x-reference": annotation })),
    ).toThrow();
  expect(() => referenceTarget({ "x-membership": false })).toThrow();
  expect(() =>
    referenceTarget({
      "x-membership": true,
      "x-reference": { module: "contacts", resource: "contacts" },
    }),
  ).toThrow();
  // Unsupported transported schema vocabulary fails closed, including unresolved JSON references.
  expect(() => referenceFields(Type.Ref("missing"))).toThrow();
});
it("reads only own record properties, including names that collide with object prototypes", () => {
  const unusual = Type.Object(
    Object.fromEntries([
      ["__proto__", record()],
      ["constructor", Type.Optional(member())],
    ]),
  );
  const value = Object.fromEntries([["__proto__", id]]);
  expect(referenceValues(unusual, value).map((item) => item.path)).toEqual([
    "/__proto__",
  ]);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
});
