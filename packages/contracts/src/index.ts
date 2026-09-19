export * from "./commerce/business-cutover";
export * from "./workspaces/receipts";
export * from "./workspaces/attempts";
export * from "./workspaces/request-key";
export * from "./commerce/entities";
export * from "./identity/permissions";
import { OrderSchema } from "./commerce/entities";
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
  moduleCapabilityReview: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/modules/:moduleId/capabilities",
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
  moduleReferences: {
    method: "GET",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/references/:resource",
  },
  moduleMembers: {
    method: "GET",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/members/:resource/:field",
  },
  moduleCapabilityAuthorize: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/capabilities/authorize",
  },
  moduleCapabilityLease: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/capabilities/lease",
  },
  capabilityLeaseKey: { method: "GET", path: "/api/v1/capabilities/key" },
  moduleRequest: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/records",
  },
  moduleAttemptSettle: {
    method: "POST",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/attempts/settle",
  },
  moduleReceipts: {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/module-receipts",
  },
  moduleReceiptArtifact: {
    method: "GET",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/receipt-artifact",
  },
  moduleArtifactMetadata: {
    method: "GET",
    path: "/api/v1/module/:moduleId/workspaces/:workspaceId/artifact/metadata",
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
  exportAuthorize: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/exports/:id/authorize",
  },
  exportDownload: {
    method: "GET",
    path: "/api/v1/workspaces/:workspaceId/exports/:id/download",
  },
  logout: { method: "POST", path: "/auth/logout" },
} as const;
export type OperationId = keyof typeof OPERATIONS;
export interface OperationRequest {
  /** An expectation checked against authenticated credentials; never an authority claim. */
  expectedUserId?: string;
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
