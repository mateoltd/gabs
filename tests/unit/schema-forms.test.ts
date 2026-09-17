import { expect, it } from "vitest";
import { Type } from "@suite/module-sdk";
import {
  createSchemaDraft,
  parseSchemaInput,
  type SchemaDraft,
} from "@suite/module-sdk/forms";
import { TypedSchemaForm } from "@suite/ui-web";
import module from "../fixtures/schema-editor/module";

it("derives isolated drafts without inventing quantities, dates or references and validates complete data", () => {
  const schema = Type.Object({
    count: Type.Number(),
    day: Type.String(),
    linked: Type.String(),
    settings: Type.Object({
      enabled: Type.Boolean(),
      kind: Type.Literal("office"),
    }),
    tags: Type.Array(Type.String(), { default: ["priority"] }),
    optional: Type.Optional(Type.String()),
  });
  const value = createSchemaDraft(schema);
  expect(value).toEqual({
    settings: { enabled: false, kind: "office" },
    tags: ["priority"],
  });
  value.tags!.push("changed");
  expect(createSchemaDraft(schema).tags).toEqual(["priority"]);
  const invalid = parseSchemaInput(schema, value);
  expect(invalid.ok).toBe(false);
  if (!invalid.ok)
    expect(invalid.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["/count", "/day", "/linked"]),
    );
  const valid = parseSchemaInput(schema, {
    ...value,
    count: 4,
    day: "2026-09-17",
    linked: "record",
  });
  expect(valid.ok).toBe(true);
  if (valid.ok) {
    valid.value.settings.enabled = true;
    expect(value.settings?.enabled).toBe(false);
  }
  expect(() =>
    createSchemaDraft(Type.Integer({ minimum: 1, default: -1 })),
  ).toThrow();
});
it("validates transported nested schemas and preserves nullable and falsy literals", () => {
  const schema = Type.Object({
    "a/b~c": Type.Object({ count: Type.Integer({ minimum: 1 }) }),
    choice: Type.Union([
      Type.Literal(false),
      Type.Literal(0),
      Type.Literal(""),
    ]),
    amount: Type.Union([Type.Number(), Type.Null()]),
  });
  for (const choice of [false, 0, ""])
    expect(
      parseSchemaInput(JSON.parse(JSON.stringify(schema)), {
        "a/b~c": { count: 1 },
        choice,
        amount: null,
      }).ok,
    ).toBe(true);
  const result = parseSchemaInput(schema, {
    "a/b~c": { count: -1 },
    choice: false,
    amount: undefined,
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.issues.map((issue) => issue.path)).toContain(
      "/a~1b~0c/count",
    );
  const data = JSON.parse('{"__proto__":{"type":"string","default":"safe"}}');
  const drafted = createSchemaDraft(Type.Object(data));
  expect(Object.hasOwn(drafted, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(drafted)).toBe(Object.prototype);
});
it("infers nested form drafts and rejects duplicate or invalid application-facing fields", () => {
  const schema = module.resources.records.schema;
  const valid: SchemaDraft<{ count: number; names: string[] }> = {
    names: [undefined, "Draft"],
  };
  expect(valid.names).toEqual([undefined, "Draft"]);
  if (false) {
    // @ts-expect-error Draft tuples preserve the type of each position.
    const tuple: SchemaDraft<[string, number]> = [3, "wrong"];
    void tuple;
    TypedSchemaForm({
      schema,
      value: { candidate: "Example", lines: [{ quantity: 2 }] },
      onChange: () => {},
    });
    TypedSchemaForm({
      schema,
      // @ts-expect-error Numeric nested fields remain numeric in drafts.
      value: { lines: [{ quantity: "two" }] },
      onChange: () => {},
    });
    // @ts-expect-error Unknown fields cannot silently widen the schema.
    TypedSchemaForm({ schema, value: { invented: true }, onChange: () => {} });
    TypedSchemaForm({
      schema,
      value: {},
      // @ts-expect-error Field ordering uses the schema's actual keys.
      fieldOrder: ["invented"],
      onChange: () => {},
    });
  }
  const result = parseSchemaInput(schema, {});
  if (result.ok) {
    const quantity: number = result.value.lines[0].quantity;
    // @ts-expect-error Validated DTOs retain the declared numeric type.
    const text: string = quantity;
    void text;
  }
});

it("creates tuple and map drafts and resolves object entry contracts without inherited properties", async () => {
  const { objectPropertySchema } = await import("@suite/module-sdk/forms");
  const tuple = Type.Tuple([
    Type.String(),
    Type.Boolean(),
    Type.Literal("fixed"),
    Type.Integer({ default: 4 }),
  ]);
  expect(createSchemaDraft(tuple)).toEqual([undefined, false, "fixed", 4]);
  expect(createSchemaDraft(Type.Tuple([]))).toEqual([]);
  expect(createSchemaDraft(Type.Record(Type.String(), Type.Number()))).toEqual(
    {},
  );
  const schema = Type.Object(
    { fixed: Type.String() },
    {
      patternProperties: {
        "^a": Type.Number(),
        ".z$": Type.Integer({ minimum: 1 }),
      },
      additionalProperties: false,
    },
  );
  expect(objectPropertySchema(schema, "constructor")).toBeUndefined();
  expect(parseSchemaInput(objectPropertySchema(schema, "az")!, 2).ok).toBe(
    true,
  );
  expect(
    parseSchemaInput(
      objectPropertySchema(JSON.parse(JSON.stringify(schema)), "az")!,
      2.5,
    ).ok,
  ).toBe(false);
  expect(
    parseSchemaInput(objectPropertySchema(schema, "fixed")!, "kept").ok,
  ).toBe(true);
  const extended = Type.Object(
    { fixed: Type.String() },
    { additionalProperties: Type.Integer() },
  );
  expect(
    parseSchemaInput(objectPropertySchema(extended, "__proto__")!, 7).ok,
  ).toBe(true);
});
