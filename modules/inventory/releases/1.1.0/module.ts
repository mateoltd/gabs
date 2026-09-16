import { defineModule, operation, Type } from "@suite/module-sdk";
const empty = Type.Object({}, { additionalProperties: false });
const product = Type.Object({
  id: Type.String(),
  sku: Type.String(),
  name: Type.String(),
  priceMinor: Type.Integer(),
  available: Type.Integer(),
  version: Type.Integer(),
  active: Type.Boolean(),
});
export default defineModule({
  id: "inventory",
  name: "Inventory",
  version: "1.1.0",
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
  ],
  resources: {},
  configuration: empty,
  navigation: { path: "/inventory", permission: "inventory.read" },
  operations: {
    products: operation({
      title: "Products",
      policy: "online",
      permission: "inventory.read",
      legacyOperation: "products",
      input: empty,
      output: Type.Object({
        items: Type.Array(product),
        nextCursor: Type.Union([Type.String(), Type.Null()]),
      }),
    }),
    "create-product": operation({
      title: "Create product",
      policy: "online",
      permission: "inventory.products.manage",
      legacyOperation: "productCreate",
      input: Type.Object(
        {
          sku: Type.String({ minLength: 1, maxLength: 80 }),
          name: Type.String({ minLength: 1, maxLength: 200 }),
          priceMinor: Type.Integer({ minimum: 0, maximum: 100000000 }),
        },
        { additionalProperties: false },
      ),
      output: product,
    }),
    stock: operation({
      title: "Change stock",
      policy: "online",
      permission: "inventory.read",
      legacyOperation: "stockChange",
      input: Type.Object(
        {
          id: Type.String({ pattern: "^[a-fA-F0-9-]{36}$" }),
          kind: Type.Union([
            Type.Literal("receipt"),
            Type.Literal("adjustment"),
          ]),
          quantity: Type.Integer({ minimum: -1000000000, maximum: 1000000000 }),
          reason: Type.String({ minLength: 1, maxLength: 500 }),
        },
        { additionalProperties: false },
      ),
      output: product,
    }),
  },
});
