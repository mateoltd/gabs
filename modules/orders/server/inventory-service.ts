import type { Context, Tx } from "@suite/server-core";

export interface LegacyInventoryService {
  resolveProducts(
    tx: Tx,
    ctx: Context,
    ids: string[],
  ): Promise<
    readonly { id: string; sku: string; name: string; active: boolean }[]
  >;
  applyStock(
    tx: Tx,
    ctx: Context,
    orderId: string,
    lines: readonly { product_id: string; quantity: number }[],
    kind: "reservation" | "release" | "fulfillment",
  ): Promise<void>;
}
