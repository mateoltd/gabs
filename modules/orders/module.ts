import { defineModule, operation, Type } from "@suite/module-sdk";
const empty = Type.Object({}, { additionalProperties: false });
const draft = Type.Object(
  {
    customerName: Type.String({ minLength: 1, maxLength: 200 }),
    lines: Type.Array(
      Type.Object(
        {
          productId: Type.String(),
          quantity: Type.Integer({ minimum: 1, maximum: 1000000 }),
          priceMinor: Type.Integer({ minimum: 0, maximum: 100000000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);
const target = {
  id: Type.String({ pattern: "^[a-fA-F0-9-]{36}$" }),
  version: Type.Integer({ minimum: 1 }),
};
const order = Type.Object({
  id: Type.String(),
  number: Type.Integer(),
  customerName: Type.String(),
  status: Type.Union(
    (["draft", "confirmed", "fulfilled", "cancelled"] as const).map((v) =>
      Type.Literal(v),
    ),
  ),
  version: Type.Integer(),
  totalMinor: Type.Number(),
  createdAt: Type.String(),
  lines: Type.Array(
    Type.Object({
      productId: Type.String(),
      sku: Type.String(),
      name: Type.String(),
      quantity: Type.Integer(),
      priceMinor: Type.Integer(),
    }),
  ),
  activity: Type.Array(
    Type.Object({ action: Type.String(), createdAt: Type.String() }),
  ),
});
export default defineModule({
  id: "orders",
  name: "Orders",
  version: "1.1.0",
  description: "From first draft to fulfillment.",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: { inventory: "^1.0.0" },
  legacyView: true,
  permissions: [
    "orders.read",
    "orders.create",
    "orders.edit",
    "orders.confirm",
    "orders.fulfill",
    "orders.cancel",
    "orders.export",
  ],
  resources: {},
  configuration: empty,
  navigation: { path: "/orders", permission: "orders.read" },
  operations: {
    draft: operation({
      title: "Create draft",
      policy: "queued",
      permission: "orders.create",
      legacyOperation: "orderCreate",
      input: draft,
      output: order,
    }),
    edit: operation({
      title: "Edit draft",
      policy: "queued",
      permission: "orders.edit",
      legacyOperation: "orderEdit",
      input: Type.Object(
        { ...target, ...draft.properties },
        { additionalProperties: false },
      ),
      output: order,
    }),
    confirm: operation({
      title: "Confirm order",
      policy: "online",
      permission: "orders.confirm",
      legacyOperation: "orderConfirm",
      input: Type.Object(target, { additionalProperties: false }),
      output: order,
    }),
    fulfill: operation({
      title: "Fulfill order",
      policy: "online",
      permission: "orders.fulfill",
      legacyOperation: "orderFulfill",
      input: Type.Object(target, { additionalProperties: false }),
      output: order,
    }),
    cancel: operation({
      title: "Cancel order",
      policy: "online",
      permission: "orders.cancel",
      legacyOperation: "orderCancel",
      input: Type.Object(target, { additionalProperties: false }),
      output: order,
    }),
  },
});
