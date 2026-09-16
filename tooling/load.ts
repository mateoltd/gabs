import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { createApp } from "../apps/api/src/app";
import {
  identify,
  inWorkspace,
  provisionWorkspace,
  authorize,
  connectDatabase,
} from "../packages/server-core/src";
import { createModuleClient } from "@suite/module-sdk";
import { executeModuleOperation } from "../packages/server-core/src/module-services";
import { moduleServers } from "@suite/module-catalog/server";
import inventory from "../modules/inventory/module";
import ordersDefinition from "../modules/orders/module";
import { createLoadDiagnostics } from "./load-diagnostics";
if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
  throw Error("Load fixtures are restricted to local development and test.");
const profileConfirmations = process.argv.includes("--profile-confirmations");
const diagnostics =
  process.argv.includes("--profile") || profileConfirmations
    ? createLoadDiagnostics(profileConfirmations ? "confirmations" : "reads")
    : undefined;
const { app, db, auth } = await createApp({
    db: connectDatabase(undefined, diagnostics?.log),
  }),
  workspace = randomUUID();
try {
  const user = await identify(db, {
    issuer: "load",
    subject: randomUUID(),
    email: "load@test.local",
    name: "Load test",
    emailVerified: true,
  });
  const orders = await inWorkspace(db, workspace, async (tx) => {
    await provisionWorkspace(tx, {
      id: workspace,
      userId: user.id,
      name: "Performance fixture",
      kind: "company",
    });
    const ctx = await authorize(
      tx,
      {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        mfa: true,
      },
      workspace,
      randomUUID(),
    );
    const stock = createModuleClient(inventory, (call) =>
      executeModuleOperation(
        tx,
        ctx,
        inventory,
        call.operation!,
        call.input,
        moduleServers,
      ),
    );
    const sales = createModuleClient(ordersDefinition, (call) =>
      executeModuleOperation(
        tx,
        ctx,
        ordersDefinition,
        call.operation!,
        call.input,
        moduleServers,
      ),
    );
    const product = await stock.call("create-product", {
      sku: "LOAD",
      name: "Load product",
      priceMinor: 1250,
    });
    await stock.call("receipt", {
      id: product.id,
      quantity: 2000,
      reason: "Performance fixture",
    });
    const rows = [];
    for (let i = 0; i < 1000; i++)
      rows.push(
        await sales.call("draft", {
          customerName: `Load customer ${i}`,
          lines: [{ productId: product.id, quantity: 1, priceMinor: 1250 }],
        }),
      );
    return rows;
  });
  const session = await auth.issue(user.id, true),
    origin = await app.listen({ port: 0, host: "127.0.0.1" }),
    headers = {
      cookie: `suite_session=${session.token}`,
      origin: process.env.APP_ORIGIN!,
      "x-csrf-token": session.csrfToken,
    };
  const sample = async (path: string, init: RequestInit = {}) => {
    const start = performance.now(),
      r = await fetch(
        `${origin}${path.startsWith("/api/") ? path : `/api/v1/workspaces/${workspace}${path}`}`,
        {
          ...init,
          headers: { ...headers, ...init.headers },
        },
      );
    await r.arrayBuffer();
    if (!r.ok) throw Error(`Load request failed ${r.status}`);
    return performance.now() - start;
  };
  await sample("/orders");
  if (!profileConfirmations) await diagnostics?.start();
  const reads = await Promise.all(
    Array.from({ length: 50 }, () => sample("/orders")),
  );
  if (!profileConfirmations) await diagnostics?.stop();
  else await diagnostics?.start();
  const confirmations = await Promise.all(
    orders.slice(0, 50).map((o) =>
      sample(
        `/api/v1/module/orders/workspaces/${workspace}/operations/confirm`,
        {
          method: "POST",
          body: JSON.stringify({ id: o.id, version: o.version }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
            "x-module-version": ordersDefinition.version,
          },
        },
      ),
    ),
  );
  if (profileConfirmations) await diagnostics?.stop();
  const p95 = (v: number[]) =>
    Math.round([...v].sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1]);
  const report = {
    diagnostic: Boolean(diagnostics),
    recordedAt: new Date().toISOString(),
    dataset: { orders: 1000, linesPerOrder: 1, products: 1 },
    businessBackend: "scoped-sdk",
    moduleVersions: {
      orders: ordersDefinition.version,
      inventory: inventory.version,
    },
    clients: 50,
    samplesPerOperation: 50,
    transport:
      "HTTP loopback, 50 concurrent clients, one shared authorized actor, same stock record",
    node: process.version,
    host: {
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0].model,
      cores: cpus().length,
      memoryGiB: Math.round(totalmem() / 1024 ** 3),
    },
    database: "PostgreSQL 18.6 in local Docker; pool max 20",
    p95Ms: { ordersRead: p95(reads), orderConfirmation: p95(confirmations) },
    targetsMs: { ordersRead: 500, orderConfirmation: 1000 },
  };
  const directory = diagnostics?.directory ?? "docs/verification";
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/load.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.p95Ms.ordersRead >= 500 || report.p95Ms.orderConfirmation >= 1000)
    process.exitCode = 1;
} finally {
  try {
    await diagnostics?.stop();
  } finally {
    await app.close();
    await db.destroy();
  }
}
