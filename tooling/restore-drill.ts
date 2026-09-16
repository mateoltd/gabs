import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { Pool } from "pg";
if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
  throw Error("This drill is restricted to the local Docker database.");
const url = new URL(process.env.MIGRATION_DATABASE_URL!);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.port !== "54329" ||
  url.pathname !== "/suite"
)
  throw Error("Expected the local suite database on port 54329.");
const name = "suite_restore_" + randomUUID().replaceAll("-", ""),
  admin = new Pool({ connectionString: url.href }),
  start = Date.now();
let restored: Pool | undefined;
let retiredStorageFence = false;
try {
  const dump = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      "suite",
      "-Fc",
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  await admin.query(`CREATE DATABASE ${name}`);
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "-U",
      "postgres",
      "-d",
      name,
      "--exit-on-error",
    ],
    { input: dump, maxBuffer: 10 * 1024 * 1024 },
  );
  url.pathname = "/" + name;
  restored = new Pool({ connectionString: url.href });
  const invariant = await restored.query(
    `SELECT (SELECT count(*) FROM suite.stock WHERE reserved<0 OR reserved>on_hand) AS invalid_balances,(SELECT count(*) FROM suite.stock s WHERE s.reserved <> COALESCE((SELECT sum(l.quantity) FROM suite.order_lines l JOIN suite.orders o ON (o.workspace_id,o.id)=(l.workspace_id,l.order_id) WHERE l.workspace_id=s.workspace_id AND l.product_id=s.product_id AND o.status='confirmed'),0)) AS invalid_reservations,(SELECT count(*) FROM suite.stock s WHERE (s.on_hand,s.reserved)<>(SELECT coalesce(sum(m.on_hand_delta),0),coalesce(sum(m.reserved_delta),0) FROM suite.stock_movements m WHERE m.workspace_id=s.workspace_id AND m.product_id=s.product_id)) AS ledger_mismatches`,
  );
  if (Object.values(invariant.rows[0]).some((v) => Number(v) !== 0))
    throw Error("Restored business invariants failed");
  const migrationInvariant = await restored.query(
    `SELECT count(*) AS invalid_schema_history FROM suite.module_migrations m
     LEFT JOIN suite.module_storage s USING(workspace_id,module_id)
     WHERE s.schema_version IS NULL OR s.schema_version < m.to_version`,
  );
  if (Number(migrationInvariant.rows[0].invalid_schema_history) !== 0)
    throw Error("Restored module schema history is inconsistent");
  const sdkInvariant = await restored.query(`
    WITH migrated AS (SELECT workspace_id FROM suite.platform_settings WHERE key='business-storage-import' AND value->>'state'='completed'),
    scoped AS (SELECT workspace_id FROM migrated UNION SELECT a.workspace_id FROM suite.audit a JOIN suite.module_storage s ON s.workspace_id=a.workspace_id AND s.module_id=a.target_id WHERE a.action='modules.storage.initialized' AND s.module_id IN ('inventory','orders') AND s.schema_version>=2),
    products AS (SELECT r.* FROM suite.module_records r JOIN scoped USING(workspace_id) WHERE module_id='inventory' AND resource='$products' AND NOT archived),
    movements AS (SELECT r.workspace_id,(data->>'productId')::uuid AS product_id,sum((data->>'onHandDelta')::bigint) AS on_hand,sum((data->>'reservedDelta')::bigint) AS reserved FROM suite.module_records r JOIN scoped USING(workspace_id) WHERE module_id='inventory' AND resource='$movements' AND NOT archived GROUP BY r.workspace_id,data->>'productId'),
    reservations AS (SELECT r.* FROM suite.module_records r JOIN scoped USING(workspace_id) WHERE module_id='inventory' AND resource='$reservations' AND NOT archived),
    reserved AS (SELECT r.workspace_id,(line->>'productId')::uuid AS product_id,sum((line->>'quantity')::bigint) AS quantity FROM reservations r CROSS JOIN LATERAL jsonb_array_elements(data->'lines') line WHERE data->>'state'='reserved' GROUP BY r.workspace_id,line->>'productId'),
    orders AS (SELECT r.* FROM suite.module_records r JOIN scoped USING(workspace_id) WHERE module_id='orders' AND resource='$orders' AND NOT archived)
    SELECT
      (SELECT count(*) FROM products WHERE (data->>'reserved')::bigint<0 OR (data->>'reserved')::bigint>(data->>'onHand')::bigint OR (data->>'available')::bigint<>(data->>'onHand')::bigint-(data->>'reserved')::bigint) AS sdk_invalid_balances,
      (SELECT count(*) FROM products p LEFT JOIN movements m ON (m.workspace_id,m.product_id)=(p.workspace_id,p.id) WHERE (p.data->>'onHand')::bigint<>coalesce(m.on_hand,0) OR (p.data->>'reserved')::bigint<>coalesce(m.reserved,0)) AS sdk_ledger_mismatches,
      (SELECT count(*) FROM products p LEFT JOIN reserved r ON (r.workspace_id,r.product_id)=(p.workspace_id,p.id) WHERE (p.data->>'reserved')::bigint<>coalesce(r.quantity,0)) AS sdk_invalid_reservations,
      (SELECT count(*) FROM orders o LEFT JOIN reservations r ON (r.workspace_id,r.id)=(o.workspace_id,o.id) AND r.data->>'sourceModule'='orders'
       WHERE (o.data->>'totalMinor')::bigint<>(SELECT coalesce(sum((line->>'quantity')::bigint*(line->>'priceMinor')::bigint),0) FROM jsonb_array_elements(o.data->'lines') line)
       OR (o.data->>'status'='confirmed' AND coalesce(r.data->>'state','missing')<>'reserved')
       OR (o.data->>'status'='fulfilled' AND coalesce(r.data->>'state','missing')<>'consumed')
       OR (o.data->>'status'='cancelled' AND r.id IS NOT NULL AND r.data->>'state'<>'released')
       OR (o.data->>'status'='draft' AND r.id IS NOT NULL)) AS sdk_invalid_orders,
      (SELECT count(*) FROM scoped m LEFT JOIN suite.module_records c ON c.workspace_id=m.workspace_id AND c.module_id='orders' AND c.resource='$counters' AND c.id='00000000-0000-4000-8000-000000000001'
       WHERE (c.id IS NULL AND (EXISTS(SELECT 1 FROM orders o WHERE o.workspace_id=m.workspace_id) OR EXISTS(SELECT 1 FROM migrated original WHERE original.workspace_id=m.workspace_id)))
       OR (c.id IS NOT NULL AND (c.archived OR c.data->>'next' IS NULL OR (c.data->>'next')::bigint<=coalesce((SELECT max((o.data->>'number')::bigint) FROM orders o WHERE o.workspace_id=m.workspace_id),0)))) AS sdk_invalid_counters`);
  if (Object.values(sdkInvariant.rows[0]).some((v) => Number(v) !== 0))
    throw Error("Restored SDK business invariants failed");
  const counts = await restored.query(
    "SELECT (SELECT count(*) FROM suite.workspaces) workspaces,(SELECT count(*) FROM suite.orders) orders,(SELECT count(*) FROM suite.stock_movements) movements,(SELECT count(*) FROM suite.module_storage) module_schemas,(SELECT count(*) FROM suite.module_migrations) module_migrations,(SELECT count(*) FROM suite.platform_settings WHERE key='business-storage-import' AND value->>'state'='completed') sdk_migrated_workspaces,(SELECT count(DISTINCT a.workspace_id) FROM suite.audit a JOIN suite.module_storage s ON s.workspace_id=a.workspace_id AND s.module_id=a.target_id WHERE a.action='modules.storage.initialized' AND s.module_id IN ('inventory','orders') AND s.schema_version>=2) sdk_initialized_workspaces",
  );
  const role = await restored.connect();
  try {
    await role.query("BEGIN");
    await role.query("SET LOCAL ROLE suite_app");
    const hidden = await role.query("SELECT * FROM suite.orders");
    if (hidden.rowCount) throw Error("Unscoped restored RLS leaked orders");
    for (const table of [
      "module_storage",
      "module_migrations",
      "module_records",
    ]) {
      const hidden = await role.query(`SELECT * FROM suite.${table}`);
      if (hidden.rowCount)
        throw Error("Unscoped restored RLS leaked module schemas");
    }
    await role.query("ROLLBACK");
    const migrated = await restored.query(
      "SELECT p.workspace_id,p.id FROM suite.products p JOIN suite.platform_settings s ON s.workspace_id=p.workspace_id WHERE s.key='business-storage-import' AND s.value->>'state'='completed' LIMIT 1",
    );
    if (migrated.rowCount) {
      await role.query("BEGIN");
      try {
        await role.query("SET LOCAL ROLE suite_app");
        await role.query("SELECT set_config('app.workspace_id',$1,true)", [
          migrated.rows[0].workspace_id,
        ]);
        try {
          await role.query(
            "UPDATE suite.products SET name=name WHERE workspace_id=$1 AND id=$2",
            [migrated.rows[0].workspace_id, migrated.rows[0].id],
          );
          throw Error("Restored legacy storage fence allowed a write");
        } catch (error) {
          if ((error as { code?: string }).code !== "55000") throw error;
          retiredStorageFence = true;
        }
      } finally {
        await role.query("ROLLBACK");
      }
    }
  } finally {
    role.release();
  }
  const report = {
    recordedAt: new Date().toISOString(),
    method: "Local logical pg_dump/pg_restore into an isolated database",
    durationSeconds: Math.round((Date.now() - start) / 1000),
    dumpBytes: dump.length,
    counts: counts.rows[0],
    invariants: {
      ...invariant.rows[0],
      ...migrationInvariant.rows[0],
      ...sdkInvariant.rows[0],
    },
    retiredStorageFence,
    rls: "Unscoped application role sees no orders, module schemas, migration history or private records",
    limitation:
      "This verifies logical recovery locally. Managed PITR, offsite backup retention and infrastructure recovery require a staging exercise.",
  };
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/restore.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await restored?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}
