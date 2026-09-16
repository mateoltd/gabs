import { defineModule, operation, store, Type } from "@suite/module-sdk";
export const id = Type.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
const quantity = Type.Integer({ minimum: 0, maximum: 1000000000 });
const version = Type.Integer({ minimum: 1 });
const text = (max: number) => Type.String({ minLength: 1, maxLength: max });
export const product = Type.Object({
  id,
  sku: text(80),
  name: text(200),
  priceMinor: Type.Integer({ minimum: 0, maximum: 100000000 }),
  active: Type.Boolean(),
  version,
  stockVersion: version,
  onHand: Type.Optional(quantity),
  reserved: Type.Optional(quantity),
  available: quantity,
});
export const productInput = Type.Object(
  {
    sku: text(80),
    name: text(200),
    priceMinor: Type.Integer({ minimum: 0, maximum: 100000000 }),
  },
  { additionalProperties: false },
);
const line = Type.Object(
  { productId: id, quantity: Type.Integer({ minimum: 1, maximum: 1000000 }) },
  { additionalProperties: false },
);
export const error = Type.Object(
  {
    code: Type.Union(
      (
        [
          "NOT_FOUND",
          "FORBIDDEN",
          "INVALID_INPUT",
          "INSUFFICIENT_STOCK",
          "PRODUCT_INACTIVE",
          "VERSION_CONFLICT",
          "RESERVED_STOCK",
          "RESERVATION_CONFLICT",
        ] as const
      ).map((value) => Type.Literal(value)),
    ),
    message: Type.String(),
  },
  { additionalProperties: false },
);
const movement = store({
  productId: id,
  sku: text(80),
  kind: Type.Union(
    (
      [
        "receipt",
        "adjustment",
        "reservation",
        "release",
        "fulfillment",
      ] as const
    ).map((value) => Type.Literal(value)),
  ),
  onHandDelta: Type.Integer(),
  reservedDelta: Type.Integer(),
  reason: text(520),
  actorId: id,
  createdAt: Type.String(),
  orderId: Type.Optional(id),
});
export default defineModule({
  id: "inventory",
  name: "Inventory",
  version: "2.0.0",
  description: "Products, stock and movement history.",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: {},
  legacyView: true,
  permissions: [
    "inventory.read",
    "inventory.availability.read",
    "inventory.products.manage",
    "inventory.receive",
    "inventory.adjust",
    "inventory.reservations.write",
  ],
  resources: {},
  configuration: Type.Object({}, { additionalProperties: false }),
  navigation: { path: "/inventory", permission: "inventory.read" },
  storage: {
    version: 2,
    compatible: { minimum: 2, maximum: 2 },
    migrations: { "import-v1": { from: 1, to: 2 } },
  },
  stores: {
    products: store(
      {
        ...productInput.properties,
        active: Type.Boolean(),
        productVersion: version,
        stockVersion: version,
        onHand: quantity,
        reserved: quantity,
        available: quantity,
        lowStock: Type.Boolean(),
      },
      { unique: ["sku"] },
    ),
    movements: movement,
    counts: store({
      productId: id,
      expectedVersion: version,
      previousOnHand: quantity,
      countedOnHand: quantity,
      reason: text(500),
      actorId: id,
      createdAt: Type.String(),
    }),
    reservations: store({
      sourceModule: Type.String(),
      state: Type.Union(
        (["reserved", "released", "consumed"] as const).map((value) =>
          Type.Literal(value),
        ),
      ),
      lines: Type.Array(line, { minItems: 1, maxItems: 100 }),
    }),
  },
  audit: [
    "product.created",
    "product.updated",
    "receipt",
    "adjustment",
    "counted",
    "reserved",
    "released",
    "consumed",
  ],
  events: {
    changed: Type.Object({ recordId: id }),
    counted: Type.Object({
      recordId: id,
      countId: id,
      variance: Type.Integer(),
    }),
  },
  operations: {
    "create-product": operation({
      title: "Create product",
      policy: "online",
      permission: "inventory.products.manage",
      input: productInput,
      output: product,
      errors: error,
    }),
    "edit-product": operation({
      title: "Edit product",
      policy: "online",
      permission: "inventory.products.manage",
      input: Type.Object(
        { ...productInput.properties, id, version, active: Type.Boolean() },
        { additionalProperties: false },
      ),
      output: product,
      errors: error,
    }),
    get: operation({
      kind: "query",
      title: "Product",
      policy: "online",
      permission: "inventory.availability.read",
      input: Type.Object({ id }),
      output: product,
      errors: error,
    }),
    products: operation({
      kind: "query",
      title: "Products",
      policy: "online",
      permission: "inventory.availability.read",
      input: Type.Object(
        {
          cursor: Type.Optional(Type.String({ maxLength: 24576 })),
          search: Type.Optional(Type.String({ maxLength: 200 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          stock: Type.Optional(Type.Literal("low")),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({
        items: Type.Array(product),
        nextCursor: Type.Union([Type.String(), Type.Null()]),
      }),
      errors: error,
    }),
    overview: operation({
      kind: "query",
      title: "Stock summary",
      policy: "online",
      permission: "inventory.availability.read",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Object({
        products: Type.Integer(),
        available: Type.Number(),
        lowStock: Type.Integer(),
        lowStockItems: Type.Array(
          Type.Object({
            id,
            name: Type.String(),
            sku: Type.String(),
            available: Type.Integer(),
          }),
        ),
      }),
      errors: error,
    }),
    movements: operation({
      kind: "query",
      title: "Movement history",
      policy: "online",
      permission: "inventory.read",
      input: Type.Object(
        {
          cursor: Type.Optional(Type.String({ maxLength: 24576 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          productId: Type.Optional(id),
          search: Type.Optional(Type.String({ maxLength: 200 })),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({
        items: Type.Array(Type.Object({ id, ...movement.schema.properties })),
        nextCursor: Type.Union([Type.String(), Type.Null()]),
      }),
      errors: error,
    }),
    receipt: operation({
      title: "Receive stock",
      policy: "online",
      permission: "inventory.receive",
      input: Type.Object(
        {
          id,
          quantity: Type.Integer({ minimum: 1, maximum: 1000000000 }),
          reason: text(500),
        },
        { additionalProperties: false },
      ),
      output: product,
      errors: error,
    }),
    adjustment: operation({
      title: "Adjust stock",
      policy: "online",
      permission: "inventory.adjust",
      input: Type.Object(
        {
          id,
          quantity: Type.Integer({ minimum: -1000000000, maximum: 1000000000 }),
          reason: text(500),
        },
        { additionalProperties: false },
      ),
      output: product,
      errors: error,
    }),
    count: operation({
      title: "Record stock count",
      policy: "online",
      permission: "inventory.adjust",
      input: Type.Object(
        { id, stockVersion: version, counted: quantity, reason: text(500) },
        { additionalProperties: false },
      ),
      output: product,
      errors: error,
    }),
    "resolve-products": operation({
      title: "Resolve product snapshots",
      policy: "online",
      permission: "inventory.availability.read",
      public: true,
      serviceOnly: true,
      input: Type.Object(
        {
          ids: Type.Array(id, {
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      output: Type.Array(
        Type.Object({ id, sku: Type.String(), name: Type.String() }),
      ),
      errors: error,
    }),
    reserve: operation({
      title: "Reserve stock",
      policy: "online",
      permission: "inventory.reservations.write",
      public: true,
      serviceOnly: true,
      input: Type.Object(
        {
          referenceId: id,
          lines: Type.Array(line, { minItems: 1, maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({ state: Type.Literal("reserved") }),
      errors: error,
    }),
    release: operation({
      title: "Release reservation",
      policy: "online",
      permission: "inventory.reservations.write",
      public: true,
      serviceOnly: true,
      input: Type.Object({ referenceId: id }, { additionalProperties: false }),
      output: Type.Object({ state: Type.Literal("released") }),
      errors: error,
    }),
    consume: operation({
      title: "Consume reservation",
      policy: "online",
      permission: "inventory.reservations.write",
      public: true,
      serviceOnly: true,
      input: Type.Object({ referenceId: id }, { additionalProperties: false }),
      output: Type.Object({ state: Type.Literal("consumed") }),
      errors: error,
    }),
  },
});
