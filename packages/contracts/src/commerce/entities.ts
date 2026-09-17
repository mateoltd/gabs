import { Type, type Static } from "@sinclair/typebox";

const Id = Type.String({ format: "uuid" });
const Text = (max = 200) => Type.String({ minLength: 1, maxLength: max });

export const ProductSchema = Type.Object({
  id: Id,
  sku: Text(80),
  name: Text(),
  priceMinor: Type.Integer(),
  stockVersion: Type.Optional(Type.Integer()),
  onHand: Type.Optional(Type.Integer()),
  reserved: Type.Optional(Type.Integer()),
  available: Type.Integer(),
  version: Type.Integer(),
  active: Type.Boolean(),
});
export type Product = Static<typeof ProductSchema>;

export const OrderLineInput = Type.Object(
  {
    productId: Id,
    quantity: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    priceMinor: Type.Integer({ minimum: 0, maximum: 100_000_000 }),
  },
  { additionalProperties: false },
);
const DraftOrderLineInput = Type.Object(
  {
    productId: Type.String({
      pattern:
        "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
    }),
    quantity: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    priceMinor: Type.Integer({ minimum: 0, maximum: 100_000_000 }),
  },
  { additionalProperties: false },
);
export const DraftInput = Type.Object(
  {
    customerName: Type.String({ minLength: 1, maxLength: 200 }),
    lines: Type.Array(DraftOrderLineInput, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);
export type DraftInput = Static<typeof DraftInput>;

export const OrderLineSchema = Type.Object(
  {
    ...OrderLineInput.properties,
    sku: Type.String(),
    name: Type.String(),
  },
  { additionalProperties: false },
);
export const OrderSchema = Type.Object({
  id: Id,
  number: Type.Integer(),
  customerName: Type.String(),
  status: Type.Union(
    ["draft", "confirmed", "fulfilled", "cancelled"].map((value) =>
      Type.Literal(value),
    ),
  ),
  version: Type.Integer(),
  totalMinor: Type.Number(),
  createdAt: Type.String(),
  lines: Type.Optional(Type.Array(OrderLineSchema)),
  activity: Type.Optional(
    Type.Array(
      Type.Object({
        action: Type.String(),
        createdAt: Type.String(),
      }),
    ),
  ),
});
export type Order = Static<typeof OrderSchema>;

export const MovementSchema = Type.Object({
  id: Id,
  productId: Id,
  sku: Type.String(),
  kind: Type.String(),
  onHandDelta: Type.Integer(),
  reservedDelta: Type.Integer(),
  reason: Type.String(),
  createdAt: Type.String(),
});
