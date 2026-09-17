import { Type, type TSchema } from "@sinclair/typebox";

const id = Type.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
const version = Type.Integer({ minimum: 1, maximum: 2147483646 });
const object = Type.Record(Type.String(), Type.Unknown());
export const storeCommandSchema = Type.Union([
  Type.Object(
    { action: Type.Literal("get"), id, lock: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("scan"),
      where: Type.Optional(object),
      after: Type.Optional(id),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("create"), id: Type.Optional(id), data: object },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("replace"), id, version, data: object },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("archive"), id, version },
    { additionalProperties: false },
  ),
]);

const name = Type.String({ minLength: 1, maxLength: 200 });
const number = Type.Number();
const comparable = Type.Union([Type.String(), number]);
const filters = {
  where: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  search: Type.Optional(
    Type.Object(
      {
        fields: Type.Array(name, {
          minItems: 1,
          maxItems: 8,
          uniqueItems: true,
        }),
        text: Type.String({ minLength: 1, maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
  ),
  ranges: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object(
        {
          gt: Type.Optional(comparable),
          gte: Type.Optional(comparable),
          lt: Type.Optional(comparable),
          lte: Type.Optional(comparable),
        },
        { additionalProperties: false },
      ),
    ),
  ),
};
export const storeQueryCommandSchema = Type.Union([
  Type.Object(
    {
      ...filters,
      action: Type.Literal("query"),
      orderBy: Type.Optional(
        Type.Array(
          Type.Object(
            {
              field: name,
              direction: Type.Union([
                Type.Literal("asc"),
                Type.Literal("desc"),
              ]),
            },
            { additionalProperties: false },
          ),
          { maxItems: 3 },
        ),
      ),
      cursor: Type.Optional(Type.String({ maxLength: 24576 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...filters,
      action: Type.Literal("aggregate"),
      sum: Type.Optional(Type.Array(name, { maxItems: 8, uniqueItems: true })),
      groupBy: Type.Optional(name),
      maxGroups: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    },
    { additionalProperties: false },
  ),
]);
export function storeFieldKind(schema: TSchema): string | undefined {
  if (["string", "number", "integer", "boolean"].includes(schema.type))
    return schema.type;
  if (Array.isArray(schema.anyOf)) {
    const types = new Set(
      schema.anyOf
        .filter((s: TSchema) => s.type !== "null")
        .map((s: TSchema) => storeFieldKind(s)),
    );
    if (types.size === 1) return [...types][0] as string | undefined;
  }
}
