import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  IntegrityReportSchema,
  type IntegrityReport,
  type IntegrityPage,
} from "@suite/contracts";
import { assertSchema } from "@suite/module-sdk";
import type { Tx } from "../persistence/database";
import type { Context } from "./authorization";
import { audit } from "../persistence/transactions";
import { requireCondition } from "../errors";

export async function recordIntegrityReport(
  tx: Tx,
  ctx: Context,
  input: IntegrityReport,
) {
  assertSchema(IntegrityReportSchema, input);
  requireCondition(
    input.accountId.toLowerCase() === ctx.actor.id.toLowerCase(),
    403,
    "REPORT_ACCOUNT_CHANGED",
    "Use the account that captured this observation.",
  );
  // UUID spellings must have one deduplication identity and one canonical payload.
  const report = {
    ...input,
    accountId: ctx.actor.id,
    deviceId: input.deviceId.toLowerCase(),
    incidentId: input.incidentId.toLowerCase(),
  };
  const inserted = await tx
    .insertInto("suite.integrity_reports")
    .values({
      id: randomUUID(),
      workspace_id: ctx.workspaceId,
      user_id: ctx.actor.id,
      device_id: report.deviceId,
      incident_id: report.incidentId,
      event: report.event,
      payload: report,
      occurred_at: report.occurredAt,
    })
    .onConflict((oc) =>
      oc
        .columns([
          "workspace_id",
          "user_id",
          "device_id",
          "incident_id",
          "event",
        ])
        .doNothing(),
    )
    .returning(["id", "received_at"])
    .executeTakeFirst();
  if (inserted) {
    await audit(
      tx,
      ctx,
      `desktop.integrity.${report.event}.reported`,
      inserted.id,
    );
    return { id: inserted.id, receivedAt: inserted.received_at.toISOString() };
  }
  const previous = await tx
    .selectFrom("suite.integrity_reports")
    .select(["id", "received_at"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("user_id", "=", ctx.actor.id)
    .where("device_id", "=", report.deviceId)
    .where("incident_id", "=", report.incidentId)
    .where("event", "=", report.event)
    .where(sql<boolean>`payload = ${JSON.stringify(report)}::jsonb`)
    .executeTakeFirst();
  requireCondition(
    previous,
    409,
    "INTEGRITY_REPORT_CHANGED",
    "This event was already received with different metadata.",
  );
  return { id: previous.id, receivedAt: previous.received_at.toISOString() };
}
export async function integrityReports(
  tx: Tx,
  ctx: Context,
  cursor?: string,
): Promise<IntegrityPage> {
  requireCondition(
    ctx.permissions.includes("audit.read"),
    403,
    "FORBIDDEN",
    "Audit permission is required.",
  );
  const summary = (
    await sql<IntegrityPage["summary"]>`select count(*)::int as reports,
    count(*) filter(where r.event='locked' and not exists(
      select 1 from suite.integrity_reports recovered where recovered.workspace_id=r.workspace_id and recovered.user_id=r.user_id
      and recovered.device_id=r.device_id and recovered.incident_id=r.incident_id and recovered.event='recovered'
    ))::int as "unresolvedReportedIncidents",
    count(*) filter(where r.received_at >= now()-interval '1 day')::int as "receivedLastDay",
    coalesce(max(greatest(0,extract(epoch from r.received_at-r.occurred_at))),0)::double precision as "maximumDeliveryDelaySeconds"
    from suite.integrity_reports r where r.workspace_id=${ctx.workspaceId}::uuid`.execute(
      tx,
    )
  ).rows[0];
  let query = tx
    .selectFrom("suite.integrity_reports as r")
    .innerJoin("suite.users as u", "u.id", "r.user_id")
    .select(["r.id", "r.received_at", "r.payload", "u.name"])
    .where("r.workspace_id", "=", ctx.workspaceId)
    .orderBy("r.id");
  if (cursor) query = query.where("r.id", ">", cursor);
  const rows = await query.limit(51).execute();
  return {
    summary,
    items: rows.slice(0, 50).map((row) => ({
      id: row.id,
      receivedAt: row.received_at.toISOString(),
      reporterName: row.name,
      report: row.payload,
      source: "client-report",
    })),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  };
}
