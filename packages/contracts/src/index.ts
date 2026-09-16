import ordersDefinition from "../../../modules/orders/module";
export * from "./business-cutover";
import { moduleDefinitions } from "@suite/module-catalog";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
export { Type, type Static, type TSchema };
export const LoginOptionsSchema = Type.Object(
  {
    loginHint: Type.Optional(Type.String({ format: "email", maxLength: 254 })),
    screenHint: Type.Optional(Type.Literal("signup")),
  },
  { additionalProperties: false },
);
export type LoginOptions = Static<typeof LoginOptionsSchema>;
export const Id = Type.String({ format: "uuid" });
export const Text = (max = 200) =>
  Type.String({ minLength: 1, maxLength: max });
export const ModuleId = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
export type ModuleId = string;
export const PLATFORM_PERMISSIONS = [
  "workspace.manage",
  "members.manage",
  "roles.manage",
  "modules.manage",
  "audit.read",
  "billing.manage",
] as const;
export const PERMISSIONS: string[] = [
  ...PLATFORM_PERMISSIONS,
  ...moduleDefinitions.flatMap((m) => m.permissions),
];
export type Permission = string;
export const PermissionSchema = Type.String({ maxLength: 200 });
export const ROLE_PRESETS: Record<string, readonly Permission[]> = {
  Owner: PERMISSIONS,
  Administrator: PERMISSIONS,
  Sales: [
    "orders.read",
    "orders.create",
    "orders.edit",
    "orders.confirm",
    "orders.cancel",
    "inventory.availability.read",
    ...PERMISSIONS.filter((p) => p.startsWith("contacts.")),
  ],
  Warehouse: [
    "orders.read",
    "orders.fulfill",
    "inventory.read",
    "inventory.availability.read",
    "inventory.products.manage",
    "inventory.receive",
    "inventory.adjust",
  ],
  Viewer: PERMISSIONS.filter((p) => p.endsWith(".read")),
};
export const BUSINESS_PERMISSIONS = PERMISSIONS.filter(
  (p) =>
    !PLATFORM_PERMISSIONS.includes(p as (typeof PLATFORM_PERMISSIONS)[number]),
);
export const MODULES = moduleDefinitions.map((m) => ({
  ...m,
  dependencies: Object.keys(m.dependencies),
}));
export function refreshModuleCatalog() {
  PERMISSIONS.splice(
    0,
    PERMISSIONS.length,
    ...PLATFORM_PERMISSIONS,
    ...moduleDefinitions.flatMap((m) => m.permissions),
  );
  BUSINESS_PERMISSIONS.splice(
    0,
    BUSINESS_PERMISSIONS.length,
    ...PERMISSIONS.filter(
      (p) =>
        !PLATFORM_PERMISSIONS.includes(
          p as (typeof PLATFORM_PERMISSIONS)[number],
        ),
    ),
  );
  MODULES.splice(
    0,
    MODULES.length,
    ...moduleDefinitions.map((m) => ({
      ...m,
      dependencies: Object.keys(m.dependencies),
    })),
  );
}
export const UserSchema = Type.Object({
  id: Id,
  name: Text(),
  email: Type.String(),
  emailVerified: Type.Boolean(),
  mfa: Type.Boolean(),
});
export const WorkspaceSchema = Type.Object({
  id: Id,
  name: Text(),
  kind: Type.Union([Type.Literal("personal"), Type.Literal("company")]),
  accent: Type.Optional(
    Type.Union([
      Type.Literal("forest"),
      Type.Literal("blue"),
      Type.Literal("plum"),
    ]),
  ),
  logoDataUrl: Type.Optional(Type.String({ maxLength: 50000 })),
  currency: Type.String(),
});
export const ErrorSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  requestId: Type.String(),
});
export const OkSchema = Type.Object({ ok: Type.Boolean() });
export const PageQuery = Type.Object({
  stock: Type.Optional(Type.Literal("low")),
  status: Type.Optional(
    Type.Union(
      ["draft", "confirmed", "fulfilled", "cancelled"].map((v) =>
        Type.Literal(v),
      ),
    ),
  ),
  cursor: Type.Optional(Id),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  search: Type.Optional(Type.String({ maxLength: 100 })),
});
export const page = (item: TSchema) =>
  Type.Object({
    items: Type.Array(item),
    nextCursor: Type.Union([Id, Type.Null()]),
  });
