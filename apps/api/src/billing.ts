import Stripe from "stripe";
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { Type as T } from "@suite/contracts";
import {
  inWorkspace,
  authorize,
  audit,
  lockWorkspace,
  lockKey,
  requireCondition,
  type DB,
  type Tx,
  type ServerRuntime,
} from "@suite/server-core";
const params = T.Object({ workspaceId: T.String({ format: "uuid" }) });
export function billingPrices(): Record<string, string> {
  const values = JSON.parse(process.env.STRIPE_MODULE_PRICES ?? "{}") as Record<
    string,
    unknown
  >;
  if (
    Object.values(values).some(
      (v) => typeof v !== "string" || !v.startsWith("price_"),
    )
  )
    throw Error("Invalid Stripe price configuration.");
  return values as Record<string, string>;
}
export async function applySubscription(
  tx: Tx,
  workspaceId: string,
  subscription: {
    id: string;
    status: string;
    items: { data: { price: { id: string }; quantity?: number | null }[] };
  },
  prices: Record<string, string>,
) {
  const active = ["active", "trialing"].includes(subscription.status);
  const quantities = new Map(
    subscription.items.data.map((i) => [i.price.id, i.quantity ?? 0]),
  );
  for (const [moduleId, price] of Object.entries(prices)) {
    await tx
      .insertInto("suite.entitlements")
      .values({
        workspace_id: workspaceId,
        module_id: moduleId,
        active: active && (quantities.get(price) ?? 0) > 0,
        seat_limit: quantities.get(price) ?? 0,
      })
      .onConflict((oc) =>
        oc.columns(["workspace_id", "module_id"]).doUpdateSet({
          active: active && (quantities.get(price) ?? 0) > 0,
          seat_limit: quantities.get(price) ?? 0,
        }),
      )
      .execute();
  }
  // When seats shrink, retain the oldest active assignments. Business data is preserved.
  for (const [moduleId, price] of Object.entries(prices)) {
    const allowed = active ? (quantities.get(price) ?? 0) : 0;
    await sql`delete from suite.module_assignments where workspace_id=${workspaceId}::uuid and module_id=${moduleId} and membership_id not in (select a.membership_id from suite.module_assignments a join suite.memberships m on m.workspace_id=a.workspace_id and m.id=a.membership_id where a.workspace_id=${workspaceId}::uuid and a.module_id=${moduleId} and m.active order by m.created_at,m.id limit ${allowed})`.execute(
      tx,
    );
  }
  const seats = Math.max(
    1,
    ...subscription.items.data.map((i) => i.quantity ?? 0),
  );
  await tx
    .updateTable("suite.workspaces")
    .set({ seat_limit: seats })
    .where("id", "=", workspaceId)
    .execute();
  await tx
    .updateTable("suite.billing_accounts")
    .set({
      subscription_id: subscription.id,
      status: subscription.status,
      updated_at: new Date(),
    })
    .where("workspace_id", "=", workspaceId)
    .execute();
}
export async function registerBilling(
  app: FastifyInstance,
  db: DB,
  origin: string,
  runtime: ServerRuntime,
) {
  const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, {
        maxNetworkRetries: 2,
        timeout: 15000,
      })
    : undefined;
  app.get<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId/billing",
    { schema: { operationId: "billingState", params } },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          runtime,
          "billing.manage",
          undefined,
        );
        const account = await tx
          .selectFrom("suite.billing_accounts")
          .select(["status", "subscription_id"])
          .where("workspace_id", "=", ctx.workspaceId)
          .executeTakeFirst();
        return {
          configured: !!stripe && !!process.env.STRIPE_WEBHOOK_SECRET,
          modules: Object.keys(billingPrices()),
          status: account?.status ?? "none",
          subscribed: !!account?.subscription_id,
        };
      }),
  );
  app.post<{
    Params: { workspaceId: string };
    Body: {
      action: "checkout" | "portal" | "reconcile";
      modules?: string[];
      seats?: number;
    };
  }>(
    "/api/v1/workspaces/:workspaceId/billing",
    {
      schema: {
        operationId: "billingCommand",
        params,
        body: T.Object(
          {
            action: T.Union(
              ["checkout", "portal", "reconcile"].map((v) => T.Literal(v)),
            ),
            modules: T.Optional(
              T.Array(T.String({ maxLength: 64 }), {
                maxItems: 100,
                uniqueItems: true,
              }),
            ),
            seats: T.Optional(T.Integer({ minimum: 1, maximum: 100000 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) => {
      requireCondition(
        stripe && process.env.STRIPE_WEBHOOK_SECRET,
        503,
        "BILLING_UNCONFIGURED",
        "Billing is not configured for this deployment.",
      );
      return inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          runtime,
          "billing.manage",
          undefined,
        );
        await lockWorkspace(tx, ctx.workspaceId);
        const key = req.headers["idempotency-key"];
        requireCondition(
          typeof key === "string" && key.length >= 8 && key.length <= 128,
          400,
          "IDEMPOTENCY_REQUIRED",
          "Provide an idempotency key.",
        );
        let account = await tx
          .selectFrom("suite.billing_accounts")
          .selectAll()
          .where("workspace_id", "=", ctx.workspaceId)
          .executeTakeFirst();
        if (!account) {
          const customer = await stripe.customers.create(
            { metadata: { workspaceId: ctx.workspaceId } },
            { idempotencyKey: `customer:${ctx.workspaceId}` },
          );
          account = await tx
            .insertInto("suite.billing_accounts")
            .values({
              workspace_id: ctx.workspaceId,
              customer_id: customer.id,
              subscription_id: null,
              status: "pending",
              last_event_at: 0,
              updated_at: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        }
        if (req.body.action === "reconcile") {
          requireCondition(
            account.subscription_id,
            409,
            "NO_SUBSCRIPTION",
            "No subscription has been linked yet.",
          );
          const subscription = await stripe.subscriptions.retrieve(
            account.subscription_id,
          );
          await applySubscription(
            tx,
            ctx.workspaceId,
            subscription,
            billingPrices(),
          );
          await audit(tx, ctx, "billing.reconciled", subscription.id);
          return { ok: true };
        }
        if (req.body.action === "portal")
          return {
            url: (
              await stripe.billingPortal.sessions.create(
                {
                  customer: account.customer_id,
                  return_url: origin + "/settings",
                },
                { idempotencyKey: `${ctx.workspaceId}:${key}` },
              )
            ).url,
          };
        requireCondition(
          !account.subscription_id ||
            ["canceled", "incomplete_expired"].includes(account.status),
          409,
          "SUBSCRIPTION_EXISTS",
          "Manage the existing subscription in the billing portal.",
        );
        const modules = [
          ...new Set(
            (req.body.modules ?? []).flatMap((id) => {
              requireCondition(
                runtime.catalog.definition(id),
                400,
                "INVALID_MODULE",
                "Unknown module.",
              );
              return runtime.catalog.dependencies(id);
            }),
          ),
        ];
        const prices = billingPrices();
        requireCondition(
          modules.length && modules.every((id) => prices[id]),
          400,
          "PRICE_UNAVAILABLE",
          "Every module and dependency needs a configured price.",
        );
        const seats = req.body.seats ?? 1;
        const session = await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer: account.customer_id,
            client_reference_id: ctx.workspaceId,
            line_items: modules.map((id) => ({
              price: prices[id],
              quantity: seats,
            })),
            success_url: origin + "/settings?billing=returned",
            cancel_url: origin + "/settings",
            subscription_data: { metadata: { workspaceId: ctx.workspaceId } },
          },
          { idempotencyKey: `${ctx.workspaceId}:${key}` },
        );
        await audit(tx, ctx, "billing.checkout_started", session.id);
        return { url: session.url };
      });
    },
  );
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );
    scope.post(
      "/api/v1/billing/webhook",
      { config: { public: true }, schema: { hide: true } },
      async (req) => {
        requireCondition(
          stripe && process.env.STRIPE_WEBHOOK_SECRET,
          503,
          "BILLING_UNCONFIGURED",
          "Billing is not configured.",
        );
        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(
            req.body as Buffer,
            req.headers["stripe-signature"] as string,
            process.env.STRIPE_WEBHOOK_SECRET,
          );
        } catch {
          requireCondition(
            false,
            400,
            "INVALID_SIGNATURE",
            "Invalid webhook signature.",
          );
        }
        const object = event.data.object as unknown as {
          customer?: string | { id: string };
          id: string;
          object: string;
          subscription?: string;
        };
        const customerId =
          typeof object.customer === "string"
            ? object.customer
            : object.customer?.id;
        if (!customerId) return { received: true };
        // Lookup contains no tenant data; the function returns only the routing workspace ID.
        const lookup = await db
          .selectFrom("suite.billing_routes")
          .select("workspace_id")
          .where("customer_id", "=", customerId)
          .executeTakeFirst();
        if (!lookup) return { received: true };
        await inWorkspace(db, lookup.workspace_id, async (tx) => {
          await lockKey(tx, `billing-event:${event.id}`);
          const seen = await tx
            .selectFrom("suite.billing_events")
            .select("id")
            .where("id", "=", event.id)
            .executeTakeFirst();
          if (seen) return;
          await lockWorkspace(tx, lookup.workspace_id);
          const account = await tx
            .selectFrom("suite.billing_accounts")
            .selectAll()
            .where("workspace_id", "=", lookup.workspace_id)
            .executeTakeFirstOrThrow();
          const subscriptionId =
            object.object === "subscription"
              ? object.id
              : (object.subscription ?? account.subscription_id);
          if (subscriptionId) {
            // An old subscription event must not replace a newer active subscription.
            if (
              account.subscription_id &&
              account.subscription_id !== subscriptionId &&
              ["active", "trialing", "past_due"].includes(account.status)
            ) {
              await tx
                .insertInto("suite.billing_events")
                .values({ id: event.id, type: event.type })
                .execute();
              return;
            }
            const subscription =
              await stripe.subscriptions.retrieve(subscriptionId);
            if (
              typeof subscription.customer === "string"
                ? subscription.customer !== customerId
                : subscription.customer.id !== customerId
            )
              throw Error("Subscription customer mismatch.");
            await applySubscription(
              tx,
              lookup.workspace_id,
              subscription,
              billingPrices(),
            );
          }
          await tx
            .insertInto("suite.billing_events")
            .values({ id: event.id, type: event.type })
            .execute();
        });
        return { received: true };
      },
    );
  });
}
