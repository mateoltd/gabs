import { sql } from "kysely";
import { assertSchema } from "@suite/module-sdk";
import {
  InstallationReportSchema,
  type InstallationReport,
  type ModuleFleet,
} from "@suite/module-sdk/platform";
import type { Tx } from "./database";
import type { Context } from "./authorization";
import { found, requireCondition } from "./errors";
import { workspaceModule } from "./module-releases";

export async function recordInstallationReport(
  tx: Tx,
  ctx: Context,
  report: InstallationReport,
) {
  assertSchema(InstallationReportSchema, report);
  const action = report.action ?? "install";
  requireCondition(
    !report.accountId || report.accountId === ctx.actor.id,
    403,
    "REPORT_ACCOUNT_CHANGED",
    "Sign in with the account that recorded this observation.",
  );
  requireCondition(
    !(
      action === "uninstall" &&
      ["planning", "downloading", "ready"].includes(report.phase)
    ) &&
      !(action === "install" && report.phase === "removed") &&
      !(report.phase === "ready" && !report.version),
    400,
    "INVALID_REPORT_PHASE",
    "The report phase does not match its action.",
  );
  let release = tx
    .selectFrom("suite.module_releases")
    .select("version")
    .where("module_id", "=", report.moduleId);
  if (report.version) release = release.where("version", "=", report.version);
  found(await release.executeTakeFirst());
  if (report.phase === "ready" || report.phase === "removed") {
    const receipt = await tx
      .selectFrom("suite.module_installations")
      .select(["receipt_id", "version", "state"])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("user_id", "=", ctx.actor.id)
      .where("module_id", "=", report.moduleId)
      .where("device_id", "=", report.deviceId)
      .executeTakeFirst();
    requireCondition(
      report.receiptId &&
        receipt?.receipt_id === report.receiptId &&
        receipt.state === (action === "install" ? "installed" : "removed") &&
        (action === "uninstall" || receipt.version === report.version),
      409,
      "INSTALLATION_REPORT_RECEIPT",
      "A completed device change requires its current accepted receipt.",
    );
  }
  await tx
    .insertInto("suite.installation_reports")
    .values({
      workspace_id: ctx.workspaceId,
      user_id: ctx.actor.id,
      device_id: report.deviceId,
      module_id: report.moduleId,
      attempt_id: report.attemptId,
      sequence: report.sequence,
      version: report.version ?? null,
      action,
      phase: report.phase,
      error_code: report.errorCode ?? null,
      receipt_id: report.receiptId ?? null,
      created_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    })
    .onConflict((oc) =>
      oc
        .columns([
          "workspace_id",
          "user_id",
          "device_id",
          "module_id",
          "attempt_id",
        ])
        .doUpdateSet({
          sequence: report.sequence,
          phase: report.phase,
          error_code: report.errorCode ?? null,
          receipt_id: report.receiptId ?? null,
          updated_at: sql`clock_timestamp()`,
        })
        .where("suite.installation_reports.sequence", "<", report.sequence)
        .where("suite.installation_reports.action", "=", action)
        .where(
          sql<boolean>`suite.installation_reports.version is not distinct from ${report.version ?? null}`,
        ),
    )
    .execute();
  return { ok: true };
}

export async function moduleFleet(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  offset: number,
): Promise<ModuleFleet> {
  requireCondition(
    ctx.permissions.includes("modules.manage"),
    403,
    "FORBIDDEN",
    "Module administration permission is required.",
  );
  const target = await workspaceModule(tx, ctx.workspaceId, moduleId);
  const setting = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("key", "=", `pin:${moduleId}`)
    .executeTakeFirst();
  const acceptedVersions = [
    target.version,
    ...(setting?.value.mandatory === false &&
    Array.isArray(setting.value.acceptedVersions)
      ? setting.value.acceptedVersions.filter(
          (v): v is string => typeof v === "string",
        )
      : []),
  ];
  // Keep server receipts and client observations distinct. A delayed update for
  // an already-recorded attempt cannot replace a newer recorded attempt.
  const cte = sql`with latest as (
    select distinct on (user_id,device_id) * from suite.installation_reports
    where workspace_id=${ctx.workspaceId}::uuid and module_id=${moduleId}
    order by user_id,device_id,created_at desc,attempt_id desc
  ), devices as (
    select coalesce(i.user_id,r.user_id) as user_id, coalesce(i.device_id,r.device_id) as device_id,
      i.version, i.state, i.updated_at as confirmed_at,
      r.version as report_version, r.action as report_action, r.phase, r.error_code, r.updated_at as reported_at,
      coalesce(i.receipt_id=r.receipt_id,false) as receipt_matches,
      (r.updated_at >= i.updated_at or i.updated_at is null) as report_current
    from (select * from suite.module_installations where workspace_id=${ctx.workspaceId}::uuid and module_id=${moduleId}) i
    full outer join latest r on i.user_id=r.user_id and i.device_id=r.device_id
  )`;
  const summary = (
    await sql<{ total: number; accepted: number; failed: number }>`
    ${cte} select count(*)::int as total,
      count(*) filter(where state='installed' and version=any(${acceptedVersions}::text[]))::int as accepted,
      count(*) filter(where phase='failed' and report_current)::int as failed from devices`.execute(
      tx,
    )
  ).rows[0];
  const rows = (
    await sql<{
      user_id: string;
      user_name: string;
      device_id: string;
      version: string | null;
      state: string | null;
      confirmed_at: Date | null;
      report_version: string | null;
      report_action: "install" | "uninstall" | null;
      phase: string | null;
      error_code: string | null;
      reported_at: Date | null;
      receipt_matches: boolean;
    }>` ${cte} select d.*, u.name as user_name from devices d join suite.users u on u.id=d.user_id
    order by d.user_id,d.device_id limit 51 offset ${offset}`.execute(tx)
  ).rows;
  return {
    targetVersion: target.version,
    acceptedVersions,
    ...summary,
    items: rows.slice(0, 50).map((r) => ({
      userId: r.user_id,
      userName: r.user_name,
      deviceId: r.device_id,
      version: r.version,
      state: r.state,
      confirmedAt: r.confirmed_at?.toISOString() ?? null,
      reportVersion: r.report_version,
      reportAction: r.report_action,
      phase: r.phase,
      errorCode: r.error_code,
      reportedAt: r.reported_at?.toISOString() ?? null,
      receiptMatches: r.receipt_matches,
    })),
    nextOffset: rows.length > 50 ? offset + 50 : null,
  };
}
