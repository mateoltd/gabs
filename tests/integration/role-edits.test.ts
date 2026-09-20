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
import type { RoleDetails } from "@suite/contracts";
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
      name: "Role edit review",
    }),
  );
  const session = await server.auth.issue(owner.id, true);
  const headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
  const url = `/api/v1/workspaces/${workspace}/roles`;
  const list = () => server.app.inject({ method: "GET", url, headers });
  const roles = (await list()).json<RoleDetails[]>();
  const target = roles.find((r) => r.name === "Sales")!;
  const read = async () =>
    (await list()).json<RoleDetails[]>().find((r) => r.id === target.id)!;
  const create = (key = randomUUID()) =>
    server.app.inject({
      method: "POST",
      url,
      headers: { ...headers, "idempotency-key": key },
      payload: { name: "New role", permissions: [] },
    });
  const edit = (
    body: object,
    key: string | null = randomUUID(),
    id = target.id,
  ) =>
    server.app.inject({
      method: "PUT",
      url: `${url}/${id}`,
      headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) },
      payload: body,
    });
  const auditCount = async () =>
    Number(
      (
        await admin.query<{ count: string }>(
          "select count(*) from suite.audit where workspace_id=$1 and action='roles.saved'",
          [workspace],
        )
      ).rows[0].count,
    );
  return {
    workspace,
    owner,
    headers,
    url,
    list,
    roles,
    target,
    read,
    create,
    edit,
    auditCount,
  };
}
const change = (role: RoleDetails) => ({
  name: role.name,
  permissions: role.permissions,
  revision: role.revision,
});
async function waitForBlocker(pid: number) {
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
}
it("rejects one competing role edit and preserves the winning permissions and audit", async () => {
  const f = await fixture();
  const bodies = [
    { ...change(f.target), name: "First role", permissions: ["orders.read"] },
    {
      ...change(f.target),
      name: "Second role",
      permissions: ["inventory.read"],
    },
  ];
  const replies = await Promise.all(bodies.map((body) => f.edit(body)));
  expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(replies.find((r) => r.statusCode === 409)!.json().code).toBe(
    "ROLE_CHANGED",
  );
  const winner = replies.findIndex((r) => r.statusCode === 200);
  expect(await f.read()).toMatchObject({
    name: bodies[winner].name,
    permissions: bodies[winner].permissions,
  });
  expect(await f.auditCount()).toBe(1);
});
it("replays an accepted role edit without overwriting later state or duplicating audit", async () => {
  const f = await fixture(),
    key = randomUUID();
  const input = { ...change(f.target), permissions: ["orders.read"] };
  const first = await f.edit(input, key);
  expect(first.statusCode, first.body).toBe(200);
  const next = await f.edit({
    ...change(await f.read()),
    name: "Updated later",
    permissions: ["inventory.read"],
  });
  expect(next.statusCode, next.body).toBe(200);
  const current = await f.read();
  const replay = await f.edit(input, key);
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(first.json());
  expect(await f.read()).toEqual(current);
  expect(await f.auditCount()).toBe(2);
  expect((await f.edit({ ...input, name: "Different" }, key)).json().code).toBe(
    "IDEMPOTENCY_CONFLICT",
  );
});
it("rejects unsafe or foreign preconditions, unknown grants and protected roles", async () => {
  const f = await fixture(),
    foreign = await fixture();
  const input = change(f.target);
  expect(
    (await f.edit({ name: f.target.name, permissions: [] })).statusCode,
  ).toBe(400);
  expect((await f.edit(input, null)).json().code).toBe("IDEMPOTENCY_REQUIRED");
  expect(
    (await f.edit({ ...input, revision: "0".repeat(64) })).json().code,
  ).toBe("ROLE_CHANGED");
  expect(
    (await f.edit({ ...input, revision: foreign.target.revision })).json().code,
  ).toBe("ROLE_CHANGED");
  expect(
    (await f.edit(change(foreign.target), randomUUID(), foreign.target.id))
      .statusCode,
  ).toBe(404);
  expect(
    (await f.edit({ ...input, permissions: ["workspace.manage"] })).json().code,
  ).toBe("INVALID_PERMISSION");
  const ownerRole = f.roles.find((r) => r.name === "Owner")!;
  expect(
    (
      await f.edit(
        { ...change(ownerRole), name: "Renamed", permissions: [] },
        randomUUID(),
        ownerRole.id,
      )
    ).json().code,
  ).toBe("PROTECTED_ROLE");
  expect(await f.read()).toEqual(f.target);
  expect(await f.auditCount()).toBe(0);
});
it("detects role changes from another writer while canonical grant order keeps the revision stable", async () => {
  const f = await fixture();
  await admin.query(
    "update suite.roles set permissions=$1 where workspace_id=$2 and id=$3",
    [["orders.read", "inventory.read"], f.workspace, f.target.id],
  );
  expect((await f.edit(change(f.target))).json().code).toBe("ROLE_CHANGED");
  const before = await f.read();
  const reordered = await f.edit({
    ...change(before),
    permissions: [...before.permissions].reverse(),
  });
  expect(reordered.statusCode).toBe(200);
  expect((await f.read()).revision).toBe(before.revision);
});
it("rechecks authority after role reads, creation, edits and receipts wait", async () => {
  for (const action of [
    "list",
    "create",
    "edit",
    "editReplay",
    "createReplay",
  ] as const) {
    for (const lock of action.endsWith("Replay")
      ? ["workspace", "receipt"]
      : ["workspace"]) {
      const f = await fixture(),
        key = randomUUID(),
        input = { ...change(f.target), permissions: [] };
      if (action === "editReplay")
        expect((await f.edit(input, key)).statusCode).toBe(200);
      if (action === "createReplay")
        expect((await f.create(key)).statusCode).toBe(200);
      const auditBefore = await f.auditCount();
      const blocker = await admin.connect();
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
        pending = (
          action === "list"
            ? f.list()
            : action === "create" || action === "createReplay"
              ? f.create(key)
              : f.edit(input, key)
        ).then((r) => r.statusCode);
        await waitForBlocker(pid);
        await blocker.query(
          "update suite.memberships set active=false where workspace_id=$1 and user_id=$2",
          [f.workspace, f.owner.id],
        );
        await blocker.query("commit");
        expect(await pending).toBe(403);
        expect(await f.auditCount()).toBe(auditBefore);
      } finally {
        await blocker.query("rollback");
        blocker.release();
        await pending;
      }
    }
  }
});
