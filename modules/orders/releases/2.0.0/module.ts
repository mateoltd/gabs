import { defineModule, operation, store, Type } from "@suite/module-sdk";
import inventory from "./inventory-services";
export const id = Type.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
const version = Type.Integer({ minimum: 1 });
const price = Type.Integer({ minimum: 0, maximum: 100000000 });
const line = Type.Object(
  {
    productId: id,
    quantity: Type.Integer({ minimum: 1, maximum: 1000000 }),
    priceMinor: price,
  },
  { additionalProperties: false },
);
export const draft = Type.Object(
  {
    customerName: Type.String({ minLength: 1, maxLength: 200 }),
    lines: Type.Array(line, { minItems: 1, maxItems: 100 }),
  },
  { additionalProperties: false },
);
const status = Type.Union(
  (["draft", "confirmed", "fulfilled", "cancelled"] as const).map((value) =>
    Type.Literal(value),
  ),
);
const activity = Type.Object(
  { action: Type.String(), createdAt: Type.String() },
  { additionalProperties: false },
);
const orderData = {
  orderVersion: version,
  fulfilledOn: Type.Optional(
    Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  ),
  number: Type.Integer({ minimum: 1, maximum: 2147483646 }),
  customerName: draft.properties.customerName,
  status,
  totalMinor: Type.Integer({ minimum: 0, maximum: 9000000000000 }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  lines: Type.Array(
    Type.Object(
      { ...line.properties, sku: Type.String(), name: Type.String() },
      { additionalProperties: false },
    ),
    { minItems: 1, maxItems: 100 },
  ),
  activity: Type.Array(activity, { maxItems: 20 }),
};
const {
  orderVersion: _orderVersion,
  fulfilledOn: _fulfilledOn,
  ...publicOrderData
} = orderData;
export const order = Type.Object(
  { id, version, ...publicOrderData },
  { additionalProperties: false },
);
const error = Type.Object(
  {
    code: Type.Union(
      (
        [
          "NOT_FOUND",
          "INVALID_DRAFT",
          "VERSION_CONFLICT",
          "INVALID_TRANSITION",
          "NUMBER_EXHAUSTED",
          "STOCK_REJECTED",
        ] as const
      ).map((value) => Type.Literal(value)),
    ),
    message: Type.String(),
    stock: Type.Optional(inventory.reserve.contract.errors),
  },
  { additionalProperties: false },
);
const target = Type.Object({ id, version }, { additionalProperties: false });
const event = Type.Object({ recordId: id, number: orderData.number });
export default defineModule({
  id: "orders",
  name: "Orders",
  version: "2.0.0",
  description: "From first draft to fulfillment.",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: { inventory: "^2.0.0" },
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
  configuration: Type.Object({}, { additionalProperties: false }),
  navigation: { path: "/orders", permission: "orders.read" },
  storage: {
    version: 2,
    compatible: { minimum: 2, maximum: 2 },
    migrations: { "import-v1": { from: 1, to: 2 } },
  },
  stores: {
    orders: store(orderData, { unique: ["number"] }),
    counters: store({
      next: Type.Integer({ minimum: 1, maximum: 2147483647 }),
    }),
  },
  services: {
    products: inventory["resolve-products"],
    reserve: inventory.reserve,
    release: inventory.release,
    consume: inventory.consume,
  },
  audit: ["created", "updated", "confirmed", "fulfilled", "cancelled"],
  events: { confirmed: event, fulfilled: event, cancelled: event },
  operations: {
    draft: operation({
      title: "Create draft",
      policy: "queued",
      permission: "orders.create",
      input: draft,
      output: order,
      errors: error,
    }),
    edit: operation({
      title: "Edit draft",
      policy: "queued",
      permission: "orders.edit",
      input: Type.Object(
        { ...target.properties, ...draft.properties },
        { additionalProperties: false },
      ),
      output: order,
      errors: error,
    }),
    confirm: operation({
      title: "Confirm order",
      policy: "online",
      permission: "orders.confirm",
      input: target,
      output: order,
      errors: error,
    }),
    fulfill: operation({
      title: "Fulfill order",
      policy: "online",
      permission: "orders.fulfill",
      input: target,
      output: order,
      errors: error,
    }),
    cancel: operation({
      title: "Cancel order",
      policy: "online",
      permission: "orders.cancel",
      input: target,
      output: order,
      errors: error,
    }),
    get: operation({
      title: "Order",
      policy: "online",
      permission: "orders.read",
      input: Type.Object({ id }, { additionalProperties: false }),
      output: order,
      errors: error,
    }),
    overview: operation({
      title: "Order summary",
      policy: "online",
      permission: "orders.read",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Object({
        draft: Type.Integer(),
        confirmed: Type.Integer(),
        fulfilled: Type.Integer(),
        cancelled: Type.Integer(),
        fulfilledDaily: Type.Array(
          Type.Object({ date: Type.String(), count: Type.Integer() }),
        ),
        ready: Type.Array(order),
        recent: Type.Array(order),
      }),
      errors: error,
    }),
    "export-page": operation({
      title: "Export orders",
      policy: "online",
      permission: "orders.export",
      input: Type.Object(
        {
          cursor: Type.Optional(Type.String({ maxLength: 24576 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({
        items: Type.Array(
          Type.Object({
            number: orderData.number,
            customerName: orderData.customerName,
            status,
            totalMinor: orderData.totalMinor,
          }),
        ),
        nextCursor: Type.Union([Type.String(), Type.Null()]),
        total: Type.Integer(),
      }),
      errors: error,
    }),
    list: operation({
      title: "Orders",
      policy: "online",
      permission: "orders.read",
      input: Type.Object(
        {
          cursor: Type.Optional(Type.String({ maxLength: 24576 })),
          search: Type.Optional(Type.String({ maxLength: 200 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          status: Type.Optional(status),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({
        items: Type.Array(order),
        nextCursor: Type.Union([Type.String(), Type.Null()]),
      }),
      errors: error,
    }),
  },
});
