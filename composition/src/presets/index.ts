import { PLATFORM_PERMISSIONS, type Permission } from "@suite/contracts";
import { bundledModuleIds, moduleDefinitions } from "../catalog/index";
import { moduleCatalog } from "../catalog/index";

export const PERMISSIONS: string[] = [
  ...PLATFORM_PERMISSIONS,
  ...moduleDefinitions.flatMap((module) => module.permissions),
];
export const BUSINESS_PERMISSIONS = PERMISSIONS.filter(
  (permission) =>
    !PLATFORM_PERMISSIONS.includes(
      permission as (typeof PLATFORM_PERMISSIONS)[number],
    ),
);
export const MODULES = moduleDefinitions.map((module) => ({
  ...module,
  dependencies: Object.keys(module.dependencies),
}));

export const ROLE_PRESETS: Record<string, readonly Permission[]> = {
  Owner: PERMISSIONS,
  Administrator: PERMISSIONS,
  Sales: [
    "orders.read",
    "orders.create",
    "orders.edit",
    "orders.confirm",
    "orders.cancel",
    "inventory.reservations.write",
    "inventory.availability.read",
    ...PERMISSIONS.filter((permission) => permission.startsWith("contacts.")),
  ],
  Warehouse: [
    "orders.read",
    "orders.fulfill",
    "inventory.reservations.write",
    "inventory.read",
    "inventory.availability.read",
    "inventory.products.manage",
    "inventory.receive",
    "inventory.adjust",
  ],
  Viewer: PERMISSIONS.filter((permission) => permission.endsWith(".read")),
};

/** Reviewed onboarding grants owned by product composition, not the SDK or wire contracts. */
export const DEFAULT_SERVICE_GRANTS = [
  {
    source: "orders",
    target: "inventory",
    services: ["resolve-products", "reserve", "release", "consume"],
  },
] as const;

export const productWorkspacePreset = {
  moduleIds: bundledModuleIds,
  rolePresets: ROLE_PRESETS,
  serviceGrants: DEFAULT_SERVICE_GRANTS,
} as const;

export const productServerRuntime = Object.freeze({
  catalog: moduleCatalog,
  preset: productWorkspacePreset,
});

export function refreshProductPreset() {
  PERMISSIONS.splice(
    0,
    PERMISSIONS.length,
    ...PLATFORM_PERMISSIONS,
    ...moduleDefinitions.flatMap((module) => module.permissions),
  );
  BUSINESS_PERMISSIONS.splice(
    0,
    BUSINESS_PERMISSIONS.length,
    ...PERMISSIONS.filter(
      (permission) =>
        !PLATFORM_PERMISSIONS.includes(
          permission as (typeof PLATFORM_PERMISSIONS)[number],
        ),
    ),
  );
  MODULES.splice(
    0,
    MODULES.length,
    ...moduleDefinitions.map((module) => ({
      ...module,
      dependencies: Object.keys(module.dependencies),
    })),
  );
}
