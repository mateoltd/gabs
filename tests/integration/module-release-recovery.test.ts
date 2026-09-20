import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { it, expect } from "vitest";
import type { PlatformState } from "@suite/module-sdk/platform";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  provisionWorkspace,
  inWorkspace,
} from "../../composition/src/server/product";
import { modulePolicyReleaseFixture } from "../support/module-policy-release-fixture";

it("preserves permission administration and repairs independent unavailable releases without granting execution", async () => {
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
  const first = await modulePolicyReleaseFixture("First recovery module");
  const second = await modulePolicyReleaseFixture("Second recovery module");
  try {
    const owner = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Recovery owner",
      emailVerified: true,
    });
    const workspace = randomUUID();
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: owner.id,
        kind: "company",
        name: "Release recovery",
      }),
    );
    const session = await server.auth.issue(owner.id, true);
    const headers = {
      cookie: `suite_session=${session.token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": session.csrfToken,
    };
    const request = (
      method: "GET" | "POST" | "PATCH",
      path: string,
      payload?: unknown,
      key = randomUUID(),
    ) =>
      server.app.inject({
        method,
        url: `/api/v1/workspaces/${workspace}${path}`,
        headers: { ...headers, "idempotency-key": key },
        ...(payload ? { payload } : {}),
      });
    const state = async () => {
      const response = await request("GET", "/platform");
      expect(response.statusCode, response.body).toBe(200);
      return response.json<PlatformState>();
    };
    const pin = (
      id: string,
      version: string,
      expected: number,
      key = randomUUID(),
    ) =>
      request(
        "POST",
        "/platform",
        {
          action: "rollout",
          value: {
            moduleId: id,
            version,
            mandatory: true,
            acceptedVersions: [],
          },
          version: expected,
        },
        key,
      );
    for (const fixture of [first, second]) {
      await fixture.publish("1.0.0", {}, [`${fixture.id}.read`]);
      await fixture.publish("1.1.0", {}, [`${fixture.id}.read`]);
      await fixture.entitle(workspace);
      const enabled = await request("PATCH", `/modules/${fixture.id}`, {
        state: "enabled",
        accessPolicy: "admin",
      });
      expect(enabled.statusCode, enabled.body).toBe(200);
      expect((await pin(fixture.id, "1.0.0", 0)).statusCode).toBe(200);
    }
    await state();
    for (const fixture of [first, second]) await fixture.withdraw("1.0.0");
    const degraded = await state();
    expect(degraded.unavailableModules?.map((m) => m.moduleId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(
      degraded.modules.some((m) => m.id === first.id || m.id === second.id),
    ).toBe(false);
    expect(degraded.modules.some((m) => m.id === "contacts")).toBe(true);
    expect(
      degraded.permissionCatalog?.find(
        (p) => p.permission === `${first.id}.read`,
      ),
    ).toMatchObject({ current: false, versions: ["1.1.0"] });
    const boot = await request("GET", "/bootstrap");
    expect(boot.statusCode, boot.body).toBe(200);
    expect(
      boot
        .json()
        .modules.find((m: { moduleId: string }) => m.moduleId === first.id)
        .acceptedVersions,
    ).toBeUndefined();
    expect(boot.json().permissions).not.toContain(`${first.id}.read`);
    const role = await request("POST", "/roles", {
      name: "Recovery reader",
      permissions: [`${first.id}.read`],
    });
    expect(role.statusCode, role.body).toBe(200);
    expect(
      (
        await request("POST", "/roles", {
          name: "Forged reader",
          permissions: [`${first.id}.invented`],
        })
      ).statusCode,
    ).toBe(400);
    const policyState = await state();
    const { version, ...policy } = policyState.organization!;
    const sales = policyState.roles.find((r) => r.name === "Sales")!.id;
    policy.tags = [
      {
        id: randomUUID(),
        name: "Pending module readers",
        rankIds: [sales],
        grants: [`${second.id}.read`],
        denies: [],
      },
    ];
    const saved = await request("POST", "/platform", {
      action: "organization",
      value: policy,
      version,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    // A cached or historical declaration never authorizes current execution.
    const member = (
      await admin.query(
        "select id from suite.memberships where workspace_id=$1 and user_id=$2",
        [workspace, owner.id],
      )
    ).rows[0].id;
    await admin.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) values($1,$2,$3)",
      [workspace, member, first.id],
    );
    const execution = await server.app.inject({
      method: "POST",
      url: `/api/v1/module/${first.id}/workspaces/${workspace}/queries/read`,
      headers,
      payload: {},
    });
    expect(execution.statusCode, execution.body).toBe(409);
    expect(execution.json().code).toBe("RELEASE_INCOMPATIBLE");
    const suspended = await request("PATCH", `/modules/${first.id}`, {
      state: "suspended",
      accessPolicy: "admin",
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(
      (
        await request("PATCH", `/modules/${first.id}`, {
          state: "enabled",
          accessPolicy: "admin",
        })
      ).statusCode,
    ).toBe(409);
    await first.publish("1.2.0", { contacts: "^99.0.0" }, [`${first.id}.read`]);
    expect((await pin(first.id, "1.2.0", 1)).statusCode).toBe(409);
    expect(
      (await state()).settings.find((s) => s.key === `pin:${first.id}`),
    ).toMatchObject({ version: 1, value: { version: "1.0.0" } });
    const key = randomUUID();
    const recovered = await pin(first.id, "1.1.0", 1, key);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect((await pin(first.id, "1.1.0", 1, key)).statusCode).toBe(200);
    expect((await pin(first.id, "1.1.0", 1)).statusCode).toBe(412);
    const after = await state();
    expect(after.unavailableModules?.map((m) => m.moduleId)).toEqual([
      second.id,
    ]);
    expect(
      after.permissionCatalog?.find((p) => p.permission === `${first.id}.read`)
        ?.current,
    ).toBe(true);
    expect(
      (await request("GET", "/bootstrap"))
        .json()
        .modules.find((m: { moduleId: string }) => m.moduleId === first.id)
        .state,
    ).toBe("suspended");
    expect(
      (
        await request("PATCH", `/modules/${first.id}`, {
          state: "enabled",
          accessPolicy: "admin",
        })
      ).statusCode,
    ).toBe(200);
    expect((await pin(second.id, "1.1.0", 1)).statusCode).toBe(200);
    expect((await state()).unavailableModules).toEqual([]);
    expect(
      (
        await admin.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action='platform.rollout' and target_id=$2",
          [workspace, `pin:${first.id}`],
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await server.app.close();
    await db.destroy();
    await admin.end();
    await first.close();
    await second.close();
  }
});
