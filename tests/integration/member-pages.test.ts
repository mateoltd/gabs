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
import { seedMemberPages } from "../support/member-pages-fixture";
import type { Member, MemberPage } from "@suite/contracts";
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
  try {
    await server?.app.close();
  } finally {
    await Promise.all([admin.end(), db.destroy()]);
  }
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
      name: "Member pages",
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
  await seedMemberPages(admin, workspace);
  const get = (query = "", customHeaders = headers) =>
    server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspace}/members${query ? "?" + query : ""}`,
      headers: customHeaders,
    });
  const ordered = () =>
    admin.query<{ id: string; email: string }>(
      "select m.id,u.email from suite.memberships m join suite.users u on u.id=m.user_id where m.workspace_id=$1 order by u.name,m.id",
      [workspace],
    );
  return { owner, workspace, headers, role, get, ordered };
}
it("bounds hydration, pages tied names without duplicates and keeps workspace summaries", async () => {
  const f = await fixture();
  await admin.query(
    `update suite.users set name='Team 000' where issuer='member-pages' and subject like $1 and name < 'Team 010'`,
    [f.workspace + ":%"],
  );
  const expected = (await f.ordered()).rows.map((r) => r.id);
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await f.get(cursor ? `cursor=${cursor}` : "");
    expect(result.statusCode, result.body).toBe(200);
    const page = result.json<MemberPage>();
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(page.workspaceTotal).toBe(126);
    expect(page.activeTotal).toBe(121);
    expect(page.roleCounts[f.role]).toBe(120);
    ids.push(...page.items.map((r) => r.id));
    cursor = page.nextCursor;
    expect(ids.length).toBeLessThanOrEqual(126);
  } while (cursor);
  expect(ids).toEqual(expected);
  expect(new Set(ids).size).toBe(126);
  const response = await f.get("limit=100");
  expect(response.json<MemberPage>().items).toHaveLength(100);
});
it("searches name, email and role across every member with literal wildcard matching", async () => {
  const f = await fixture();
  for (const search of ["TEAM 124", "STAFF-124"]) {
    const page = (
      await f.get(`search=${encodeURIComponent(search)}`)
    ).json<MemberPage>();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].email).toBe("staff-124@test.local");
    expect(page.total).toBe(1);
    expect(page.workspaceTotal).toBe(126);
    expect(page.activeTotal).toBe(121);
  }
  const viewer = (await f.get("search=Viewer")).json<MemberPage>();
  expect(viewer.total).toBe(125);
  expect(viewer.items).toHaveLength(20);
  expect(viewer.roleCounts[f.role]).toBe(120);
  await admin.query(
    `update suite.users set name='Literal %_ employee' where issuer='member-pages' and subject=$1`,
    [f.workspace + ":124"],
  );
  const literal = (await f.get("search=%25_")).json<MemberPage>();
  expect(literal.total).toBe(1);
  const none = (await f.get("search=nobody-matches")).json<MemberPage>();
  expect(none.items).toEqual([]);
  expect(none.nextCursor).toBeNull();
  expect(none.workspaceTotal).toBe(126);
});
it("reads current off-page details, rejects foreign members and validates page inputs", async () => {
  const f = await fixture(),
    other = await fixture();
  const last = (await f.ordered()).rows.at(-1)!;
  const detail = await server.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${f.workspace}/members/${last.id}`,
    headers: f.headers,
  });
  expect(detail.statusCode, detail.body).toBe(200);
  const member = detail.json<Member>();
  expect(member.email).toBe("staff-124@test.local");
  expect(member.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(member.roles.map((r) => r.id)).toEqual([f.role]);
  const foreign = (await other.ordered()).rows[0].id;
  for (const id of [foreign, randomUUID()]) {
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/workspaces/${f.workspace}/members/${id}`,
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect((await f.get(`cursor=${id}`)).statusCode).toBe(400);
  }
  for (const query of [
    "limit=0",
    "limit=101",
    "cursor=bad",
    "search=" + "x".repeat(255),
  ])
    expect((await f.get(query)).statusCode).toBe(400);
  expect((await f.get("", other.headers)).statusCode).toBe(403);
  expect(
    (
      await server.app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${f.workspace}/members/${last.id}`,
        headers: other.headers,
      })
    ).statusCode,
  ).toBe(403);
});
it("reauthorizes list and detail reads after waiting for workspace access changes", async () => {
  for (const detail of [false, true]) {
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
      const id = (await f.ordered()).rows.at(-1)!.id;
      pending = server.app
        .inject({
          method: "GET",
          url: `/api/v1/workspaces/${f.workspace}/members${detail ? "/" + id : ""}`,
          headers: f.headers,
        })
        .then((r) => r.statusCode);
      await expect
        .poll(async () =>
          Number(
            (
              await admin.query(
                "select count(*) n from pg_stat_activity where $1=any(pg_blocking_pids(pid))",
                [pid],
              )
            ).rows[0].n,
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
  }
});
