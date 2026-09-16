export interface StockBalance {
  onHand: number;
  reserved: number;
}
export type StockEffect =
  "receipt" | "adjustment" | "reservation" | "release" | "fulfillment";
export function applyStockEffect(
  balance: StockBalance,
  kind: StockEffect,
  quantity: number,
): StockBalance {
  if (
    !Number.isSafeInteger(quantity) ||
    (kind !== "adjustment" && quantity <= 0) ||
    quantity === 0
  )
    throw Error("Enter a valid whole-unit quantity.");
  let { onHand, reserved } = balance;
  if (kind === "receipt" || kind === "adjustment") onHand += quantity;
  if (kind === "reservation") reserved += quantity;
  if (kind === "release") reserved -= quantity;
  if (kind === "fulfillment") {
    onHand -= quantity;
    reserved -= quantity;
  }
  if (onHand < 0 || reserved < 0 || reserved > onHand || onHand > 1000000000)
    throw Error("There is not enough available stock for this operation.");
  return { onHand, reserved };
}
