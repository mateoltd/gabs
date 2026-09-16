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
  const counts = await restored.query(
    "SELECT (SELECT count(*) FROM suite.workspaces) workspaces,(SELECT count(*) FROM suite.orders) orders,(SELECT count(*) FROM suite.stock_movements) movements,(SELECT count(*) FROM suite.module_storage) module_schemas,(SELECT count(*) FROM suite.module_migrations) module_migrations",
  );
  const role = await restored.connect();
  try {
    await role.query("BEGIN");
    await role.query("SET LOCAL ROLE suite_app");
    const hidden = await role.query("SELECT * FROM suite.orders");
    if (hidden.rowCount) throw Error("Unscoped restored RLS leaked orders");
    for (const table of ["module_storage", "module_migrations"]) {
      const hidden = await role.query(`SELECT * FROM suite.${table}`);
      if (hidden.rowCount)
        throw Error("Unscoped restored RLS leaked module schemas");
    }
    await role.query("ROLLBACK");
  } finally {
    role.release();
  }
  const report = {
    recordedAt: new Date().toISOString(),
    method: "Local logical pg_dump/pg_restore into an isolated database",
    durationSeconds: Math.round((Date.now() - start) / 1000),
    dumpBytes: dump.length,
    counts: counts.rows[0],
    invariants: { ...invariant.rows[0], ...migrationInvariant.rows[0] },
    rls: "Unscoped application role sees no orders, module schemas or migration history",
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
