import { applyOrderStock, resolveOrderProducts } from "@suite/inventory/server";
import type { LegacyInventoryService } from "./inventory-service";

/**
 * Compatibility bridge for the signed v1 Orders backend. New module releases
 * consume Inventory through declared SDK services instead of importing it.
 */
export const legacyInventoryService: LegacyInventoryService = Object.freeze({
  resolveProducts: resolveOrderProducts,
  applyStock: applyOrderStock,
});
