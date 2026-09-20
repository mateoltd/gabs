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
  const person = async (name: string) => {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name,
      emailVerified: true,
    });
    const session = await server.auth.issue(user.id, true);
    return {
      user,
      headers: {
        cookie: `suite_session=${session.token}`,
        origin: "http://localhost:4300",
        "x-csrf-token": session.csrfToken,
      },
    };
  };
  const owner = await person("Owner"),
    invitee = await person("Invitee");
  const workspace = randomUUID();
  await inWorkspace(db, workspace, (tx) =>
    provisionWorkspace(tx, {
      id: workspace,
      userId: owner.user.id,
      kind: "company",
      name: "Invitation transitions",
    }),
  );
  const url = `/api/v1/workspaces/${workspace}`;
  const roles = (
    await server.app.inject({
      method: "GET",
      url: `${url}/roles`,
      headers: owner.headers,
    })
  ).json<{ id: string; name: string }[]>();
  const sales = roles.find((role) => role.name === "Sales")!.id;
  const create = (key = randomUUID()) =>
    server.app.inject({
      method: "POST",
      url: `${url}/invitations`,
      headers: { ...owner.headers, "idempotency-key": key },
      payload: { email: invitee.user.email, roleId: sales },
    });
  const originalKey = randomUUID();
  const made = await create(originalKey);
  expect(made.statusCode, made.body).toBe(200);
  const id = made.json<{ id: string }>().id;
  const revoke = (target = id) =>
    server.app.inject({
      method: "DELETE",
      url: `${url}/invitations/${target}`,
      headers: owner.headers,
    });
  const respond = (accept: boolean) =>
    server.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${id}/${accept ? "accept" : "decline"}`,
      headers: invitee.headers,
      payload: {},
    });
  const auditCount = async (action: string) =>
    Number(
      (
        await admin.query<{ count: string }>(
          "select count(*) from suite.audit where workspace_id=$1 and target_id=$2 and action=$3",
          [workspace, id, action],
        )
      ).rows[0].count,
    );
  const read = async () =>
    (
      await admin.query<{ state: string }>(
        "select state from suite.invitations where id=$1",
        [id],
      )
    ).rows[0].state;
  const membership = async () =>
    (
      await admin.query<{ active: boolean }>(
        "select active from suite.memberships where workspace_id=$1 and user_id=$2",
        [workspace, invitee.user.id],
      )
    ).rows[0];
  return {
    owner,
    originalKey,
    roles,
    invitee,
    workspace,
    url,
    id,
    create,
    revoke,
    respond,
    auditCount,
    read,
    membership,
  };
}
async function waitForBlocker(pid: number, count: number) {
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
    .toBeGreaterThanOrEqual(count);
}
it("serializes acceptance and revocation without overwriting the winning result", async () => {
  for (const first of ["accept", "revoke"] as const) {
    const f = await fixture(),
      blocker = await admin.connect();
    const pending: Promise<number>[] = [];
    try {
      await blocker.query("begin");
      const pid = (
        await blocker.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0].pid;
      await blocker.query(
        "select id from suite.workspaces where id=$1 for update",
        [f.workspace],
      );
      pending.push(
        (first === "accept" ? f.respond(true) : f.revoke()).then(
          (result) => result.statusCode,
        ),
      );
      await waitForBlocker(pid, 1);
      pending.push(
        (first === "accept" ? f.revoke() : f.respond(true)).then(
          (result) => result.statusCode,
        ),
      );
      // PostgreSQL can show the first queued waiter as a soft blocker of the second.
      await expect
        .poll(async () =>
          Number(
            (
              await admin.query<{ count: string }>(
                "select count(*) from pg_stat_activity where datname=current_database() and cardinality(pg_blocking_pids(pid))>0",
              )
            ).rows[0].count,
          ),
        )
        .toBeGreaterThanOrEqual(2);
      await blocker.query("commit");
      expect(await Promise.all(pending)).toEqual([200, 409]);
      expect(await f.read()).toBe(first === "accept" ? "accepted" : "revoked");
      expect(!!(await f.membership())?.active).toBe(first === "accept");
      expect(await f.auditCount("invitations.accepted")).toBe(
        first === "accept" ? 1 : 0,
      );
      expect(await f.auditCount("invitations.revoked")).toBe(
        first === "revoke" ? 1 : 0,
      );
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await Promise.all(pending);
    }
  }
});

it("acknowledges duplicate revocations and declines without duplicate audit or affecting replacement invitations", async () => {
  const f = await fixture();
  expect((await f.revoke()).statusCode).toBe(200);
  const replacement = await f.create();
  expect(replacement.statusCode, replacement.body).toBe(200);
  expect((await f.revoke()).statusCode).toBe(200);
  expect(await f.auditCount("invitations.revoked")).toBe(1);
  const current = (
    await admin.query<{ state: string }>(
      "select state from suite.invitations where id=$1",
      [replacement.json<{ id: string }>().id],
    )
  ).rows[0];
  expect(current.state).toBe("pending");
  expect((await f.respond(true)).statusCode).toBe(409);
  expect(await f.membership()).toBeUndefined();
  const declined = await fixture();
  expect((await declined.respond(false)).statusCode).toBe(200);
  expect((await declined.respond(false)).statusCode).toBe(200);
  expect(await declined.auditCount("invitations.declined")).toBe(1);
  expect((await declined.revoke()).statusCode).toBe(409);
  expect((await declined.respond(true)).statusCode).toBe(409);
  expect(await declined.read()).toBe("declined");
});

it("rechecks administrator authority after create, revoke and creation replay wait", async () => {
  for (const action of ["create", "revoke", "replay"] as const) {
    const f = await fixture();
    if (action === "create") expect((await f.revoke()).statusCode).toBe(200);
    const before = await f.read();
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
      pending = (
        action === "revoke"
          ? f.revoke()
          : f.create(action === "replay" ? f.originalKey : randomUUID())
      ).then((result) => result.statusCode);
      await waitForBlocker(pid, 1);
      await blocker.query(
        "update suite.memberships set active=false where workspace_id=$1 and user_id=$2",
        [f.workspace, f.owner.user.id],
      );
      await blocker.query("commit");
      expect(await pending).toBe(403);
      expect(await f.read()).toBe(before);
      expect(
        Number(
          (
            await admin.query<{ count: string }>(
              "select count(*) from suite.invitations where workspace_id=$1",
              [f.workspace],
            )
          ).rows[0].count,
        ),
      ).toBe(1);
      expect(await f.auditCount("invitations.created")).toBe(1);
      expect(await f.auditCount("invitations.revoked")).toBe(
        action === "create" ? 1 : 0,
      );
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await pending;
    }
  }
});

it("preserves ownership, workspace and verified-account boundaries during retries", async () => {
  const f = await fixture();
  const other = await fixture();
  expect((await f.revoke(other.id)).statusCode).toBe(404);
  const ownerRole = f.roles.find((role) => role.name === "Owner")!.id;
  await admin.query("update suite.invitations set role_id=$1 where id=$2", [
    ownerRole,
    f.id,
  ]);
  // Give the invitee ordinary Administrator authority, never ownership.
  const membershipId = randomUUID();
  await admin.query(
    "insert into suite.memberships(id, workspace_id, user_id) values($1,$2,$3)",
    [membershipId, f.workspace, f.invitee.user.id],
  );
  await admin.query(
    "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
    [
      f.workspace,
      membershipId,
      f.roles.find((role) => role.name === "Administrator")!.id,
    ],
  );
  const asAdmin = () =>
    server.app.inject({
      method: "DELETE",
      url: `${f.url}/invitations/${f.id}`,
      headers: f.invitee.headers,
    });
  expect((await asAdmin()).statusCode).toBe(403);
  expect((await f.revoke()).statusCode).toBe(200);
  expect((await asAdmin()).statusCode).toBe(403);
  expect(await f.auditCount("invitations.revoked")).toBe(1);
  const wrong = await server.app.inject({
    method: "POST",
    url: `/api/v1/invitations/${other.id}/decline`,
    headers: f.invitee.headers,
    payload: {},
  });
  expect(wrong.statusCode).toBe(404);
  expect(await other.read()).toBe("pending");
});
