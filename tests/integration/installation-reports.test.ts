import type { InstallationReport } from "@suite/module-sdk/platform";
import "dotenv/config";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";

it("isolates device observations, rejects forged readiness and keeps newer attempts ahead of delayed reports", async () => {
  const db = connectDatabase();
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
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
  const workspaceId = randomUUID();
  try {
    const actor = async (name: string) =>
      identify(db, {
        issuer: "test",
        subject: randomUUID(),
        name,
        email: `${randomUUID()}@test.local`,
        emailVerified: true,
      });
    const owner = await actor("Fleet owner"),
      member = await actor("Fleet observer"),
      outsider = await actor("Other company");
    await inWorkspace(db, workspaceId, (tx) =>
      provisionWorkspace(tx, {
        id: workspaceId,
        userId: owner.id,
        name: "Fleet security",
        kind: "company",
      }),
    );
    const otherWorkspace = randomUUID();
    await inWorkspace(db, otherWorkspace, (tx) =>
      provisionWorkspace(tx, {
        id: otherWorkspace,
        userId: outsider.id,
        name: "Other fleet",
        kind: "company",
      }),
    );
    const memberId = randomUUID();
    await admin.query(
      "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
      [memberId, workspaceId, member.id],
    );
    const ownerSession = await server.auth.issue(owner.id, true),
      memberSession = await server.auth.issue(member.id, true),
      outsiderSession = await server.auth.issue(outsider.id, true);
    const request = (
      session: typeof ownerSession,
      path: string,
      body?: unknown,
    ) =>
      server.app.inject({
        method: body === undefined ? "GET" : "POST",
        url: `/api/v1/workspaces/${workspaceId}/${path}`,
        headers: {
          cookie: `suite_session=${session.token}`,
          origin: "http://localhost:4300",
          "x-csrf-token": session.csrfToken,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
    // Contract literals must remain narrow for module/host authors.
    // @ts-expect-error Unrecognized report phases are rejected at compile time.
    const invalidPhase: InstallationReport["phase"] = "authorized";
    void invalidPhase;
    // @ts-expect-error Failure codes are bounded and do not accept arbitrary text.
    const invalidCode: InstallationReport["errorCode"] = "stack trace";
    void invalidCode;
    const report = {
      moduleId: "contacts",
      deviceId: "fleet-test-device",
      attemptId: randomUUID(),
      sequence: 3,
      version: "1.1.0",
      phase: "failed",
      errorCode: "download",
    };
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          accountId: owner.id,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          action: "uninstall",
          phase: "ready",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          action: "uninstall",
          phase: "removed",
          receiptId: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          version: undefined,
          moduleId: "unknown-module",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          attemptId: randomUUID(),
          accountId: member.id,
          version: undefined,
          errorCode: "policy",
        })
      ).statusCode,
    ).toBe(200);
    const preflight = (
      await request(ownerSession, "modules/contacts/devices")
    ).json();
    expect(preflight).toMatchObject({
      accepted: 0,
      failed: 1,
      items: [
        { reportVersion: null, reportAction: "install", phase: "failed" },
      ],
    });
    const reported = await request(
      memberSession,
      "installation-reports",
      report,
    );
    expect(reported.statusCode, reported.body).toBe(200);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          sequence: 1,
          phase: "downloading",
        })
      ).statusCode,
    ).toBe(200);
    let fleet = (
      await request(ownerSession, "modules/contacts/devices")
    ).json();
    expect(fleet).toMatchObject({
      total: 1,
      accepted: 0,
      failed: 1,
      items: [
        {
          userId: member.id,
          phase: "failed",
          errorCode: "download",
          version: null,
        },
      ],
    });
    expect(
      (await request(memberSession, "modules/contacts/devices")).statusCode,
    ).toBe(403);
    expect(
      (await request(outsiderSession, "modules/contacts/devices")).statusCode,
    ).toBe(403);
    expect(
      (await request(outsiderSession, "installation-reports", report))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          userId: owner.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          errorCode: "secret or raw stack trace",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          sequence: 4,
          phase: "ready",
          receiptId: randomUUID(),
        })
      ).statusCode,
    ).toBe(409);
    const newer = {
      ...report,
      attemptId: randomUUID(),
      sequence: 1,
      phase: "downloading",
    };
    expect(
      (await request(memberSession, "installation-reports", newer)).statusCode,
    ).toBe(200);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...report,
          sequence: 9,
        })
      ).statusCode,
    ).toBe(200);
    fleet = (await request(ownerSession, "modules/contacts/devices")).json();
    expect(fleet).toMatchObject({
      total: 1,
      failed: 0,
      items: [{ phase: "downloading" }],
    });
    // Reports cannot create a server installation or grant a runtime receipt.
    expect(
      (
        await admin.query(
          "select count(*)::int as n from suite.module_installations where workspace_id=$1 and module_id='contacts'",
          [workspaceId],
        )
      ).rows[0].n,
    ).toBe(0);
    // Larger fleet rows are data fixtures; exercise bounded paging and totals.
    await admin.query(
      "insert into suite.installation_reports(workspace_id,user_id,device_id,module_id,attempt_id,sequence,version,phase) select $1,$2,'page-device-' || n,'contacts',gen_random_uuid(),1,'1.1.0','failed' from generate_series(1,51) n",
      [workspaceId, owner.id],
    );
    fleet = (await request(ownerSession, "modules/contacts/devices")).json();
    expect(fleet).toMatchObject({ total: 52, failed: 51, nextOffset: 50 });
    expect(fleet.items).toHaveLength(50);
    const second = (
      await request(ownerSession, "modules/contacts/devices?offset=50")
    ).json();
    expect(second.items).toHaveLength(2);
    expect(second.nextOffset).toBeNull();
    expect(
      new Set(
        [...fleet.items, ...second.items].map(
          (i) => `${i.userId}:${i.deviceId}`,
        ),
      ).size,
    ).toBe(52);
    const other = await server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${otherWorkspace}/modules/contacts/devices`,
      headers: { cookie: `suite_session=${outsiderSession.token}` },
    });
    expect(other.json()).toMatchObject({ total: 0, items: [] });
    await admin.query("update suite.memberships set active=false where id=$1", [
      memberId,
    ]);
    expect(
      (
        await request(memberSession, "installation-reports", {
          ...newer,
          sequence: 2,
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await server.app.close();
    await db.destroy();
    await admin.end();
  }
}, 30000);

it("registry discovery does not automatically assign or activate modules in new workspaces", async () => {
  const { registerModule, bundledModuleIds } =
    await import("@suite/module-catalog");
  const { defineModule, Type } = await import("@suite/module-sdk");
  const id = `onboarding-${randomUUID().slice(0, 8)}`;
  registerModule(
    defineModule({
      id,
      name: "Reviewed optional module",
      version: "1.0.0",
      publisher: "suite",
      host: "^1.0.0",
      backend: "^1.0.0",
      description: "Explicit onboarding selection",
      dependencies: {},
      configuration: Type.Object({}),
      permissions: [],
      operations: {},
      resources: {},
    }),
  );
  const db = connectDatabase();
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      name: "Onboarding owner",
      email: `${randomUUID()}@test.local`,
      emailVerified: true,
    });
    for (const explicit of [false, true]) {
      const workspaceId = randomUUID();
      await inWorkspace(db, workspaceId, async (tx) => {
        await provisionWorkspace(tx, {
          id: workspaceId,
          userId: user.id,
          name: "Scoped onboarding",
          kind: "company",
          ...(explicit ? { modules: [id] } : {}),
        });
        for (const table of [
          "suite.entitlements",
          "suite.module_activations",
          "suite.module_assignments",
        ] as const) {
          const rows = await tx
            .selectFrom(table)
            .select("module_id")
            .where("workspace_id", "=", workspaceId)
            .execute();
          expect(rows.map((r) => r.module_id).sort()).toEqual(
            [...(explicit ? [id] : bundledModuleIds)].sort(),
          );
        }
      });
    }
  } finally {
    await db.destroy();
  }
});
