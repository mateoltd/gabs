import { lazy } from "react";
import type { ShellComposition } from "@suite/app-web";
import { moduleCatalog } from "../catalog/index";
import { localProfileRuntime } from "../local/runtime";
import { BUSINESS_PERMISSIONS, PERMISSIONS } from "../presets/index";

const Orders = lazy(() => import("@suite/orders/web"));
const Inventory = lazy(() => import("@suite/inventory/web"));

export const productShellComposition: ShellComposition = Object.freeze({
  catalog: moduleCatalog,
  permissions: PERMISSIONS,
  businessPermissions: BUSINESS_PERMISSIONS,
  localProfiles: localProfileRuntime,
  moduleViews: Object.freeze({
    orders: Orders,
    inventory: Inventory,
  }),
});
