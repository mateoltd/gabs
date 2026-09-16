import type { DraftInput } from "@suite/contracts";
export type OrderStatus = "draft" | "confirmed" | "fulfilled" | "cancelled";
export function transition(
  status: OrderStatus,
  action: "confirm" | "fulfill" | "cancel",
): OrderStatus {
  if (action === "confirm" && status === "draft") return "confirmed";
  if (action === "fulfill" && status === "confirmed") return "fulfilled";
  if (action === "cancel" && (status === "draft" || status === "confirmed"))
    return "cancelled";
  throw Error(`Cannot ${action} an order that is ${status}.`);
}
export function validateDraft(input: DraftInput) {
  if (
    !input.customerName.trim() ||
    input.lines.length < 1 ||
    input.lines.length > 100
  )
    throw Error("Enter a customer and between 1 and 100 order lines.");
  if (new Set(input.lines.map((l) => l.productId)).size !== input.lines.length)
    throw Error("Combine duplicate products into one line.");
  let total = 0;
  for (const line of input.lines) {
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1000000 ||
      !Number.isSafeInteger(line.priceMinor) ||
      line.priceMinor < 0 ||
      line.priceMinor > 100000000
    )
      throw Error("Invalid quantity or price.");
    total += line.quantity * line.priceMinor;
  }
  if (!Number.isSafeInteger(total) || total > 9000000000000)
    throw Error("The order total exceeds the supported limit.");
  return total;
}
