import { assertModuleStorage } from "../../../packages/server-core/src/module-storage";
import { businessQuery } from "./business-queries";
import { registerWorkspacePolicy } from "./workspace-policy";
import ordersDefinition from "../../../modules/orders/releases/1.1.0/module";
import { moduleServers } from "@suite/module-catalog/server";
import {
  assertHostModuleRollout,
  validateConfiguredRollouts,
} from "../../../packages/server-core/src/module-rollout";
import { ModuleBusinessError } from "@suite/module-sdk/server";
import inventoryDefinition from "../../../modules/inventory/releases/1.2.0/module";
import { registerBilling } from "./billing";
import { registerPlatform } from "./platform";
import { ValidationError } from "@suite/module-sdk";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import * as S from "@suite/contracts";
import {
  type DB,
  type Tx,
  type Context,
  type Actor,
  type AuthConfig,
  connectDatabase,
  authConfig,
  authentication,
  inWorkspace,
  authorize,
  checkModule,
  AppError,
  requireCondition,
  found,
  idempotent,
  audit,
  publish,
  iso,
  provisionWorkspace,
  lockKey,
  bootstrap,
  listMembers,
  editMember,
  saveRole,
  createInvitation,
  acceptInvitation,
  configureModule,
  requestAccess,
  resolveAccess,
} from "@suite/server-core";
import {
  createProduct,
  editProduct,
  changeStock,
  productView,
  listProducts,
  inventoryOverview,
} from "@suite/inventory/server";
import {
  createOrder,
  editOrder,
  changeOrder,
  getOrder,
  listOrders,
  ordersOverview,
} from "@suite/orders/server";
import { readExport } from "./exports";
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}
type Request<B = unknown> = FastifyRequest<{
  Params: { workspaceId: string; id: string; moduleId: string };
  Querystring: {
    cursor?: string;
    limit?: number;
    search?: string;
    status?: string;
    stock?: "low";
  };
  Body: B;
}>;
const { Type: T } = S;
const Params = T.Object({
  workspaceId: S.Id,
  id: T.Optional(S.Id),
  moduleId: T.Optional(S.ModuleId),
});
const Enum = <const V extends readonly string[]>(values: V) =>
  T.Union(values.map((v) => T.Literal(v as V[number])));
