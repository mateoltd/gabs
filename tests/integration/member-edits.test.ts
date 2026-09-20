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
import type { MemberSchema, Static } from "@suite/contracts";
const db = connectDatabase();
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let server: Awaited<ReturnType<typeof createApp>>;
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
  await server.app.close();
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
      name: "Member edit review",
    }),
  );
  const session = await server.auth.issue(owner.id, true);
  const headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
  const url = `/api/v1/workspaces/${workspace}`;
  const members = async () =>
    (
      await server.app.inject({ method: "GET", url: `${url}/members`, headers })
    ).json<Static<typeof MemberSchema>[]>();
  const roles = (
    await server.app.inject({ method: "GET", url: `${url}/roles`, headers })
  ).json<{ id: string; name: string }[]>();
  const sales = roles.find((r) => r.name === "Sales")!.id;
  const warehouse = roles.find((r) => r.name === "Warehouse")!.id;
  const user = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `${randomUUID()}@test.local`,
    name: "Team member",
    emailVerified: true,
  });
  const target = randomUUID();
  await admin.query(
    "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
    [target, workspace, user.id],
  );
  await admin.query(
    "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
    [workspace, target, sales],
  );
  const read = async () => (await members()).find((m) => m.id === target)!;
  const patch = (
    body: object,
    key: string | undefined = randomUUID(),
    id: string = target,
  ) =>
    server.app.inject({
      method: "PATCH",
      url: `${url}/members/${id}`,
      headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) },
      payload: body,
    });
  const auditCount = async () =>
    Number(
      (
        await admin.query<{ count: string }>(
          "select count(*) from suite.audit where workspace_id=$1 and action in ('members.updated','members.removed') and target_id=$2",
          [workspace, target],
        )
      ).rows[0].count,
    );
  return {
    workspace,
    headers,
    url,
    owner,
    target,
    sales,
    warehouse,
    members,
    read,
    patch,
    auditCount,
  };
}
it("rejects a stale concurrent member edit without overwriting access or duplicating audit", async () => {
  const f = await fixture();
  const before = await f.read();
  const results = await Promise.all([
    f.patch({
      revision: before.revision,
      active: true,
      roleIds: [f.warehouse],
      modules: [],
      directModules: [],
    }),
    f.patch({
      revision: before.revision,
      active: true,
      roleIds: [f.sales, f.warehouse],
      modules: [],
      directModules: [],
    }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().code).toBe(
    "MEMBER_CHANGED",
  );
  const after = await f.read();
  expect(after.roles.map((r) => r.id).sort()).toEqual(
    (results[0].statusCode === 200
      ? [f.warehouse]
      : [f.sales, f.warehouse]
    ).sort(),
  );
  expect(await f.auditCount()).toBe(1);
});

it("replays an accepted edit after later changes without reverting access or repeating its audit", async () => {
  const f = await fixture(),
    before = await f.read(),
    key = randomUUID();
  const input = {
    revision: before.revision,
    active: true,
    roleIds: [f.warehouse],
    modules: [],
    directModules: [],
  };
  const first = await f.patch(input, key);
  expect(first.statusCode, first.body).toBe(200);
  const next = await f.read();
  const second = await f.patch({
    ...input,
    revision: next.revision,
    roleIds: [f.sales, f.warehouse],
  });
  expect(second.statusCode, second.body).toBe(200);
  const current = await f.read();
  const replay = await f.patch(input, key);
  expect(replay.statusCode, replay.body).toBe(200);
  expect(replay.json()).toEqual(first.json());
  expect(await f.read()).toEqual(current);
  expect(await f.auditCount()).toBe(2);
  const different = await f.patch({ ...input, active: false }, key);
  expect(different.statusCode).toBe(409);
  expect(different.json().code).toBe("IDEMPOTENCY_CONFLICT");
  expect(await f.auditCount()).toBe(2);
});

it("detects direct grants changed outside member editing and ignores input ordering", async () => {
  const f = await fixture(),
    before = await f.read();
  await admin.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id,direct) values($1,$2,'contacts',true)",
    [f.workspace, f.target],
  );
  const stale = await f.patch({
    revision: before.revision,
    active: true,
    roleIds: [f.sales],
    modules: [],
    directModules: [],
  });
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().code).toBe("MEMBER_CHANGED");
  expect((await f.read()).directModules).toEqual(["contacts"]);
  expect(await f.auditCount()).toBe(0);
  const current = await f.read();
  const change = await f.patch({
    revision: current.revision,
    active: true,
    roleIds: [f.warehouse, f.sales],
    modules: ["contacts"],
    directModules: ["contacts"],
  });
  expect(change.statusCode, change.body).toBe(200);
  const ordered = await f.read();
  const reorder = await f.patch({
    revision: ordered.revision,
    active: true,
    roleIds: [f.sales, f.warehouse],
    modules: ["contacts"],
    directModules: ["contacts"],
  });
  expect(reorder.statusCode, reorder.body).toBe(200);
  expect((await f.read()).revision).toBe(ordered.revision);
});

it("requires a revision and retry key, rejects forged or foreign revisions and preserves the last owner", async () => {
  const f = await fixture(),
    other = await fixture(),
    before = await f.read();
  const input = {
    active: true,
    roleIds: [f.sales],
    modules: [],
    directModules: [],
  };
  expect((await f.patch(input)).statusCode).toBe(400);
  const withoutKey = await f.patch({ ...input, revision: before.revision }, "");
  expect(withoutKey.statusCode).toBe(400);
  expect(withoutKey.json().code).toBe("IDEMPOTENCY_REQUIRED");
  const forged = await f.patch({ ...input, revision: "0".repeat(64) });
  expect(forged.statusCode).toBe(409);
  expect(forged.json().code).toBe("MEMBER_CHANGED");
  const foreign = await f.patch(
    { ...input, revision: (await other.read()).revision },
    randomUUID(),
    other.target,
  );
  expect(foreign.statusCode).toBe(404);
  const owner = (await f.members()).find(
    (member) => member.userId === f.owner.id,
  )!;
  const lastOwner = await f.patch(
    { ...input, revision: owner.revision, active: false, roleIds: [] },
    randomUUID(),
    owner.id,
  );
  expect(lastOwner.statusCode).toBe(409);
  expect(lastOwner.json().code).toBe("LAST_OWNER");
  expect(await f.read()).toEqual(before);
  expect(await f.auditCount()).toBe(0);
});

it("rechecks membership after access reads and edits wait for the workspace lock", async () => {
  for (const method of ["GET", "PATCH"] as const) {
    const f = await fixture(),
      before = await f.read();
    const blocker = await admin.connect();
    let pending: Promise<number> | undefined;
    try {
      await blocker.query("begin");
      const pid = (
        await blocker.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0].pid;
      await blocker.query(
        "select id from suite.workspaces where id=$1 for update",
        [f.workspace],
      );
      pending = server.app
        .inject({
          method,
          url: `${f.url}/members${method === "PATCH" ? `/${f.target}` : ""}`,
          headers: { ...f.headers, "idempotency-key": randomUUID() },
          ...(method === "PATCH"
            ? {
                payload: {
                  revision: before.revision,
                  active: true,
                  roleIds: [f.warehouse],
                  modules: [],
                  directModules: [],
                },
              }
            : {}),
        })
        .then((response) => response.statusCode);
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
      expect(await f.auditCount()).toBe(0);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await pending;
    }
  }
});
