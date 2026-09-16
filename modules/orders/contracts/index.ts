export { DraftInput, OrderSchema, OrderLineSchema } from "@suite/contracts";
export const ordersManifest = {
  id: "orders",
  dependencies: ["inventory"],
  version: 1,
} as const;
