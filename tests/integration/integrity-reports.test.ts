import "dotenv/config";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import type { IntegrityReport, IntegrityPage } from "@suite/contracts";

it("authenticates and deduplicates client integrity observations without granting trust or crossing workspaces", async () => {
  const db = connectDatabase();
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const worker = new Pool({
    connectionString:
      process.env.WORKER_DATABASE_URL ??
      process.env.DATABASE_URL?.replace("suite_app:", "suite_worker:"),
  });
  const server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  try {
    const actor = (name: string) =>
      identify(db, {
        issuer: "test",
        subject: randomUUID(),
        name,
        email: `${randomUUID()}@test.local`,
        emailVerified: true,
      });
    const owner = await actor("Integrity owner"),
      member = await actor("Reporter"),
      outsider = await actor("Other company");
    const workspace = randomUUID(),
      other = randomUUID(),
      membership = randomUUID();
    for (const [id, userId] of [
      [workspace, owner.id],
      [other, outsider.id],
    ])
      await inWorkspace(db, id, (tx) =>
        provisionWorkspace(tx, {
          id,
          userId,
          kind: "company",
          name: "Integrity acceptance",
        }),
      );
    await admin.query(
      "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
      [membership, workspace, member.id],
    );
    const sessions = await Promise.all(
      [owner, member, outsider].map((user) => server.auth.issue(user.id, true)),
    );
    const request = (
      who: number,
      body?: unknown,
      target = workspace,
      cursor?: string,
    ) =>
      server.app.inject({
        method: body === undefined ? "GET" : "POST",
        url: `/api/v1/workspaces/${target}/integrity-reports${cursor ? `?cursor=${cursor}` : ""}`,
        headers: {
          cookie: `suite_session=${sessions[who].token}`,
          origin: "http://localhost:4300",
          "x-csrf-token": sessions[who].csrfToken,
        },
        ...(body === undefined ? {} : { payload: body as object }),
      });
    const report: IntegrityReport = {
      accountId: member.id,
      deviceId: randomUUID(),
      incidentId: randomUUID(),
      event: "locked",
      occurredAt: new Date(Date.now() - 3600000).toISOString(),
      incidentAt: new Date(Date.now() - 3600000).toISOString(),
      release: "1.0.0+build.1",
      incidentRelease: "1.0.0-beta.1+build.1",
      failureCode: "changed-asset",
      asset: "preload.cjs",
    };
    const replies = await Promise.all(
      Array.from({ length: 5 }, () => request(1, report)),
    );
    expect(replies.map((response) => response.statusCode)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(new Set(replies.map((response) => response.json().id)).size).toBe(1);
    const first = replies[0].json();
    expect(
      (await request(1, { ...report, asset: "cache-worker.cjs" })).statusCode,
    ).toBe(409);
    expect((await request(0, report)).statusCode).toBe(403);
    expect(
      (await request(2, { ...report, accountId: outsider.id })).statusCode,
    ).toBe(403);
    expect((await request(1)).statusCode).toBe(403);
    for (const invalid of [
      { ...report, failureCode: "trusted" },
      { ...report, roles: ["Owner"] },
      { ...report, asset: "../credentials.bin" },
      { ...report, occurredAt: "not-a-date" },
    ])
      expect((await request(1, invalid)).statusCode).toBe(400);
    const page = (await request(0)).json<IntegrityPage>();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: first.id,
      source: "client-report",
      reporterName: "Reporter",
      report,
    });
    expect(page.summary).toMatchObject({
      reports: 1,
      unresolvedReportedIncidents: 1,
      receivedLastDay: 1,
    });
    expect(page.summary.maximumDeliveryDelaySeconds).toBeGreaterThanOrEqual(
      3599,
    );
    expect(
      (await request(2, undefined, other)).json<IntegrityPage>().items,
    ).toHaveLength(0);
    await inWorkspace(db, other, async (tx) => {
      expect(
        await tx.selectFrom("suite.integrity_reports").selectAll().execute(),
      ).toHaveLength(0);
    });
    await admin.query("update suite.memberships set active=false where id=$1", [
      membership,
    ]);
    expect((await request(1, report)).statusCode).toBe(403);
    await admin.query("update suite.memberships set active=true where id=$1", [
      membership,
    ]);
    expect((await request(1, report)).json()).toEqual(first);
    const second = {
      ...report,
      incidentId: randomUUID(),
      event: "recovered" as const,
    };
    expect((await request(1, second)).statusCode).toBe(200);
    expect((await request(1, { ...second, event: "locked" })).statusCode).toBe(
      200,
    );
    expect(
      (await request(0)).json<IntegrityPage>().summary
        .unresolvedReportedIncidents,
    ).toBe(1);
    expect(
      (await request(1, { ...report, event: "recovered" })).statusCode,
    ).toBe(200);
    expect((await request(0)).json<IntegrityPage>().summary).toMatchObject({
      reports: 4,
      unresolvedReportedIncidents: 0,
    });
    const audit = await admin.query(
      "select action,target_id from suite.audit where workspace_id=$1 and action like 'desktop.integrity.%'",
      [workspace],
    );
    expect(audit.rows).toHaveLength(4);
    expect(audit.rows.filter((row) => row.target_id === first.id)).toHaveLength(
      1,
    );
    const health = (
      await worker.query("select * from suite.integrity_health()")
    ).rows[0];
    expect(Object.keys(health).sort()).toEqual([
      "maximum_delivery_delay_seconds",
      "received_last_day",
      "unresolved_reported_incidents",
    ]);
    expect(Number(health.received_last_day)).toBeGreaterThanOrEqual(4);
    await expect(
      db.selectFrom("suite.integrity_reports").selectAll().execute(),
    ).resolves.toEqual([]);
    const extra = await Promise.all(
      Array.from({ length: 47 }, () =>
        request(1, { ...report, incidentId: randomUUID() }),
      ),
    );
    expect(extra.every((response) => response.statusCode === 200)).toBe(true);
    const firstPage = (await request(0)).json<IntegrityPage>();
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = (
      await request(0, undefined, workspace, firstPage.nextCursor!)
    ).json<IntegrityPage>();
    expect(secondPage.items).toHaveLength(1);
    expect(
      new Set([...firstPage.items, ...secondPage.items].map((item) => item.id))
        .size,
    ).toBe(51);
    // Fail the audit write after the report insert; the API transaction must retain neither.
    const aborted = { ...report, incidentId: randomUUID() };
    await admin.query(
      "create function suite.test_integrity_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$",
    );
    try {
      await admin.query(
        `create trigger test_integrity_audit_failure before insert on suite.audit for each row when (NEW.workspace_id='${workspace}'::uuid and NEW.action like 'desktop.integrity.%') execute function suite.test_integrity_audit_failure()`,
      );
      expect((await request(1, aborted)).statusCode).toBe(500);
      expect(
        (
          await admin.query(
            "select id from suite.integrity_reports where workspace_id=$1 and incident_id=$2",
            [workspace, aborted.incidentId],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await admin.query(
            "select id from suite.audit where workspace_id=$1 and action like 'desktop.integrity.%'",
            [workspace],
          )
        ).rows,
      ).toHaveLength(51);
    } finally {
      await admin.query(
        "drop trigger if exists test_integrity_audit_failure on suite.audit",
      );
      await admin.query("drop function suite.test_integrity_audit_failure()");
    }
    // The ordinary API role has no cross-workspace aggregate privilege.
    const { sql } = await import("kysely");
    await expect(
      sql`select * from suite.integrity_health()`.execute(db),
    ).rejects.toThrow(/permission denied/);
  } finally {
    await server.app.close();
    await db.destroy();
    await worker.end();
    await admin.end();
  }
});
