import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { RoleDetails } from "@suite/contracts";
const db = connectDatabase();
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let server: Awaited<ReturnType<typeof createApp>> | undefined;
beforeAll(async () => {
  server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
});
afterAll(async () => {
  await server?.app.close();
  await admin.end();
  await db.destroy();
});
async function fixture() {
  const owner = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `${randomUUID()}@test.local`,
    name: "Owner",
    emailVerified: true,
  });
  const workspace = randomUUID();
  await inWorkspace(db, workspace, (tx) =>
    provisionWorkspace(tx, {
      id: workspace,
      userId: owner.id,
      kind: "company",
      name: "Role removal",
    }),
  );
  const session = await server!.auth.issue(owner.id, true);
  const headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
  const base = `/api/v1/workspaces/${workspace}`;
  const read = async () =>
    (
      await server!.app.inject({
        method: "GET",
        url: `${base}/platform`,
        headers,
      })
    ).json<PlatformState>();
  const list = async () =>
    (
      await server!.app.inject({ method: "GET", url: `${base}/roles`, headers })
    ).json<RoleDetails[]>();
  const roles = await list(),
    target = roles.find((r) => r.name === "Sales")!;
  const input = {
    revision: target.revision,
    organizationVersion: (await read()).organization!.version,
  };
  const remove = (
    body: object = input,
    key: string | null = randomUUID(),
    id = target.id,
  ) =>
    server!.app.inject({
      method: "POST",
      url: `${base}/roles/${id}/remove`,
      headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) },
      payload: body,
    });
  const policy = async (
    change: (p: NonNullable<PlatformState["organization"]>) => void,
  ) => {
    const value = (await read()).organization!;
    change(value);
    const { version, ...organization } = value;
    const result = await server!.app.inject({
      method: "POST",
      url: `${base}/platform`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { action: "organization", value: organization, version },
    });
    expect(result.statusCode, result.body).toBe(200);
    return (await read()).organization!;
  };
  const effects = async () =>
    (
      await admin.query<{ audits: number; events: number }>(
        `select
    (select count(*)::int from suite.audit where workspace_id=$1 and action='roles.removed') audits,
    (select count(*)::int from suite.outbox where workspace_id=$1 and event_type='roles.removed') events`,
        [workspace],
      )
    ).rows[0];
  return {
    owner,
    workspace,
    headers,
    base,
    read,
    list,
    roles,
    target,
    input,
    remove,
    policy,
    effects,
  };
}
it("removes an unused role atomically, keeps historical invitations, and replays without duplicate effects", async () => {
  const f = await fixture(),
    key = randomUUID(),
    invitation = randomUUID();
  await admin.query(
    "insert into suite.invitations(id,workspace_id,email,role_id,invited_by,state) values($1,$2,$3,$4,$5,'declined')",
    [invitation, f.workspace, "history@test.local", f.target.id, f.owner.id],
  );
  const before = await f.policy((p) => {
    p.groups = [
      {
        id: randomUUID(),
        name: "Team",
        rankIds: [f.target.id, p.rootId],
        grants: [],
        denies: [],
        tags: [],
        modules: ["contacts"],
      },
    ];
    p.tags = [
      {
        id: randomUUID(),
        name: "North",
        rankIds: [f.target.id],
        grants: ["orders.read"],
        denies: [],
      },
    ];
  });
  const input = { ...f.input, organizationVersion: before.version };
  const first = await f.remove(input, key);
  expect(first.statusCode, first.body).toBe(200);
  expect((await f.remove(input, key)).json()).toEqual(first.json());
  expect(await f.effects()).toEqual({ audits: 1, events: 1 });
  expect((await f.list()).some((r) => r.id === f.target.id)).toBe(false);
  const after = (await f.read()).organization!;
  expect(after.version).toBe(before.version + 1);
  expect(after.ranks).toEqual(before.ranks.filter((r) => r.id !== f.target.id));
  expect(after.groups).toEqual(
    before.groups.map((g) => ({
      ...g,
      rankIds: g.rankIds.filter((id) => id !== f.target.id),
    })),
  );
  expect(after.tags![0].rankIds).toEqual([]);
  const history = await server!.app.inject({
    method: "GET",
    url: `${f.base}/invitations`,
    headers: f.headers,
  });
  expect(history.json().items).toContainEqual(
    expect.objectContaining({
      id: invitation,
      roleId: f.target.id,
      roleName: "Sales",
      state: "declined",
    }),
  );
  expect(
    (
      await admin.query(
        "select retired_at from suite.roles where workspace_id=$1 and id=$2",
        [f.workspace, f.target.id],
      )
    ).rows[0].retired_at,
  ).not.toBeNull();
  const recreated = await server!.app.inject({
    method: "POST",
    url: `${f.base}/roles`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: { name: "Sales", permissions: [] },
  });
  expect(recreated.statusCode, recreated.body).toBe(200);
  expect(recreated.json().id).not.toBe(f.target.id);
  expect((await f.remove(input)).statusCode).toBe(404);
});
it("protects platform roles, rejects foreign IDs, and requires exact role and organization preconditions", async () => {
  const f = await fixture(),
    foreign = await fixture();
  for (const role of f.roles.filter((r) => r.protected))
    expect(
      (
        await f.remove(
          { ...f.input, revision: role.revision },
          randomUUID(),
          role.id,
        )
      ).json().code,
    ).toBe("PROTECTED_ROLE");
  expect((await f.remove({}, randomUUID())).statusCode).toBe(400);
  expect((await f.remove(f.input, null)).json().code).toBe(
    "IDEMPOTENCY_REQUIRED",
  );
  expect(
    (await f.remove({ ...f.input, revision: "0".repeat(64) })).json().code,
  ).toBe("ROLE_CHANGED");
  expect(
    (await f.remove({ ...f.input, organizationVersion: 999 })).json().code,
  ).toBe("VERSION_CONFLICT");
  expect(
    (await f.remove(foreign.input, randomUUID(), foreign.target.id)).statusCode,
  ).toBe(404);
  expect(await f.effects()).toEqual({ audits: 0, events: 0 });
});
it("requires explicit child reparenting and member reassignment, including inactive members", async () => {
  const f = await fixture();
  const before = await f.policy((p) => {
    p.ranks.find((r) => r.name === "Warehouse")!.parents = [
      f.target.id,
      p.rootId,
    ];
  });
  expect(
    (await f.remove({ ...f.input, organizationVersion: before.version })).json()
      .code,
  ).toBe("ROLE_HAS_CHILDREN");
  const next = await f.policy((p) => {
    p.ranks.find((r) => r.name === "Warehouse")!.parents = [p.rootId];
  });
  const member = randomUUID(),
    user = randomUUID();
  await admin.query(
    "insert into suite.users(id,issuer,subject,email,name) values($1,'test',$2,$3,'Inactive member')",
    [user, user, `${user}@test.local`],
  );
  await admin.query(
    "insert into suite.memberships(id,workspace_id,user_id,active) values($1,$2,$3,false)",
    [member, f.workspace, user],
  );
  await admin.query(
    "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
    [f.workspace, member, f.target.id],
  );
  expect(
    (await f.remove({ ...f.input, organizationVersion: next.version })).json()
      .code,
  ).toBe("ROLE_ASSIGNED");
  expect(await f.effects()).toEqual({ audits: 0, events: 0 });
  expect((await f.read()).organization).toEqual(next);
});
it("blocks live invitations and rejects reusing a removed role for invitations or member access", async () => {
  const f = await fixture();
  const invited = await server!.app.inject({
    method: "POST",
    url: `${f.base}/invitations`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: { roleId: f.target.id, email: "pending@test.local" },
  });
  expect(invited.statusCode, invited.body).toBe(200);
  expect((await f.remove()).json().code).toBe("ROLE_INVITED");
  const revoked = await server!.app.inject({
    method: "DELETE",
    url: `${f.base}/invitations/${invited.json().id}`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
  });
  expect(revoked.statusCode, revoked.body).toBe(200);
  expect((await f.remove()).statusCode).toBe(200);
  const again = await server!.app.inject({
    method: "POST",
    url: `${f.base}/invitations`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: { roleId: f.target.id, email: "different@test.local" },
  });
  expect(again.statusCode).toBe(404);
  const members = await server!.app.inject({
    method: "GET",
    url: `${f.base}/members`,
    headers: f.headers,
  });
  const member = members.json().items[0];
  const assigned = await server!.app.inject({
    method: "PATCH",
    url: `${f.base}/members/${member.id}`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: {
      revision: member.revision,
      active: true,
      roleIds: [f.target.id],
      modules: [],
    },
  });
  expect(assigned.json().code, assigned.body).toBe("INVALID_ROLE");
  const edited = await server!.app.inject({
    method: "PUT",
    url: `${f.base}/roles/${f.target.id}`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: {
      revision: f.target.revision,
      name: "Resurrected",
      permissions: [],
    },
  });
  expect(edited.statusCode).toBe(404);
});
it("serializes competing edit/removal and keeps receipts, audit and events consistent", async () => {
  const f = await fixture();
  const [removed, edited] = await Promise.all([
    f.remove(),
    server!.app.inject({
      method: "PUT",
      url: `${f.base}/roles/${f.target.id}`,
      headers: { ...f.headers, "idempotency-key": randomUUID() },
      payload: {
        revision: f.target.revision,
        name: "Changed first",
        permissions: [],
      },
    }),
  ]);
  expect([removed.statusCode, edited.statusCode]).toEqual(
    removed.statusCode === 200 ? [200, 404] : [409, 200],
  );
  expect(await f.effects()).toEqual(
    removed.statusCode === 200
      ? { audits: 1, events: 1 }
      : { audits: 0, events: 0 },
  );
});
it("rechecks authority after waiting on both workspace and accepted receipt locks", async () => {
  for (const replay of [false, true])
    for (const lock of replay ? ["workspace", "receipt"] : ["workspace"]) {
      const f = await fixture(),
        key = randomUUID();
      if (replay) expect((await f.remove(f.input, key)).statusCode).toBe(200);
      const before = await f.effects(),
        blocker = await admin.connect();
      let pending: Promise<number> | undefined;
      try {
        await blocker.query("begin");
        const pid = (
          await blocker.query<{ pid: number }>("select pg_backend_pid() pid")
        ).rows[0].pid;
        if (lock === "workspace")
          await blocker.query(
            "select id from suite.workspaces where id=$1 for update",
            [f.workspace],
          );
        else
          await blocker.query(
            "select pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${f.workspace}:${f.owner.id}:${key}`],
          );
        pending = f.remove(f.input, key).then((r) => r.statusCode);
        await expect
          .poll(async () =>
            Number(
              (
                await admin.query<{ count: string }>(
                  "select count(*) from pg_stat_activity where $1=any(pg_blocking_pids(pid))",
                  [pid],
                )
              ).rows[0].count,
            ),
          )
          .toBeGreaterThan(0);
        await blocker.query(
          "update suite.memberships set active=false where workspace_id=$1 and user_id=$2",
          [f.workspace, f.owner.id],
        );
        await blocker.query("commit");
        expect(await pending).toBe(403);
        expect(await f.effects()).toEqual(before);
      } finally {
        await blocker.query("rollback");
        blocker.release();
        await pending;
      }
    }
});

