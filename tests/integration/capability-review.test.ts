import "dotenv/config";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { Pool } from "pg";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import { createApp } from "../../apps/api/src/app";
import type { CapabilityReview } from "@suite/module-sdk/capability-review";

it("reviews verified releases using current policy and keeps review separate from execution authority", async () => {
  const db = connectDatabase(),
    pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const app = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  const workspace = randomUUID(),
    parent = randomUUID(),
    child = randomUUID();
  try {
    const owner = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Review owner",
      emailVerified: true,
    });
    const member = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Review member",
      emailVerified: true,
    });
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: owner.id,
        name: "Capability review",
        kind: "company",
      }),
    );
    const session = await app.auth.issue(owner.id, true),
      memberSession = await app.auth.issue(member.id, true);
    const headers = {
      cookie: `suite_session=${session.token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": session.csrfToken,
    };
    const memberHeaders = {
      cookie: `suite_session=${memberSession.token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": memberSession.csrfToken,
    };
    const state = (
      await app.app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${workspace}/platform`,
        headers,
      })
    ).json();
    const policy = state.organization;
    await pool.query(
      "insert into suite.roles(id,workspace_id,name,permissions,protected) values($1,$3,'Export supervisors',array['orders.export'],false),($2,$3,'Review staff','{}',false)",
      [parent, child, workspace],
    );
    const membership = randomUUID();
    await pool.query(
      "insert into suite.memberships(id,workspace_id,user_id,active) values($1,$2,$3,true)",
      [membership, workspace, member.id],
    );
    await pool.query(
      "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
      [workspace, membership, child],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,module_id,$2 from suite.module_activations where workspace_id=$1",
      [workspace, membership],
    );
    policy.ranks.push(
      {
        id: parent,
        name: "Export supervisors",
        parents: [policy.rootId],
        inherit: false,
        denies: [],
        x: 0,
        y: 100,
      },
      {
        id: child,
        name: "Review staff",
        parents: [parent],
        inherit: true,
        denies: [],
        x: 0,
        y: 200,
      },
    );
    const { version: initialVersion, ...graph } = policy;
    let policyVersion = initialVersion;
    const savePolicy = async () => {
      const response = await app.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace}/platform`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {
          action: "organization",
          value: graph,
          version: policyVersion,
        },
      });
      expect(response.statusCode, response.body + JSON.stringify(graph)).toBe(
        200,
      );
      policyVersion++;
    };
    await savePolicy();
    const invalid = await app.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace}/platform`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        action: "organization",
        value: { ...graph, rootId: "not-a-uuid" },
        version: policyVersion,
      },
    });
    expect(invalid.statusCode).toBe(400);
    const review = (
      version = "2.1.0",
      target = workspace,
      transport = headers,
    ) =>
      app.app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${target}/modules/orders/capabilities?version=${version}`,
        headers: transport,
      });
    const execute = () =>
      app.app.inject({
        method: "POST",
        url: `/api/v1/module/orders/workspaces/${workspace}/capabilities/authorize`,
        headers: { ...memberHeaders, "x-module-version": "2.1.0" },
        payload: { capability: "export" },
      });
    let response = await review();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    let result = response.json<CapabilityReview>();
    expect(result.capabilities).toEqual([
      {
        name: "export",
        kind: "files.export",
        permission: "orders.export",
        offline: false,
      },
    ]);
    expect(
      result.roles.find((r) => r.id === child)?.decisions["orders.export"],
    ).toEqual({ allowed: true, grants: ["Export supervisors"], denies: [] });
    // Older clients could rename metadata without updating saved chart labels.
    await pool.query("update suite.roles set name='Export leads' where id=$1", [
      parent,
    ]);
    const renamed = (await review()).json<CapabilityReview>();
    expect(renamed.roles.find((r) => r.id === parent)?.name).toBe(
      "Export leads",
    );
    expect(
      renamed.roles.find((r) => r.id === child)?.decisions["orders.export"],
    ).toEqual({ allowed: true, grants: ["Export leads"], denies: [] });
    expect((await execute()).statusCode).toBe(200);
    expect(
      (await review("2.0.0")).json<CapabilityReview>().capabilities,
    ).toEqual([]);
    expect((await review("99.0.0")).statusCode).toBe(409);
    expect((await review("2.1.0", randomUUID())).statusCode).toBe(403);
    expect((await review("2.1.0", workspace, memberHeaders)).statusCode).toBe(
      403,
    );
    graph.groups.push({
      id: randomUUID(),
      name: "Restricted exports",
      rankIds: [child],
      tags: [],
      grants: ["orders.export"],
      denies: ["orders.export"],
    });
    await savePolicy();
    response = await review();
    result = response.json<CapabilityReview>();
    expect(
      result.roles.find((r) => r.id === child)?.decisions["orders.export"],
    ).toEqual({
      allowed: false,
      grants: ["Restricted exports", "Export leads"],
      denies: ["Restricted exports"],
    });
    expect((await execute()).statusCode).toBe(403);
    expect(
      result.roles.find((r) => r.id === policy.rootId)?.decisions[
        "orders.export"
      ].allowed,
    ).toBe(true);
    await pool.query(
      "update suite.roles set permissions=array['modules.manage'] where id=$1",
      [child],
    );
    response = await review("2.1.0", workspace, memberHeaders);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ canReviewRoles: false, roles: [] });
    await pool.query("update suite.roles set permissions='{}' where id=$1", [
      child,
    ]);
    expect((await review("2.1.0", workspace, memberHeaders)).statusCode).toBe(
      403,
    );
    await pool.query(
      "update suite.workspaces set offline_hours=0 where id=$1",
      [workspace],
    );
    expect((await review()).json<CapabilityReview>().offlineHours).toBe(0);
    const original = (
      await pool.query(
        "select manifest from suite.module_releases where module_id='orders' and version='2.1.0'",
      )
    ).rows[0].manifest;
    try {
      await pool.query(
        "update suite.module_releases set manifest=jsonb_set(manifest,'{capabilities,export,permission}', '\"orders.forged\"') where module_id='orders' and version='2.1.0'",
      );
      expect((await review()).statusCode).toBe(500);
    } finally {
      await pool.query(
        "update suite.module_releases set manifest=$1 where module_id='orders' and version='2.1.0'",
        [original],
      );
    }
    expect((await review()).statusCode).toBe(200);
  } finally {
    await app.app.close();
    await db.destroy();
    await pool.end();
  }
});
