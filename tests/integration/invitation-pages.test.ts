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
import type { InvitationPage } from "@suite/contracts";
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
      name: "Invitation pages",
    }),
  );
  const session = await server.auth.issue(owner.id, true);
  const headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
  const role = (
    await admin.query<{ id: string }>(
      "select id from suite.roles where workspace_id=$1 and name='Viewer'",
      [workspace],
    )
  ).rows[0].id;
  await admin.query(
    `insert into suite.invitations(id, workspace_id, email, role_id, invited_by, created_at, expires_at, state)
    select gen_random_uuid(), $1, 'employee-' || lpad(g::text,3,'0') || '@test.local', $2, $3,
      '2026-01-01'::timestamptz + (g % 3) * interval '0.000001 second',
      now() + case when g % 5 = 0 then interval '-1 day' else interval '7 days' end,
      case g % 5 when 1 then 'accepted' when 2 then 'declined' when 3 then 'revoked' else 'pending' end
    from generate_series(0,124) g`,
    [workspace, role, owner.id],
  );
  const get = (query = "", customHeaders = headers) =>
    server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspace}/invitations${query ? "?" + query : ""}`,
      headers: customHeaders,
    });
  const ordered = () =>
    admin.query<{ id: string; email: string }>(
      "select id,email from suite.invitations where workspace_id=$1 order by created_at desc, id desc",
      [workspace],
    );
  return { owner, workspace, headers, role, get, ordered };
}
it("pages the complete history with timestamp precision and no duplicate rows after a newer insertion", async () => {
  const f = await fixture();
  const expected = (await f.ordered()).rows.map((r) => r.id);
  const first = await f.get();
  expect(first.statusCode, first.body).toBe(200);
  const page = first.json<InvitationPage>();
  expect(page.items).toHaveLength(20);
  expect(page.total).toBe(125);
  expect(page.workspaceTotal).toBe(125);
  expect(page.pendingTotal).toBe(25);
  const ids = page.items.map((r) => r.id);
  await admin.query(
    "insert into suite.invitations(id,workspace_id,email,role_id,invited_by) values($1,$2,'new@test.local',$3,$4)",
    [randomUUID(), f.workspace, f.role, f.owner.id],
  );
  let cursor = page.nextCursor;
  for (let count = 0; cursor && count < 10; count++) {
    const response = await f.get(`cursor=${cursor}&limit=20`);
    expect(response.statusCode, response.body).toBe(200);
    const next = response.json<InvitationPage>();
    expect(next.items.length).toBeLessThanOrEqual(20);
    expect(next.workspaceTotal).toBe(126);
    expect(next.pendingTotal).toBe(26);
    ids.push(...next.items.map((row) => row.id));
    cursor = next.nextCursor;
  }
  expect(cursor).toBeNull();
  expect(ids).toEqual(expected);
  expect(new Set(ids).size).toBe(125);
  expect((await f.get()).json<InvitationPage>().items[0].email).toBe(
    "new@test.local",
  );
});
it("searches beyond the first hundred records and treats wildcard characters literally", async () => {
  const f = await fixture(),
    oldest = (await f.ordered()).rows.at(-1)!;
  const page = (
    await f.get(`search=${encodeURIComponent(oldest.email.toUpperCase())}`)
  ).json<InvitationPage>();
  expect(page.items.map((r) => r.id)).toEqual([oldest.id]);
  expect(page.total).toBe(1);
  expect(page.workspaceTotal).toBe(125);
  expect(page.pendingTotal).toBe(25);
  for (const email of [
    "find%literal@test.local",
    "find_literal@test.local",
    "findXliteral@test.local",
  ]) {
    await admin.query(
      "insert into suite.invitations(id,workspace_id,email,role_id,invited_by) values($1,$2,$3,$4,$5)",
      [randomUUID(), f.workspace, email, f.role, f.owner.id],
    );
  }
  for (const needle of ["find%", "find_"]) {
    const result = (
      await f.get(`search=${encodeURIComponent(needle)}`)
    ).json<InvitationPage>();
    expect(result.total).toBe(1);
    expect(result.items[0].email.startsWith(needle)).toBe(true);
  }
  const all = (await f.get("limit=100")).json<InvitationPage>();
  expect(all.items).toHaveLength(100);
  const expired = (await f.get("search=employee-000")).json<InvitationPage>();
  expect(expired.items[0].state).toBe("expired");
  const empty = (await f.get("search=missing")).json<InvitationPage>();
  expect(empty).toMatchObject({
    items: [],
    nextCursor: null,
    total: 0,
    workspaceTotal: 128,
    pendingTotal: 28,
  });
});
it("bounds requests and refuses foreign or missing cursors without leaking another workspace", async () => {
  const f = await fixture(),
    foreign = await fixture();
  for (const query of [
    "limit=101",
    "limit=0",
    "cursor=bad",
    `search=${"x".repeat(255)}`,
  ])
    expect((await f.get(query)).statusCode).toBe(400);
  for (const cursor of [randomUUID(), (await foreign.ordered()).rows[0].id]) {
    const response = await f.get(`cursor=${cursor}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_CURSOR");
  }
  expect((await f.get("", foreign.headers)).statusCode).toBe(403);
});
it("rechecks current authority after an invitation read waits for the workspace lock", async () => {
  const f = await fixture(),
    blocker = await admin.connect();
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
    pending = f.get().then((r) => r.statusCode);
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
  } finally {
    await blocker.query("rollback");
    blocker.release();
    await pending;
  }
});