it("does not let stale organization documents restore a removed role", async () => {
  const f = await fixture();
  const before = await f.policy(() => {});
  const input = { ...f.input, organizationVersion: before.version };
  expect((await f.remove(input)).statusCode).toBe(200);
  const { version: ignored, ...value } = before;
  void ignored;
  const restored = await server!.app.inject({
    method: "POST",
    url: `${f.base}/platform`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: {
      action: "organization",
      value,
      version: (await f.read()).organization!.version,
    },
  });
  expect(restored.json().code, restored.body).toBe("INVALID_RANKS");
  expect(
    (await f.read()).organization!.ranks.some(
      (rank) => rank.id === f.target.id,
    ),
  ).toBe(false);
  expect(await f.effects()).toEqual({ audits: 1, events: 1 });
});
it("retains module-policy authority when a role administrator removes a classified role", async () => {
  const f = await fixture();
  const before = await f.policy((p) => {
    p.groups = [
      {
        id: randomUUID(),
        name: "Licensed",
        rankIds: [f.target.id],
        modules: ["contacts"],
        grants: [],
        denies: [],
        tags: [],
      },
    ];
  });
  const delegated = f.roles.find((role) => role.name === "Warehouse")!;
  // Exercise a legitimate delegated role administrator with no module-administration grant.
  await admin.query(
    "update suite.roles set permissions=$1 where workspace_id=$2 and id=$3",
    [["roles.manage"], f.workspace, delegated.id],
  );
  await admin.query(
    "update suite.role_assignments set role_id=$1 where workspace_id=$2 and membership_id=(select id from suite.memberships where workspace_id=$2 and user_id=$3)",
    [delegated.id, f.workspace, f.owner.id],
  );
  const denied = await f.remove({
    ...f.input,
    organizationVersion: before.version,
  });
  expect(denied.json().code, denied.body).toBe("MODULE_POLICY_FORBIDDEN");
  expect((await f.read()).organization).toEqual(before);
  expect(await f.effects()).toEqual({ audits: 0, events: 0 });
});

it("keeps the initial chart in product preset order after the active-role index migration", async () => {
  const f = await fixture();
  expect((await f.read()).organization!.ranks.map((rank) => rank.name)).toEqual(
    ["Administrador", "Administrator", "Sales", "Warehouse", "Viewer"],
  );
});
