import { randomUUID } from "node:crypto";
import { Pool } from "pg";
const [workspace, moduleId, enabled, seats, reason] = process.argv.slice(2);
if (
  !/^[a-f0-9-]{36}$/i.test(workspace ?? "") ||
  !["inventory", "orders"].includes(moduleId) ||
  !["true", "false"].includes(enabled) ||
  !/^\d+$/.test(seats ?? "") ||
  Number(seats) < 1 ||
  !reason?.trim()
)
  throw Error(
    "Usage: pnpm entitlement <workspace UUID> <inventory|orders> <true|false> <seat limit> <reason>",
  );
if (!process.env.OPERATOR_DATABASE_URL)
  throw Error(
    "OPERATOR_DATABASE_URL is required; never give this credential to API or clients.",
  );
if (!process.env.OPERATOR_USER_ID)
  throw Error(
    "OPERATOR_USER_ID must identify the human operator for audit attribution.",
  );
const db = new Pool({ connectionString: process.env.OPERATOR_DATABASE_URL });
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.workspace_id',$1,true)", [
    workspace,
  ]);
  const current = await client.query(
    "SELECT owner_user_id FROM suite.workspaces WHERE id=$1 FOR UPDATE",
    [workspace],
  );
  if (!current.rowCount) throw Error("Workspace not found");
  const used = await client.query(
    "SELECT count(*) FROM suite.memberships WHERE workspace_id=$1 AND active",
    [workspace],
  );
  if (Number(used.rows[0].count) > Number(seats))
    throw Error(
      "Seat allowance cannot be below current active membership count.",
    );
  await client.query(
    "UPDATE suite.entitlements SET active=$3 WHERE workspace_id=$1 AND module_id=$2",
    [workspace, moduleId, enabled === "true"],
  );
  await client.query("UPDATE suite.workspaces SET seat_limit=$2 WHERE id=$1", [
    workspace,
    Number(seats),
  ]);
  await client.query(
    "INSERT INTO suite.audit(id,workspace_id,actor_id,action,target_id,outcome,request_id) VALUES($1,$2,$3,'operator.entitlement',$4,'success',$5)",
    [
      randomUUID(),
      workspace,
      process.env.OPERATOR_USER_ID,
      `${moduleId}: ${reason}`,
      `operator:${randomUUID()}`,
    ],
  );
  await client.query("COMMIT");
  console.log(
    `Entitlement ${moduleId} set to ${enabled}; ${seats} seats. Operator reason: ${reason}`,
  );
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await db.end();
}
