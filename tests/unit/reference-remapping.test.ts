import { expect, it } from "vitest";
import { Type, field } from "@suite/module-sdk";
import { remapResourceReferences } from "@suite/module-sdk/references";
const oldId = "00000000-0000-4000-8000-000000000001",
  nextId = "00000000-0000-4000-8000-000000000002";
const from = { moduleId: "contacts", resource: "contacts", id: oldId };
it("remaps declared nested resource links without changing text, other targets, member links or original input", () => {
  const ref = () => field.reference("contacts", "contacts");
  const schema = Type.Object({
    links: Type.Array(Type.Object({ contact: ref() })),
    pair: Type.Tuple([ref(), Type.String()]),
    map: Type.Record(Type.String(), ref()),
    choice: Type.Union([
      Type.Object({ kind: Type.Literal("linked"), target: ref() }),
      Type.Object({ kind: Type.Literal("text"), target: Type.String() }),
    ]),
    other: field.reference("projects", "projects"),
    member: Type.String({ "x-membership": true }),
    text: Type.String(),
  });
  const data = {
    links: [{ contact: oldId.toUpperCase() }],
    pair: [oldId, oldId],
    map: JSON.parse(`{"a/b~c":"${oldId}","__proto__":"${oldId}"}`),
    choice: { kind: "linked", target: oldId },
    other: oldId,
    member: oldId,
    text: oldId,
  };
  const before = structuredClone(data);
  const result = remapResourceReferences(schema, data, from, nextId);
  expect(result).toEqual({
    ...data,
    links: [{ contact: nextId }],
    pair: [nextId, oldId],
    map: JSON.parse(`{"a/b~c":"${nextId}","__proto__":"${nextId}"}`),
    choice: { kind: "linked", target: nextId },
  });
  expect(data).toEqual(before);
  expect(Object.getPrototypeOf(result.map)).toBe(Object.prototype);
  expect(Object.prototype).not.toHaveProperty("contact");
  expect(
    remapResourceReferences(
      schema,
      { ...data, choice: { kind: "text", target: oldId } },
      from,
      nextId,
    ).choice.target,
  ).toBe(oldId);
});
it("rejects ambiguous targets and schema-invalid remaps without mutating input", () => {
  const ambiguous = Type.Union([
    field.reference("contacts", "contacts"),
    field.reference("projects", "projects"),
  ]);
  expect(() => remapResourceReferences(ambiguous, oldId, from, nextId)).toThrow(
    "multiple targets",
  );
  const constrained = Type.Object({
    contact: Type.Intersect([
      field.reference("contacts", "contacts"),
      Type.Literal(oldId),
    ]),
  });
  const data = { contact: oldId };
  expect(() =>
    remapResourceReferences(constrained, data, from, nextId),
  ).toThrow();
  expect(data).toEqual({ contact: oldId });
  expect(() =>
    remapResourceReferences(
      field.reference("contacts", "contacts"),
      oldId,
      from,
      "invalid",
    ),
  ).toThrow();
});
