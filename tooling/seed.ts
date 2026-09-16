import { seedRegistry } from "./seed-registry";
import { randomUUID } from "node:crypto";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
  authorize,
  assignModules,
} from "../packages/server-core/src/index";
import { createProduct, changeStock } from "../modules/inventory/server/index";
import { createOrder, changeOrder } from "../modules/orders/server/index";
if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
  throw Error("Seed data is restricted to local development and test");
export const DEMO_WORKSPACE = "11111111-1111-4111-8111-111111111111";
export async function seed() {
  const db = connectDatabase();
  try {
    if (!process.env.MIGRATION_DATABASE_URL)
      throw Error("Local registry seeding requires MIGRATION_DATABASE_URL.");
    const registry = connectDatabase(process.env.MIGRATION_DATABASE_URL);
    try {
      await seedRegistry(registry);
    } finally {
      await registry.destroy();
    }
    const owner = await identify(db, {
      issuer: "development",
      subject: "owner",
      email: "owner@demo.local",
      name: "Alex Morgan",
      emailVerified: true,
    });
    const sales = await identify(db, {
      issuer: "development",
      subject: "sales",
      email: "sales@demo.local",
      name: "Sam Rivera",
      emailVerified: true,
    });
    const warehouse = await identify(db, {
      issuer: "development",
      subject: "warehouse",
      email: "warehouse@demo.local",
      name: "Jamie Chen",
      emailVerified: true,
    });
    const viewer = await identify(db, {
      issuer: "development",
      subject: "viewer",
      email: "viewer@demo.local",
      name: "Taylor Kim",
      emailVerified: true,
    });
    await inWorkspace(db, DEMO_WORKSPACE, async (tx) => {
      if (
        await tx
          .selectFrom("suite.workspaces")
          .select("id")
          .where("id", "=", DEMO_WORKSPACE)
          .executeTakeFirst()
      )
        return;
      await provisionWorkspace(tx, {
        id: DEMO_WORKSPACE,
        userId: owner.id,
        name: "Northline Supply",
        kind: "company",
        currency: "EUR",
      });
      await tx
        .updateTable("suite.workspaces")
        .set({ offline_hours: 24 })
        .where("id", "=", DEMO_WORKSPACE)
        .execute();
      for (const [user, roleName] of [
        [sales, "Sales"],
        [warehouse, "Warehouse"],
        [viewer, "Viewer"],
      ] as const) {
        const id = randomUUID();
        const role = await tx
          .selectFrom("suite.roles")
          .select("id")
          .where("workspace_id", "=", DEMO_WORKSPACE)
          .where("name", "=", roleName)
          .executeTakeFirstOrThrow();
        await tx
          .insertInto("suite.memberships")
          .values({ id, workspace_id: DEMO_WORKSPACE, user_id: user.id })
          .execute();
        await tx
          .insertInto("suite.role_assignments")
          .values({
            workspace_id: DEMO_WORKSPACE,
            membership_id: id,
            role_id: role.id,
          })
          .execute();
        await assignModules(tx, DEMO_WORKSPACE, id, ["orders", "inventory"]);
      }
      const ctx = await authorize(
        tx,
        {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          emailVerified: true,
          mfa: true,
        },
        DEMO_WORKSPACE,
        "seed",
      );
      const products = [];
      for (const [sku, name, price, quantity] of [
        ["NL-101", "Field notebook", 1800, 124],
        ["NL-102", "Canvas tool roll", 4800, 38],
        ["NL-103", "Brass desk tray", 6200, 16],
        ["NL-104", "Utility tote", 3400, 72],
        ["NL-105", "Studio scissors", 2900, 8],
        ["NL-106", "Workshop apron", 5600, 45],
        ["NL-107", "Oak pencil holder", 2400, 6],
        ["NL-108", "Measuring tape", 1600, 92],
      ] as const) {
        const product = await createProduct(tx, ctx, {
          sku,
          name,
          priceMinor: price,
        });
        await changeStock(tx, ctx, product.id, {
          kind: "receipt",
          quantity,
          reason: "Opening stock",
        });
        products.push(product);
      }
      for (const [i, customer] of [
        "Form & Field",
        "Studio Fern",
        "Common Ground",
        "Atelier Nord",
        "Pine Workshop",
        "The Good Store",
      ].entries()) {
        const p = products[i],
          q = products[(i + 2) % products.length];
        let order = await createOrder(tx, ctx, {
          customerName: customer,
          lines: [
            { productId: p.id, quantity: i + 2, priceMinor: p.priceMinor },
            { productId: q.id, quantity: 2, priceMinor: q.priceMinor },
          ],
        });
        if (i < 4)
          order = await changeOrder(
            tx,
            ctx,
            order.id,
            "confirm",
            `"${order.version}"`,
          );
        if (i < 2)
          await changeOrder(tx, ctx, order.id, "fulfill", `"${order.version}"`);
      }
    });
    console.log(
      "Demo ready: owner@demo.local, sales@demo.local, warehouse@demo.local, viewer@demo.local",
    );
  } finally {
    await db.destroy();
  }
}
await seed();