export const ProductSchema = Type.Object({
  id: Id,
  sku: Text(80),
  name: Text(),
  priceMinor: Type.Integer(),
  stockVersion: Type.Optional(Type.Integer()),
  onHand: Type.Optional(Type.Integer()),
  reserved: Type.Optional(Type.Integer()),
  available: Type.Integer(),
  version: Type.Integer(),
  active: Type.Boolean(),
});
export type Product = Static<typeof ProductSchema>;
export const OrderLineInput = Type.Object(
  {
    productId: Id,
    quantity: Type.Integer({ minimum: 1, maximum: 1000000 }),
    priceMinor: Type.Integer({ minimum: 0, maximum: 100000000 }),
  },
  { additionalProperties: false },
);
export const DraftInput = ordersDefinition.operations.draft.input;
export type DraftInput = Static<typeof DraftInput>;
export const OrderLineSchema = Type.Object(
  {
    ...OrderLineInput.properties,
    sku: Type.String(),
    name: Type.String(),
  },
  { additionalProperties: false },
);
export const OrderSchema = Type.Object({
  id: Id,
  number: Type.Integer(),
  customerName: Type.String(),
  status: Type.Union(
    ["draft", "confirmed", "fulfilled", "cancelled"].map((v) =>
      Type.Literal(v),
    ),
  ),
  version: Type.Integer(),
  totalMinor: Type.Number(),
  createdAt: Type.String(),
  lines: Type.Optional(Type.Array(OrderLineSchema)),
  activity: Type.Optional(
    Type.Array(
      Type.Object({
        action: Type.String(),
        createdAt: Type.String(),
      }),
    ),
  ),
});
export type Order = Static<typeof OrderSchema>;
export const OverviewSchema = Type.Object({
  orders: Type.Union([
    Type.Null(),
    Type.Object({
      draft: Type.Integer(),
      confirmed: Type.Integer(),
      fulfilled: Type.Integer(),
      cancelled: Type.Integer(),
      fulfilledDaily: Type.Array(
        Type.Object({ date: Type.String(), count: Type.Integer() }),
      ),
      ready: Type.Array(OrderSchema),
      recent: Type.Array(OrderSchema),
    }),
  ]),
  inventory: Type.Union([
    Type.Null(),
    Type.Object({
      products: Type.Integer(),
      available: Type.Number(),
      lowStock: Type.Integer(),
      lowStockItems: Type.Array(
        Type.Object({
          id: Id,
          name: Type.String(),
          sku: Type.String(),
          available: Type.Integer(),
        }),
      ),
    }),
  ]),
});
export const ModuleStateSchema = Type.Object({
  moduleId: ModuleId,
  state: Type.Union(
    ["draft", "enabled", "suspended"].map((v) => Type.Literal(v)),
  ),
  accessPolicy: Type.Union(
    ["self", "approval", "admin"].map((v) => Type.Literal(v)),
  ),
  entitled: Type.Boolean(),
  assigned: Type.Boolean(),
});
export const BootstrapSchema = Type.Object({
  workspace: WorkspaceSchema,
  permissions: Type.Array(Type.String()),
  roleNames: Type.Array(Type.String()),
  modules: Type.Array(ModuleStateSchema),
  offlineHours: Type.Integer(),
  seatLimit: Type.Integer(),
  memberCount: Type.Integer(),
  authorizedAt: Type.String(),
  policyRevision: Type.Optional(Type.String({ pattern: "^[0-9]{1,20}$" })),
});
export type Bootstrap = Static<typeof BootstrapSchema>;
export const MovementSchema = Type.Object({
  id: Id,
  productId: Id,
  sku: Type.String(),
  kind: Type.String(),
  onHandDelta: Type.Integer(),
  reservedDelta: Type.Integer(),
  reason: Type.String(),
  createdAt: Type.String(),
});
export const RoleSchema = Type.Object({
  id: Id,
  name: Type.String(),
  permissions: Type.Array(Type.String()),
  protected: Type.Boolean(),
});
export const MemberSchema = Type.Object({
  id: Id,
  userId: Id,
  name: Type.String(),
  email: Type.String(),
  active: Type.Boolean(),
  roles: Type.Array(RoleSchema),
  modules: Type.Array(Type.String()),
});
export const InvitationSchema = Type.Object({
  id: Id,
  email: Type.String(),
  state: Type.String(),
  expiresAt: Type.String(),
  roleId: Id,
});
export const AccessRequestSchema = Type.Object({
  id: Id,
  memberName: Type.String(),
  membershipId: Id,
  moduleId: ModuleId,
  reason: Type.String(),
  state: Type.String(),
});
export const NotificationSchema = Type.Object({
  action: Type.Optional(
    Type.Object({
      kind: Type.Literal("access-request"),
      id: Id,
      state: Type.String(),
      moduleId: Type.String(),
      reason: Type.String(),
    }),
  ),
  id: Id,
  title: Type.String(),
  message: Type.String(),
  read: Type.Boolean(),
  createdAt: Type.String(),
});
export const AuditSchema = Type.Object({
  id: Id,
  actorName: Type.String(),
  action: Type.String(),
  targetId: Type.String(),
  outcome: Type.String(),
  requestId: Type.String(),
  createdAt: Type.String(),
});
export const ExportSchema = Type.Object({
  id: Id,
  state: Type.String(),
  createdAt: Type.String(),
});
export const BusinessEvent = Type.Object({
  id: Id,
  workspaceId: Id,
  actorId: Id,
  type: Type.String(),
  version: Type.Integer({ minimum: 1 }),
  occurredAt: Type.String(),
  recordId: Id,
});
export const OPERATIONS = {
  connection: { method: "GET", path: "/api/v1/connection" },
  billingState: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/billing",
  },
  billingCommand: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/billing",
  },
  moduleTrust: { method: "GET", path: "/api/v1/module-trust" },
  installationReport: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/installation-reports",
  },
  moduleFleet: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/modules/:moduleId/devices",
  },
  platformState: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/platform",
  },
  platformCommand: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/platform",
  },
  moduleQuery: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/queries/:operationName",
  },
  moduleOperation: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/operations/:operationName",
  },
  moduleMembers: {
    method: "GET",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/members/:resource/:field",
  },
  moduleRequest: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/records",
  },
  moduleArtifact: {
    method: "GET",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/artifact",
  },

  overview: { method: "GET", path: "/api/v1/workspaces/:workspaceId/overview" },
  me: { method: "GET", path: "/api/v1/me" },
  workspacePolicy: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/policy",
  },
  bootstrap: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/bootstrap",
  },
  products: { method: "GET", path: "/api/v1/workspaces/:workspaceId/products" },
  productCreate: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/products",
  },
  productEdit: {
    method: "PATCH",
    path: "/api/v1/workspaces/:workspaceId/products/:id",
  },
  stockChange: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/products/:id/stock",
  },
  movements: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/movements",
  },
  orders: { method: "GET", path: "/api/v1/workspaces/:workspaceId/orders" },
  orderGet: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/orders/:id",
  },
  businessCutoverReview: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/business-upgrade/review",
  },
  orderCreate: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/orders",
  },
  orderEdit: {
    method: "PUT",
    path: "/api/v1/workspaces/:workspaceId/orders/:id",
  },
  orderConfirm: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/orders/:id/confirm",
  },
  orderFulfill: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/orders/:id/fulfill",
  },
  orderCancel: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/orders/:id/cancel",
  },
  members: { method: "GET", path: "/api/v1/workspaces/:workspaceId/members" },
  memberEdit: {
    method: "PATCH",
    path: "/api/v1/workspaces/:workspaceId/members/:id",
  },
  roles: { method: "GET", path: "/api/v1/workspaces/:workspaceId/roles" },
  roleCreate: { method: "POST", path: "/api/v1/workspaces/:workspaceId/roles" },
  roleEdit: {
    method: "PUT",
    path: "/api/v1/workspaces/:workspaceId/roles/:id",
  },
  invitations: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/invitations",
  },
  inviteCreate: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/invitations",
  },
  inviteRevoke: {
    method: "DELETE",
    path: "/api/v1/workspaces/:workspaceId/invitations/:id",
  },
  inviteAccept: { method: "POST", path: "/api/v1/invitations/:id/accept" },
  inviteDecline: { method: "POST", path: "/api/v1/invitations/:id/decline" },
  workspaceCreate: { method: "POST", path: "/api/v1/workspaces" },
  workspaceEdit: { method: "PATCH", path: "/api/v1/workspaces/:workspaceId" },
  moduleEdit: {
    method: "PATCH",
    path: "/api/v1/workspaces/:workspaceId/modules/:moduleId",
  },
  accessRequest: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/modules/:moduleId/access",
  },
  accessRequests: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/access-requests",
  },
  accessResolve: {
    method: "PATCH",
    path: "/api/v1/workspaces/:workspaceId/access-requests/:id",
  },
  notifications: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/notifications",
  },
  notificationRead: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/notifications/:id/read",
  },
  audit: { method: "GET", path: "/api/v1/workspaces/:workspaceId/audit" },
  exports: { method: "GET", path: "/api/v1/workspaces/:workspaceId/exports" },
  exportCreate: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/exports",
  },
  exportDownload: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/exports/:id/download",
  },
  logout: { method: "POST", path: "/auth/logout" },
} as const;
export type OperationId = keyof typeof OPERATIONS;
export interface OperationRequest {
  operation: OperationId;
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  version?: number;
  moduleVersion?: string;
}
export function operationPath(request: OperationRequest) {
  const operation = OPERATIONS[request.operation];
  if (!operation) throw Error("Unknown operation");
  let path: string = operation.path;
  path = path.replace(/:([A-Za-z]+)/g, (_, key) => {
    const value = request.params?.[key];
    if (!value || !/^[a-zA-Z0-9-]+$/.test(value))
      throw Error("Invalid route parameter");
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query ?? {}))
    if (value !== undefined) search.set(key, String(value));
  return {
    method: operation.method,
    path: path + (search.size ? "?" + search : ""),
  };
}
