import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { OrganizationPolicy } from "@suite/module-sdk/governance";
import type { CapabilityReview } from "@suite/module-sdk/capability-review";

it("persists role-targeted tags with current authority, shared review, exact retries and legacy-client preservation", async () => {
  const db = connectDatabase(),
    admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  const workspace = randomUUID(),
    role = randomUUID(),
    membership = randomUUID();
  try {
    const actor = (name: string) =>
      identify(db, {
        issuer: "test",
        subject: randomUUID(),
        email: `${randomUUID()}@test.local`,
        name,
        emailVerified: true,
      });
    const owner = await actor("Policy owner"),
      employee = await actor("Tagged employee");
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: owner.id,
        kind: "company",
        name: "Tag policies",
      }),
    );
    await admin.query(
      "insert into suite.roles(id,workspace_id,name,permissions,protected) values($1,$2,'Tagged team','{}',false)",
      [role, workspace],
    );
    await admin.query(
      "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
      [membership, workspace, employee.id],
    );
    await admin.query(
      "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
      [workspace, membership, role],
    );
    await admin.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,module_id,$2 from suite.module_activations where workspace_id=$1",
      [workspace, membership],
    );
    const sessions = await Promise.all(
      [owner, employee].map((user) => server.auth.issue(user.id, true)),
    );
    const headers = (who = 0) => ({
      cookie: `suite_session=${sessions[who].token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": sessions[who].csrfToken,
    });
    const state = async () =>
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/workspaces/${workspace}/platform`,
          headers: headers(),
        })
      ).json<PlatformState>();
    const current = (await state()).organization!;
    const { version: initial, ...policy } = current;
    const hierarchy = structuredClone(policy.ranks);
    policy.tags = [
      {
        id: randomUUID(),
        name: "Export reviewers",
        rankIds: [role],
        grants: ["orders.export"],
        denies: [],
      },
    ];
    const save = (
      value: OrganizationPolicy,
      version: number,
      key = randomUUID(),
      who = 0,
      target = workspace,
    ) =>
      server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${target}/platform`,
        headers: { ...headers(who), "idempotency-key": key },
        payload: { action: "organization", value, version },
      });
    const execute = () =>
      server.app.inject({
        method: "POST",
        url: `/api/v1/module/orders/workspaces/${workspace}/capabilities/authorize`,
        headers: { ...headers(1), "x-module-version": "2.1.0" },
        payload: { capability: "export" },
      });
    const review = async () =>
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/workspaces/${workspace}/modules/orders/capabilities?version=2.1.0`,
          headers: headers(),
        })
      )
        .json<CapabilityReview>()
        .roles.find((item) => item.id === role)!.decisions["orders.export"];
    expect((await execute()).statusCode).toBe(403);
    const key = randomUUID();
    for (const response of await Promise.all([
      save(policy, initial, key),
      save(policy, initial, key),
    ]))
      expect(response.statusCode, response.body).toBe(200);
    expect((await state()).organization).toMatchObject({
      version: initial + 1,
      tags: policy.tags,
      ranks: hierarchy,
    });
    expect(await review()).toEqual({
      allowed: true,
      grants: ["Tag: Export reviewers"],
      denies: [],
    });
    expect((await execute()).statusCode).toBe(200);
    expect((await save(policy, initial)).statusCode).toBe(412);
    expect((await save(policy, initial + 1, randomUUID(), 1)).statusCode).toBe(
      403,
    );
    expect(
      (await save(policy, initial + 1, randomUUID(), 0, randomUUID()))
        .statusCode,
    ).toBe(403);
    // An older client may edit the organization without knowing about tags.
    const { tags: _tags, ...legacy } = policy;
    expect((await save(legacy, initial + 1)).statusCode).toBe(200);
    expect((await state()).organization!.tags).toEqual(policy.tags);
    expect((await execute()).statusCode).toBe(200);
    for (const tags of [
      [
        {
          ...policy.tags[0],
          rankIds: [policy.rootId],
          denies: ["roles.manage"],
        },
      ],
      [{ ...policy.tags[0], rankIds: [randomUUID()] }],
      [
        policy.tags[0],
        { ...policy.tags[0], id: randomUUID(), name: " export reviewers " },
      ],
      [{ ...policy.tags[0], grants: ["unregistered.forged"] }],
    ])
      expect([400, 403]).toContain(
        (await save({ ...policy, tags }, initial + 2)).statusCode,
      );
    expect((await state()).organization!.version).toBe(initial + 2);
    await admin.query(
      "update suite.roles set permissions=array['roles.manage'] where id=$1",
      [role],
    );
    expect(
      (
        await save(
          {
            ...policy,
            tags: [{ ...policy.tags[0], grants: ["workspace.manage"] }],
          },
          initial + 2,
          randomUUID(),
          1,
        )
      ).statusCode,
    ).toBe(403);
    policy.tags.push({
      id: randomUUID(),
      name: "Restricted exports",
      rankIds: [role],
      grants: [],
      denies: ["orders.export"],
    });
    expect((await save(policy, initial + 2)).statusCode).toBe(200);
    expect(await review()).toEqual({
      allowed: false,
      grants: ["Tag: Export reviewers"],
      denies: ["Tag: Restricted exports"],
    });
    expect((await execute()).statusCode).toBe(403);
    const updates = await Promise.all([
      save({ ...policy, tags: [] }, initial + 3),
      save(policy, initial + 3),
    ]);
    expect(updates.map((reply) => reply.statusCode).sort()).toEqual([200, 412]);
    const latest = (await state()).organization!;
    expect(
      (await save({ ...policy, tags: [] }, latest.version)).statusCode,
    ).toBe(200);
    expect((await state()).organization).toMatchObject({
      tags: [],
      ranks: hierarchy,
    });
    expect((await execute()).statusCode).toBe(403);
    expect(
      (
        await admin.query(
          "select id from suite.audit where workspace_id=$1 and action='platform.organization'",
          [workspace],
        )
      ).rows,
    ).toHaveLength(5);
    await admin.query("update suite.memberships set active=false where id=$1", [
      membership,
    ]);
    expect(
      (await save(policy, latest.version + 1, randomUUID(), 1)).statusCode,
    ).toBe(403);
  } finally {
    await server.app.close();
    await db.destroy();
    await admin.end();
  }
});