const StringArray = T.Array(T.String(), { maxItems: 100, uniqueItems: true });
const Empty = T.Object({}, { additionalProperties: false });
export async function createApp(
  options: { db?: DB; auth?: AuthConfig; logger?: boolean } = {},
) {
  const db = options.db ?? connectDatabase();
  const config = options.auth ?? authConfig();
  const auth = authentication(db, config);
  const app = Fastify({
    logger: options.logger
      ? {
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url?.split("?")[0],
              remoteAddress: req.ip,
            }),
          },
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        }
      : false,
    bodyLimit: 256 * 1024,
    requestTimeout: 20000,
    genReqId: () => randomUUID(),
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.origin,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token",
      "Idempotency-Key",
      "If-Match",
      "Authorization",
      "X-Desktop-Version",
      "X-Module-Version",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(rateLimit, {
    max: process.env.NODE_ENV === "production" ? 300 : 10000,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: { title: "Modular Business Suite API", version: "1.0.0" },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "suite_session" },
          bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  app.get(
    "/api/v1/connection",
    {
      config: { public: true },
      schema: {
        operationId: "connection",
        response: { 200: S.Type.Object({ ok: S.Type.Boolean() }) },
      },
    },
    async () => {
      await sql`select 1`.execute(db);
      return { ok: true };
    },
  );
  app.addHook("onSend", async (_req, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "same-origin");
    return payload;
  });
  app.addHook("preHandler", async (req) => {
    if (req.routeOptions.config.public) return;
    const bearer = req.headers.authorization;
    if (bearer?.startsWith("Bearer "))
      req.actor = await auth.bearer(bearer.slice(7));
    else req.actor = await auth.session(req.cookies.suite_session);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !bearer?.startsWith("Bearer ")
    ) {
      requireCondition(
        req.headers.origin === config.origin,
        403,
        "CSRF_INVALID",
        "The request origin is not allowed.",
      );
      requireCondition(
        req.headers["x-csrf-token"] === req.actor.csrfToken,
        403,
        "CSRF_INVALID",
        "Refresh the page before trying this action.",
      );
    }
    const version = req.headers["x-desktop-version"];
    if (version) {
      const min = process.env.MIN_DESKTOP_VERSION ?? "0.1.0";
      const parse = (v: string) => v.split(".").map(Number);
      const client = parse(String(version)),
        server = parse(min);
      requireCondition(
        /^\d+\.\d+\.\d+$/.test(String(version)) &&
          client.every(Number.isSafeInteger),
        400,
        "INVALID_CLIENT",
        "Invalid desktop version.",
      );
      const index = client.findIndex((v, i) => v !== server[i]);
      requireCondition(
        index < 0 || client[index] > server[index],
        426,
        "UPDATE_REQUIRED",
        "Update the desktop application to continue. Your local drafts are preserved.",
      );
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & {
      code?: string;
      statusCode?: number;
      validation?: unknown;
    };
    let status = 500,
      code = "INTERNAL_ERROR",
      message =
        "The operation could not be completed. Try again using the same request.";
    if (e instanceof ModuleBusinessError) {
      const detail = e.detail as { message?: unknown } | null;
      reply.status(422).send({
        code: e.code,
        message:
          typeof detail?.message === "string" ? detail.message : e.message,
        requestId: req.id,
        detail: {
          moduleId: e.moduleId,
          operation: e.operation,
          error: e.detail,
        },
      });
      return;
    }
    if (e instanceof AppError) {
      status = e.status;
      code = e.code;
      message = e.message;
    } else if (e.validation || e instanceof ValidationError) {
      status = 400;
      code = "INVALID_INPUT";
      message = "Check the supplied values and try again.";
    } else if (e.code === "23505") {
      status = 409;
      code = "ALREADY_EXISTS";
      message = "A record with these details already exists.";
    } else if (e.code === "23503" || e.code === "23514" || e.code === "22P02") {
      status = 400;
      code = "INVALID_REFERENCE";
      message = "The request contains an invalid value or workspace reference.";
    } else if (e.statusCode && e.statusCode < 500) {
      status = e.statusCode;
      code = "REQUEST_REJECTED";
      message = e.message;
    }
    if (status >= 500)
      req.log.error({ err: e, requestId: req.id }, "Request failed");
    reply.status(status).send({ code, message, requestId: req.id });
  });
  app.get(
    "/health",
    { config: { public: true }, schema: { hide: true } },
    async () => {
      await sql`select 1`.execute(db);
      return { ok: true };
    },
  );
  app.get(
    "/api/v1/openapi.json",
    { config: { public: true }, schema: { hide: true } },
    async () => app.swagger(),
  );
  app.get(
    "/auth/config",
    { config: { public: true }, schema: { hide: true } },
    async () => ({ mode: config.mode }),
  );
  app.get(
    "/auth/login",
    {
      config: { public: true },
      schema: { hide: true, querystring: S.LoginOptionsSchema },
    },
    async (req, reply) => {
      requireCondition(
        config.mode === "oidc",
        400,
        "LOGIN_MODE",
        "Use development login in this environment.",
      );
      const login = await auth.begin(req.query as S.LoginOptions);
      reply.setCookie("suite_login", login.state, {
        httpOnly: true,
        secure: config.apiOrigin.startsWith("https:"),
        sameSite: "lax",
        path: "/auth",
        maxAge: 600,
      });
      return reply.redirect(login.url);
    },
  );
  app.get(
    "/auth/callback",
    { config: { public: true }, schema: { hide: true } },
    async (req, reply) => {
      const result = await auth.finish(
        new URL(req.url, config.apiOrigin),
        req.cookies.suite_login,
      );
      const session = await auth.issue(result.user.id, result.mfa);
      reply
        .clearCookie("suite_login", { path: "/auth" })
        .setCookie("suite_session", session.token, {
          httpOnly: true,
          secure: config.apiOrigin.startsWith("https:"),
          sameSite: "lax",
          path: "/",
          maxAge: 8 * 3600,
        });
      return reply.redirect(config.origin);
    },
  );
  if (config.mode === "development")
    app.post(
      "/auth/development",
      {
        config: { public: true },
        schema: {
          hide: true,
          body: T.Object(
            { email: T.String({ format: "email" }) },
            { additionalProperties: false },
          ),
        },
      },
      async (req, reply) => {
        requireCondition(
          !req.headers.origin || req.headers.origin === config.origin,
          403,
          "CSRF_INVALID",
          "The request origin is not allowed.",
        );
        const { email } = req.body as { email: string };
        const user = await db
          .selectFrom("suite.users")
          .selectAll()
          .where("issuer", "=", "development")
          .where("email", "=", email.toLowerCase())
          .where("active", "=", true)
          .executeTakeFirst();
        requireCondition(
          user,
          401,
          "UNKNOWN_DEVELOPMENT_USER",
          "Run the local seed command and choose a demonstration account.",
        );
        const session = await auth.issue(user.id, true);
        reply.setCookie("suite_session", session.token, {
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: "/",
          maxAge: 8 * 3600,
        });
        return { ok: true };
      },
    );
  app.post(
    "/auth/logout",
    { schema: { operationId: "logout", response: { 200: S.OkSchema } } },
    async (req, reply) => {
      await auth.logout(req.cookies.suite_session);
      reply.clearCookie("suite_session", { path: "/" });
      return { ok: true };
    },
  );
  app.get(
    "/api/v1/me",
    {
      schema: {
        operationId: "me",
        response: {
          200: T.Object({
            user: S.UserSchema,
            csrfToken: T.Optional(T.String()),
            workspaces: T.Array(S.WorkspaceSchema),
            invitations: T.Array(
              T.Object({
                id: S.Id,
                workspaceId: S.Id,
                workspaceName: T.String(),
                expiresAt: T.String(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const workspaces = await sql<{
        id: string;
        name: string;
        kind: "personal" | "company";
        currency: string;
      }>`select * from suite.list_workspaces(${req.actor.id}::uuid)`.execute(
        db,
      );
      const invitations = req.actor.emailVerified
        ? await sql<{
            id: string;
            workspace_id: string;
            workspace_name: string;
            expires_at: Date;
          }>`select * from suite.pending_invitations(${req.actor.email})`.execute(
            db,
          )
        : { rows: [] };
      return {
        user: {
          id: req.actor.id,
          name: req.actor.name,
          email: req.actor.email,
          emailVerified: req.actor.emailVerified,
          mfa: req.actor.mfa,
        },
        csrfToken: req.actor.csrfToken,
        workspaces: workspaces.rows,
        invitations: invitations.rows.map((i) => ({
          id: i.id,
          workspaceId: i.workspace_id,
          workspaceName: i.workspace_name,
          expiresAt: iso(i.expires_at),
        })),
      };
    },
  );
  app.post(
    "/api/v1/workspaces",
    {
      schema: {
        operationId: "workspaceCreate",
        body: T.Object(
          {
            id: S.Id,
            name: S.Text(100),
            currency: T.String({ pattern: "^[A-Z]{3}$" }),
          },
          { additionalProperties: false },
        ),
        response: { 200: S.WorkspaceSchema },
      },
    },
    async (req) => {
      requireCondition(
        req.actor.emailVerified && req.actor.mfa,
        403,
        "MFA_REQUIRED",
        "Verify your email and complete MFA before creating a company.",
      );
      const input = req.body as { id: string; name: string; currency: string };
      return inWorkspace(db, input.id, async (tx) => {
        await lockKey(tx, "create-workspace:" + input.id);
        const exists = await tx
          .selectFrom("suite.workspaces")
          .selectAll()
          .where("id", "=", input.id)
          .executeTakeFirst();
        if (exists) {
          requireCondition(
            exists.owner_user_id === req.actor.id &&
              exists.name === input.name &&
              exists.currency === input.currency,
            409,
            "IDEMPOTENCY_CONFLICT",
            "This workspace identifier is already in use.",
          );
          return {
            id: exists.id,
            name: exists.name,
            kind: exists.kind,
            currency: exists.currency,
          };
        }
        return provisionWorkspace(tx, {
          id: input.id,
          name: input.name,
          currency: input.currency,
          userId: req.actor.id,
          kind: "company",
          requestId: req.id,
        });
      });
    },
  );
  for (const accept of [true, false])
    app.post(
      `/api/v1/invitations/:id/${accept ? "accept" : "decline"}`,
      {
        schema: {
          operationId: accept ? "inviteAccept" : "inviteDecline",
          params: T.Object({ id: S.Id }),
          body: Empty,
          response: { 200: S.OkSchema },
        },
      },
      async (req) => {
        const { id } = req.params as { id: string };
        const invites = await sql<{
          workspace_id: string;
        }>`select * from suite.resolve_invitation(${id}::uuid,${req.actor.email})`.execute(
          db,
        );
        const invitation = found(invites.rows[0]);
        return inWorkspace(db, invitation.workspace_id, (tx) =>
          acceptInvitation(
            tx,
            {
              actor: req.actor,
              workspaceId: invitation.workspace_id,
              requestId: req.id,
              membershipId: "",
              permissions: [],
              roleNames: [],
            },
            id,
            accept,
          ),
        );
      },
    );
  function route<B extends S.TSchema>(
    operation: S.OperationId,
    options: {
      body?: B;
      response: S.TSchema;
      permission?: S.Permission | ((req: Request<S.Static<B>>) => S.Permission);
      module?: S.ModuleId;
      // Export metadata is host-owned; its worker selects and validates the current business backend.
      hostStorageBridge?: boolean;
      query?: boolean;
      businessRead?: boolean;
      handler: (
        tx: Tx,
        ctx: Context,
        req: Request<S.Static<B>>,
        reply: FastifyReply,
      ) => Promise<unknown>;
    },
  ) {
    const op = S.OPERATIONS[operation];
    app.route({
      method: op.method,
      url: op.path,
      schema: {
        operationId: operation,
        params: Params,
        ...(options.body ? { body: options.body } : {}),
        ...(options.query
          ? {
              querystring: options.businessRead
                ? T.Object({
                    ...S.PageQuery.properties,
                    cursor: T.Optional(T.String({ maxLength: 24576 })),
                  })
                : S.PageQuery,
            }
          : {}),
        response: {
          200: options.response,
          400: S.ErrorSchema,
          401: S.ErrorSchema,
          403: S.ErrorSchema,
          404: S.ErrorSchema,
          409: S.ErrorSchema,
          412: S.ErrorSchema,
          428: S.ErrorSchema,
        },
        security: [{ session: [] }, { bearer: [] }],
      },
      handler: async (request, reply) => {
        const req = request as Request<S.Static<B>>;
        if (options.businessRead) reply.header("cache-control", "no-store");
        return inWorkspace(
          db,
          req.params.workspaceId,
          async (tx) => {
            if (operation === "bootstrap")
              await tx
                .selectFrom("suite.workspace_policy")
                .select("revision")
                .where("workspace_id", "=", req.params.workspaceId)
                .forShare()
                .executeTakeFirst();
            const ctx = await authorize(
              tx,
              request.actor,
              req.params.workspaceId,
              request.id,
              typeof options.permission === "function"
                ? options.permission(req)
                : options.permission,
              options.module,
            );
            const execute = async () => {
              if (
                options.hostStorageBridge !== false &&
                (options.module === "orders" || options.module === "inventory")
              ) {
                const legacy =
                  options.module === "orders"
                    ? ordersDefinition
                    : inventoryDefinition;
                await assertHostModuleRollout(
                  tx,
                  ctx.workspaceId,
                  legacy,
                  moduleServers,
                );
                await assertModuleStorage(tx, ctx.workspaceId, legacy);
              }
              return options.handler(tx, ctx, req, reply);
            };
            if (
              op.method === "POST" ||
              (op.method === "PUT" && req.headers["idempotency-key"])
            )
              return idempotent(
                tx,
                ctx,
                req.headers["idempotency-key"] as string | undefined,
                operation,
                {
                  params: req.params,
                  body: req.body,
                  version: req.headers["if-match"],
                },
                execute,
              );
            return execute();
          },
          { readOnly: options.businessRead },
        );
      },
    });
  }
  route("bootstrap", {
    response: S.BootstrapSchema,
    handler: (tx, ctx) => bootstrap(tx, ctx),
  });
  route("overview", {
    businessRead: true,
    response: S.OverviewSchema,
    handler: async (tx, ctx) => {
      const visible = async (module: S.ModuleId, permissions: string[]) => {
        if (!permissions.some((p) => ctx.permissions.includes(p))) return false;
        try {
          await checkModule(tx, ctx.workspaceId, ctx.membershipId, module);
          return true;
        } catch (error) {
          if (
            error instanceof AppError &&
            ["MODULE_UNAVAILABLE", "MODULE_NOT_ASSIGNED"].includes(error.code)
          )
            return false;
          throw error;
        }
      };
      return {
        orders: (await visible("orders", ["orders.read"]))
          ? await businessQuery(tx, ctx, "orders", "overview", {}, () =>
              ordersOverview(tx, ctx.workspaceId),
            )
          : null,
        inventory: (await visible("inventory", [
          "inventory.read",
          "inventory.availability.read",
        ]))
          ? await businessQuery(tx, ctx, "inventory", "overview", {}, () =>
              inventoryOverview(tx, ctx.workspaceId),
            )
          : null,
      };
    },
  });
  route("products", {
    businessRead: true,
    hostStorageBridge: false,
    response: T.Object({
      items: T.Array(S.ProductSchema),
      nextCursor: T.Union([T.String(), T.Null()]),
    }),
    module: "inventory",
    query: true,
    handler: async (tx, ctx, req) => {
      requireCondition(
        ctx.permissions.includes("inventory.read") ||
          ctx.permissions.includes("inventory.availability.read"),
        403,
        "FORBIDDEN",
        "Your role does not allow viewing inventory.",
      );
      return businessQuery(
        tx,
        ctx,
        "inventory",
        "products",
        req.query,
        async () => {
          return listProducts(tx, ctx, req.query);
        },
      );
    },
  });
  const ProductInput = inventoryDefinition.operations["create-product"].input;
  route("productCreate", {
    body: ProductInput,
    response: S.ProductSchema,
    permission: "inventory.products.manage",
    module: "inventory",
    handler: (tx, ctx, req) => createProduct(tx, ctx, req.body),
  });
  route("productEdit", {
    body: T.Object(
      { ...ProductInput.properties, active: T.Boolean() },
      { additionalProperties: false },
    ),
    response: S.ProductSchema,
    permission: "inventory.products.manage",
    module: "inventory",
    handler: (tx, ctx, req) =>
      editProduct(tx, ctx, req.params.id, req.body, req.headers["if-match"]),
  });
  route("stockChange", {
    body: T.Object(
      {
        kind: Enum(["receipt", "adjustment"]),
        quantity: T.Integer({ minimum: -1000000000, maximum: 1000000000 }),
        reason: S.Text(500),
      },
      { additionalProperties: false },
    ),
    response: S.ProductSchema,
    permission: (req) =>
      req.body.kind === "receipt" ? "inventory.receive" : "inventory.adjust",
    module: "inventory",
    handler: (tx, ctx, req) => changeStock(tx, ctx, req.params.id, req.body),
  });
  route("movements", {
    businessRead: true,
    hostStorageBridge: false,
    response: T.Object({
      items: T.Array(S.MovementSchema),
      nextCursor: T.Union([T.String(), T.Null()]),
    }),
    permission: "inventory.read",
    module: "inventory",
    query: true,
    handler: async (tx, ctx, req) =>
      businessQuery(tx, ctx, "inventory", "movements", req.query, async () => {
        let q = tx
          .selectFrom("suite.stock_movements as m")
          .innerJoin("suite.products as p", (j) =>
            j
              .onRef("m.product_id", "=", "p.id")
              .onRef("m.workspace_id", "=", "p.workspace_id"),
          )
          .select([
            "m.id",
            "m.product_id",
            "p.sku",
            "m.kind",
            "m.on_hand_delta",
            "m.reserved_delta",
            "m.reason",
            "m.created_at",
          ])
          .where("m.workspace_id", "=", ctx.workspaceId)
          .orderBy("m.id");
        if (req.query.cursor) q = q.where("m.id", ">", req.query.cursor);
        const limit = req.query.limit ?? 50;
        const rows = await q.limit(limit + 1).execute();
        return {
          items: rows.slice(0, limit).map((m) => ({
            id: m.id,
            productId: m.product_id,
            sku: m.sku,
            kind: m.kind,
            onHandDelta: m.on_hand_delta,
            reservedDelta: m.reserved_delta,
            reason: m.reason,
            createdAt: iso(m.created_at),
          })),
          nextCursor: rows.length > limit ? rows[limit - 1].id : null,
        };
      }),
  });
  route("orders", {
    businessRead: true,
    hostStorageBridge: false,
    response: T.Object({
      items: T.Array(S.OrderSchema),
      nextCursor: T.Union([T.String(), T.Null()]),
    }),
    permission: "orders.read",
    module: "orders",
    query: true,
    handler: (tx, ctx, req) =>
      businessQuery(tx, ctx, "orders", "list", req.query, async () => {
        return listOrders(tx, ctx.workspaceId, req.query);
      }),
  });
  route("orderGet", {
    businessRead: true,
    hostStorageBridge: false,
    response: S.OrderSchema,
    permission: "orders.read",
    module: "orders",
    handler: (tx, ctx, req) =>
      businessQuery(tx, ctx, "orders", "get", { id: req.params.id }, () =>
        getOrder(tx, ctx.workspaceId, req.params.id),
      ),
  });
  route("orderCreate", {
    body: S.DraftInput,
    response: S.OrderSchema,
    permission: "orders.create",
    module: "orders",
    handler: (tx, ctx, req) => createOrder(tx, ctx, req.body),
  });
  route("orderEdit", {
    body: S.DraftInput,
    response: S.OrderSchema,
    permission: "orders.edit",
    module: "orders",
    handler: (tx, ctx, req) =>
      editOrder(tx, ctx, req.params.id, req.body, req.headers["if-match"]),
  });
  for (const action of ["confirm", "fulfill", "cancel"] as const)
    route(
      (
        {
          confirm: "orderConfirm",
          fulfill: "orderFulfill",
          cancel: "orderCancel",
        } as const
      )[action],
      {
        body: Empty,
        response: S.OrderSchema,
        permission: `orders.${action}`,
        module: "orders",
        handler: (tx, ctx, req) =>
          changeOrder(tx, ctx, req.params.id, action, req.headers["if-match"]),
      },
    );
  route("members", {
    response: T.Array(S.MemberSchema),
    permission: "members.manage",
    handler: listMembers,
  });
  route("memberEdit", {
    body: T.Object(
      {
        active: T.Boolean(),
        roleIds: T.Array(S.Id, { maxItems: 20, uniqueItems: true }),
        modules: T.Array(S.ModuleId, { maxItems: 100, uniqueItems: true }),
      },
      { additionalProperties: false },
    ),
    response: S.OkSchema,
    permission: "members.manage",
    handler: (tx, ctx, req) => editMember(tx, ctx, req.params.id, req.body),
  });
  route("roles", {
    response: T.Array(S.RoleSchema),
    permission: "roles.manage",
    handler: (tx, ctx) =>
      tx
        .selectFrom("suite.roles")
        .select(["id", "name", "permissions", "protected"])
        .where("workspace_id", "=", ctx.workspaceId)
        .orderBy("name")
        .execute(),
  });
  const RoleInput = T.Object(
    { name: S.Text(60), permissions: StringArray },
    { additionalProperties: false },
  );
  route("roleCreate", {
    body: RoleInput,
    response: S.RoleSchema,
    permission: "roles.manage",
    handler: (tx, ctx, req) => saveRole(tx, ctx, req.body),
  });
  route("roleEdit", {
    body: RoleInput,
    response: S.RoleSchema,
    permission: "roles.manage",
    handler: (tx, ctx, req) => saveRole(tx, ctx, req.body, req.params.id),
  });
  route("invitations", {
    response: T.Array(S.InvitationSchema),
    permission: "members.manage",
    handler: async (tx, ctx) => {
      const rows = await tx
        .selectFrom("suite.invitations")
        .selectAll()
        .where("workspace_id", "=", ctx.workspaceId)
        .orderBy("created_at", "desc")
        .limit(100)
        .execute();
      return rows.map((i) => ({
        id: i.id,
        email: i.email,
        state:
          i.state === "pending" && new Date(i.expires_at).getTime() < Date.now()
            ? "expired"
            : i.state,
        expiresAt: iso(i.expires_at),
        roleId: i.role_id,
      }));
    },
  });
  route("inviteCreate", {
    body: T.Object(
      { email: T.String({ format: "email", maxLength: 254 }), roleId: S.Id },
      { additionalProperties: false },
    ),
    response: S.InvitationSchema,
    permission: "members.manage",
    handler: (tx, ctx, req) => createInvitation(tx, ctx, req.body),
  });
  route("inviteRevoke", {
    response: S.OkSchema,
    permission: "members.manage",
    handler: async (tx, ctx, req) => {
      const i = found(
        await tx
          .selectFrom("suite.invitations")
          .selectAll()
          .where("workspace_id", "=", ctx.workspaceId)
          .where("id", "=", req.params.id)
          .executeTakeFirst(),
      );
      const role = found(
        await tx
          .selectFrom("suite.roles")
          .select("name")
          .where("workspace_id", "=", ctx.workspaceId)
          .where("id", "=", i.role_id)
          .executeTakeFirst(),
      );
      requireCondition(
        role.name !== "Owner" || ctx.roleNames.includes("Owner"),
        403,
        "OWNER_REQUIRED",
        "Only owners can manage ownership invitations.",
      );
      requireCondition(
        i.state === "pending",
        409,
        "INVITATION_RESOLVED",
        "This invitation is no longer pending.",
      );
      await tx
        .updateTable("suite.invitations")
        .set({ state: "revoked" })
        .where("id", "=", req.params.id)
        .where("workspace_id", "=", ctx.workspaceId)
        .execute();
      await audit(tx, ctx, "invitations.revoked", req.params.id);
      return { ok: true };
    },
  });
  route("workspaceEdit", {
    body: T.Object(
      {
        name: S.Text(100),
        offlineHours: T.String({ pattern: "^(?:[0-9]|1[0-9]|2[0-4])$" }),
        accent: T.Optional(Enum(["forest", "blue", "plum"])),
        logoDataUrl: T.Optional(
          T.String({
            maxLength: 50000,
            pattern: "^(data:image/png;base64,[A-Za-z0-9+/]+={0,2})?$",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    response: S.OkSchema,
    permission: "workspace.manage",
    handler: async (tx, ctx, req) => {
      if (req.body.logoDataUrl) {
        const bytes = Buffer.from(req.body.logoDataUrl.split(",")[1], "base64");
        requireCondition(
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          400,
          "INVALID_LOGO",
          "Choose a PNG logo.",
        );
      }
      await tx
        .updateTable("suite.workspaces")
        .set({
          name: req.body.name,
          offline_hours: Number(req.body.offlineHours),
          ...(req.body.accent ? { accent: req.body.accent } : {}),
          ...(req.body.logoDataUrl !== undefined
            ? { logo_data_url: req.body.logoDataUrl }
            : {}),
        })
        .where("id", "=", ctx.workspaceId)
        .execute();
      await audit(tx, ctx, "workspace.updated", ctx.workspaceId);
      return { ok: true };
    },
  });
  route("moduleEdit", {
    body: T.Object(
      {
        state: Enum(["draft", "enabled", "suspended"]),
        accessPolicy: Enum(["self", "approval", "admin"]),
        config: T.Optional(T.Record(T.String(), T.Unknown())),
      },
      { additionalProperties: false },
    ),
    response: S.OkSchema,
    permission: "modules.manage",
    handler: async (tx, ctx, req) => {
      const result = await configureModule(
        tx,
        ctx,
        req.params.moduleId,
        req.body,
      );
      await validateConfiguredRollouts(tx, ctx.workspaceId, moduleServers);
      return result;
    },
  });
  route("accessRequest", {
    body: T.Object(
      { reason: T.String({ maxLength: 500 }) },
      { additionalProperties: false },
    ),
    response: S.OkSchema,
    handler: (tx, ctx, req) =>
      requestAccess(tx, ctx, req.params.moduleId, req.body.reason),
  });
  route("accessRequests", {
    response: T.Array(S.AccessRequestSchema),
    handler: async (tx, ctx) => {
      let q = tx
        .selectFrom("suite.access_requests as a")
        .innerJoin("suite.memberships as m", (j) =>
          j
            .onRef("a.membership_id", "=", "m.id")
            .onRef("a.workspace_id", "=", "m.workspace_id"),
        )
        .innerJoin("suite.users as u", "m.user_id", "u.id")
        .select([
          "a.id",
          "a.membership_id",
          "a.module_id",
          "a.reason",
          "a.state",
          "u.name",
        ])
        .where("a.workspace_id", "=", ctx.workspaceId);
      if (!ctx.permissions.includes("modules.manage"))
        q = q.where("a.membership_id", "=", ctx.membershipId);
      return (await q.orderBy("a.created_at", "desc").limit(100).execute()).map(
        (a) => ({
          id: a.id,
          membershipId: a.membership_id,
          moduleId: a.module_id,
          reason: a.reason,
          state: a.state,
          memberName: a.name,
        }),
      );
    },
  });
  route("accessResolve", {
    body: T.Object(
      { state: Enum(["approved", "denied", "cancelled"]) },
      { additionalProperties: false },
    ),
    response: S.OkSchema,
    handler: (tx, ctx, req) =>
      resolveAccess(tx, ctx, req.params.id, req.body.state),
  });
  route("notifications", {
    response: T.Array(S.NotificationSchema),
    handler: async (tx, ctx) => {
      const notifications = await tx
        .selectFrom("suite.notifications as n")
        .innerJoin("suite.outbox as e", (j) =>
          j
            .onRef("e.id", "=", "n.event_id")
            .onRef("e.workspace_id", "=", "n.workspace_id"),
        )
        .select([
          "n.id",
          "n.title",
          "n.message",
          "n.read_at",
          "n.created_at",
          "e.event_type",
          "e.payload",
        ])
        .where("n.workspace_id", "=", ctx.workspaceId)
        .where("n.user_id", "=", ctx.actor.id)
        .orderBy("n.created_at", "desc")
        .limit(100)
        .execute();
      const requests = ctx.permissions.includes("modules.manage")
        ? await tx
            .selectFrom("suite.access_requests")
            .select(["id", "state", "module_id", "reason"])
            .where("workspace_id", "=", ctx.workspaceId)
            .where(
              "id",
              "in",
              notifications
                .filter(
                  (n) =>
                    n.event_type === "access.requested" &&
                    typeof n.payload.recordId === "string" &&
                    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
                      n.payload.recordId,
                    ),
                )
                .map((n) => String(n.payload.recordId))
                .concat("00000000-0000-0000-0000-000000000000"),
            )
            .execute()
        : [];
      return notifications.map((n) => {
        const request =
          n.event_type === "access.requested"
            ? requests.find((r) => r.id === n.payload.recordId)
            : undefined;
        return {
          id: n.id,
          title: n.title,
          message: n.message,
          read: n.read_at !== null,
          createdAt: iso(n.created_at),
          ...(request
            ? {
                action: {
                  kind: "access-request" as const,
                  id: request.id,
                  state: request.state,
                  moduleId: request.module_id,
                  reason: request.reason,
                },
              }
            : {}),
        };
      });
    },
  });
  route("notificationRead", {
    body: Empty,
    response: S.OkSchema,
    handler: async (tx, ctx, req) => {
      found(
        await tx
          .updateTable("suite.notifications")
          .set({ read_at: new Date() })
          .where("workspace_id", "=", ctx.workspaceId)
          .where("user_id", "=", ctx.actor.id)
          .where("id", "=", req.params.id)
          .returning("id")
          .executeTakeFirst(),
      );
      return { ok: true };
    },
  });
  route("audit", {
    response: S.page(S.AuditSchema),
    permission: "audit.read",
    query: true,
    handler: async (tx, ctx, req) => {
      let q = tx
        .selectFrom("suite.audit as a")
        .innerJoin("suite.users as u", "a.actor_id", "u.id")
        .select([
          "a.id",
          "u.name",
          "a.action",
          "a.target_id",
          "a.outcome",
          "a.request_id",
          "a.created_at",
        ])
        .where("a.workspace_id", "=", ctx.workspaceId)
        .orderBy("a.id");
      if (req.query.cursor) q = q.where("a.id", ">", req.query.cursor);
      const limit = req.query.limit ?? 50,
        rows = await q.limit(limit + 1).execute();
      return {
        items: rows.slice(0, limit).map((a) => ({
          id: a.id,
          actorName: a.name,
          action: a.action,
          targetId: a.target_id,
          outcome: a.outcome,
          requestId: a.request_id,
          createdAt: iso(a.created_at),
        })),
        nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      };
    },
  });
  route("exports", {
    hostStorageBridge: false,
    response: T.Array(S.ExportSchema),
    permission: "orders.export",
    module: "orders",
    handler: async (tx, ctx) =>
      (
        await tx
          .selectFrom("suite.exports")
          .selectAll()
          .select(
            sql<string>`case when suite.exports.state='pending' and exists(select 1 from suite.outbox j where j.workspace_id=suite.exports.workspace_id and j.event_type='export.orders' and j.payload->>'recordId'=suite.exports.id::text and j.failed_at is not null) then 'failed' else suite.exports.state end`.as(
              "effective_state",
            ),
          )
          .where("workspace_id", "=", ctx.workspaceId)
          .where("actor_id", "=", ctx.actor.id)
          .orderBy("created_at", "desc")
          .limit(50)
          .execute()
      ).map((e) => ({
        id: e.id,
        state: e.effective_state,
        createdAt: iso(e.created_at),
      })),
  });
  route("exportCreate", {
    hostStorageBridge: false,
    body: Empty,
    response: S.ExportSchema,
    permission: "orders.export",
    module: "orders",
    handler: async (tx, ctx) => {
      const id = randomUUID();
      await tx
        .insertInto("suite.exports")
        .values({
          id,
          workspace_id: ctx.workspaceId,
          actor_id: ctx.actor.id,
          object_key: null,
        })
        .execute();
      await publish(tx, ctx, "export.orders", { recordId: id });
      await audit(tx, ctx, "orders.export_requested", id);
      return { id, state: "pending", createdAt: new Date().toISOString() };
    },
  });
  route("exportDownload", {
    hostStorageBridge: false,
    response: T.Object({ filename: T.String(), content: T.String() }),
    permission: "orders.export",
    module: "orders",
    handler: async (tx, ctx, req) => {
      const exportRow = found(
        await tx
          .selectFrom("suite.exports")
          .selectAll()
          .where("workspace_id", "=", ctx.workspaceId)
          .where("actor_id", "=", ctx.actor.id)
          .where("id", "=", req.params.id)
          .executeTakeFirst(),
      );
      requireCondition(
        exportRow.state === "ready" && exportRow.object_key,
        409,
        "EXPORT_PENDING",
        "This export is not ready.",
      );
      const content = await readExport(exportRow.object_key);
      await audit(tx, ctx, "orders.export_downloaded", exportRow.id);
      return { filename: `orders-${exportRow.id}.csv`, content };
    },
  });
  await registerWorkspacePolicy(app, db, auth);
  await registerPlatform(app, db);
  await registerBilling(app, db, config.origin);
  await app.ready();
  return { app, db, auth, config };
}
