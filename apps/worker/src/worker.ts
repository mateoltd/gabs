import { orderExportRows } from "@suite/orders/server";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  type DB,
  type Tx,
  type Context,
  inWorkspace,
  authorize,
  permissionRecipients,
  requireCondition,
} from "@suite/server-core";
function csv(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export async function writeExport(key: string, content: string) {
  if (process.env.EXPORT_BUCKET) {
    await new S3Client({}).send(
      new PutObjectCommand({
        Bucket: process.env.EXPORT_BUCKET,
        Key: key,
        Body: content,
        ContentType: "text/csv",
        ServerSideEncryption: "AES256",
      }),
    );
    return;
  }
  if (process.env.NODE_ENV === "production")
    throw Error("Private EXPORT_BUCKET is required in production");
  const path = resolve(process.env.EXPORT_DIRECTORY ?? ".local/exports", key);
  await mkdir(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, path);
}
async function exportOrders(tx: Tx, ctx: Context, id: string) {
  const record = await tx
    .selectFrom("suite.exports")
    .selectAll()
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .where("actor_id", "=", ctx.actor.id)
    .executeTakeFirst();
  requireCondition(record, 404, "EXPORT_MISSING", "Export unavailable");
  if (record.state === "ready") return;
  const rows = await orderExportRows(tx, ctx.workspaceId);
  const content =
    "Order,Customer,Status,Total in minor units\r\n" +
    rows
      .map((r) =>
        [r.number, r.name, r.status, r.total_minor].map(csv).join(","),
      )
      .join("\r\n");
  const key = `${ctx.workspaceId}/${id}.csv`;
  await writeExport(key, content);
  await tx
    .updateTable("suite.exports")
    .set({ state: "ready", object_key: key })
    .where("workspace_id", "=", ctx.workspaceId)
    .where("id", "=", id)
    .execute();
}
export async function runBatch(db: DB) {
  const claimed = await sql<{
    id: string;
    workspace_id: string;
    claim_token: string;
  }>`select * from suite.claim_jobs(10)`.execute(db);
  for (const envelope of claimed.rows) {
    try {
      await inWorkspace(db, envelope.workspace_id, async (tx) => {
        const job = await tx
          .selectFrom("suite.outbox")
          .selectAll()
          .where("workspace_id", "=", envelope.workspace_id)
          .where("id", "=", envelope.id)
          .where("claim_token", "=", envelope.claim_token)
          .where("completed_at", "is", null)
          .forUpdate()
          .executeTakeFirst();
        if (!job) return;
        const user = await tx
          .selectFrom("suite.users")
          .selectAll()
          .where("id", "=", job.actor_id)
          .executeTakeFirst();
        if (job.event_type === "export.orders") {
          requireCondition(
            user?.active,
            403,
            "EXPORT_REVOKED",
            "Export actor unavailable",
          );
          const ctx = await authorize(
            tx,
            {
              id: user.id,
              name: user.name,
              email: user.email,
              emailVerified: user.email_verified,
              mfa: true,
            },
            job.workspace_id,
            job.id,
            "orders.export",
            "orders",
          );
          await exportOrders(tx, ctx, String(job.payload.recordId));
        }
        let targets: string[] = [];
        let title = "Workspace activity",
          message = "Your workspace has been updated.";
        if (job.event_type === "module.record.changed") {
          targets = [job.actor_id];
          title = "Module changes accepted";
          message = `Your ${String(job.payload.moduleId)} changes were saved by the server.`;
        }
        if (job.event_type.startsWith("orders.")) {
          targets = [job.actor_id];
          title = `Order ${job.payload.number ?? ""} ${job.event_type.split(".")[1]}`;
          message = "The order and its stock changes were saved together.";
        }
        if (job.event_type === "export.orders") {
          targets = [job.actor_id];
          title = "Order export ready";
          message = "Download your CSV from Orders.";
        }
        if (job.event_type === "access.requested") {
          targets = await permissionRecipients(
            tx,
            job.workspace_id,
            "modules.manage",
          );
          title = "Module access requested";
          message =
            "A member has requested access. Review the request below or in Modules.";
        }
        if (job.event_type === "access.resolved") {
          const m = await tx
            .selectFrom("suite.memberships")
            .select("user_id")
            .where("workspace_id", "=", job.workspace_id)
            .where("id", "=", String(job.payload.membershipId))
            .executeTakeFirst();
          targets = m ? [m.user_id] : [];
          title = `Module access ${job.payload.state}`;
          message = "Your module request has been reviewed.";
        }
        for (const userId of [...new Set(targets)]) {
          const member = await tx
            .selectFrom("suite.memberships as m")
            .innerJoin("suite.users as u", "m.user_id", "u.id")
            .select("m.id")
            .where("m.workspace_id", "=", job.workspace_id)
            .where("m.user_id", "=", userId)
            .where("m.active", "=", true)
            .where("u.active", "=", true)
            .executeTakeFirst();
          if (!member) continue;
          await tx
            .insertInto("suite.notifications")
            .values({
              id: randomUUID(),
              workspace_id: job.workspace_id,
              user_id: userId,
              event_id: job.id,
              title,
              message,
              read_at: null,
            })
            .onConflict((c) => c.columns(["event_id", "user_id"]).doNothing())
            .execute();
        }
        await tx
          .updateTable("suite.outbox")
          .set({ completed_at: new Date(), locked_until: null })
          .where("workspace_id", "=", job.workspace_id)
          .where("id", "=", job.id)
          .where("claim_token", "=", envelope.claim_token)
          .execute();
      });
    } catch (error) {
      await inWorkspace(db, envelope.workspace_id, async (tx) => {
        const job = await tx
          .selectFrom("suite.outbox")
          .selectAll()
          .where("workspace_id", "=", envelope.workspace_id)
          .where("id", "=", envelope.id)
          .where("claim_token", "=", envelope.claim_token)
          .forUpdate()
          .executeTakeFirst();
        if (!job || job.completed_at) return;
        const permanent = [400, 401, 403, 404].includes(
            (error as { status?: number }).status ?? 0,
          ),
          failed = permanent || job.attempts >= 5;
        await tx
          .updateTable("suite.outbox")
          .set({
            locked_until: null,
            last_error: (error as { code?: string }).code ?? "JOB_FAILED",
            failed_at: failed ? new Date() : null,
            available_at: new Date(
              Date.now() + Math.min(3600000, 1000 * 2 ** job.attempts),
            ),
          })
          .where("workspace_id", "=", job.workspace_id)
          .where("id", "=", job.id)
          .where("claim_token", "=", envelope.claim_token)
          .execute();
        if (failed && job.event_type === "export.orders")
          await tx
            .updateTable("suite.exports")
            .set({ state: "failed" })
            .where("workspace_id", "=", job.workspace_id)
            .where("id", "=", String(job.payload.recordId))
            .execute();
      });
    }
  }
  return claimed.rows.length;
}
