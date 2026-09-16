import { provisionWorkspace } from "../../packages/server-core/src/provision";
import inventory from "../../modules/inventory/releases/1.2.0/module";
import orders from "../../modules/orders/releases/1.1.0/module";
/** Explicit historical fixtures exercise supported legacy contracts and migration sources. */
export function provisionLegacyWorkspace(
  ...[tx, input]: Parameters<typeof provisionWorkspace>
) {
  return provisionWorkspace(tx, {
    ...input,
    moduleDefaults: [inventory, orders],
    serviceGrants: [],
  });
}
