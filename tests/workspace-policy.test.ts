import "dotenv/config";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../packages/server-core/src";

it("seeds policy locks for existing and newly created workspaces before memberships exist", async () => {
  const db = connectDatabase();
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const connection = await admin.connect();
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Policy migration",
      emailVerified: true,
    });
    await connection.query("begin");
    const workspace = randomUUID();
    await connection.query(
      "insert into suite.workspaces(id,owner_user_id,name,kind,currency,offline_hours) values($1,$2,'Empty workspace','company','EUR',24)",
      [workspace, user.id],
    );
    const revision = () =>
      connection.query(
        "select revision from suite.workspace_policy where workspace_id=$1",
        [workspace],
      );
    expect((await revision()).rows).toEqual([{ revision: "1" }]);
    // Reproduce a workspace that predates policy delivery, then run the actual upgrade.
    await connection.query(
      "delete from suite.workspace_policy where workspace_id=$1",
      [workspace],
    );
    const migration = await readFile(
      "packages/server-core/migrations/022_workspace_policy_backfill.sql",
      "utf8",
    );
    await connection.query(migration);
    expect((await revision()).rows).toEqual([{ revision: "0" }]);
    await connection.query(
      "update suite.workspaces set offline_hours=1 where id=$1",
      [workspace],
    );
    expect((await revision()).rows).toEqual([{ revision: "1" }]);
    // A repeated backfill must never reset an established revision.
    await connection.query(migration);
    expect((await revision()).rows).toEqual([{ revision: "1" }]);
  } finally {
    await connection.query("rollback");
    connection.release();
    await admin.end();
    await db.destroy();
  }
});

it("delivers committed policy changes across connections, catches missed revisions and rechecks revoked readers", async () => {
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
  const workspace = randomUUID();
  const foreign = randomUUID();
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Policy watcher",
      emailVerified: true,
    });
    for (const id of [workspace, foreign])
      await inWorkspace(db, id, (tx) =>
        provisionWorkspace(tx, {
          id,
          userId: user.id,
          name: "Policy acceptance",
          kind: "company",
        }),
      );
    const session = await server.auth.issue(user.id, true);
    const read = (since?: string, target = workspace) =>
      server.app
        .inject({
          method: "GET",
          url: `/api/v1/workspaces/${target}/policy${since ? `?since=${since}` : ""}`,
          headers: { cookie: `suite_session=${session.token}` },
        })
        .then((response) => response);
    const first = await read();
    expect(first.statusCode, first.body).toBe(200);
    const revision = first.json().revision;
    expect(revision).toMatch(/^\d+$/);
    expect(first.json().bootstrap.policyRevision).toBe(revision);
    const ordinary = await server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspace}/bootstrap`,
      headers: { cookie: `suite_session=${session.token}` },
    });
    expect(ordinary.json().policyRevision).toBe(revision);
    const pending = read(revision);
    let complete = false;
    void pending.then(() => {
      complete = true;
    });
    await new Promise((r) => setTimeout(r, 60));
    // Another tenant cannot wake this reader or reveal its settings.
    await admin.query(
      "update suite.workspaces set name='Other workspace changed' where id=$1",
      [foreign],
    );
    const tx = await admin.connect();
    try {
      await tx.query("begin");
      await tx.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id='contacts'",
        [workspace],
      );
      await new Promise((r) => setTimeout(r, 60));
      expect(complete).toBe(false);
      await tx.query("rollback");
      expect((await read()).json().revision).toBe(revision);
      await tx.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id='contacts'",
        [workspace],
      );
    } finally {
      tx.release();
    }
    const suspended = await pending;
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(BigInt(suspended.json().revision)).toBeGreaterThan(BigInt(revision));
    expect(
      suspended
        .json()
        .bootstrap.modules.find(
          (m: { moduleId: string }) => m.moduleId === "contacts",
        ).state,
    ).toBe("suspended");
    // A reconnect carrying a stale revision returns the latest policy immediately.
    expect((await read(revision)).json().revision).toBe(
      suspended.json().revision,
    );
    const revoked = read(suspended.json().revision);
    await new Promise((r) => setTimeout(r, 60));
    await admin.query(
      "update suite.memberships set active=false where workspace_id=$1 and user_id=$2",
      [workspace, user.id],
    );
    expect((await revoked).statusCode).toBe(403);
    expect((await read()).statusCode).toBe(403);
    expect((await read(undefined, randomUUID())).statusCode).toBe(403);
    expect((await read("-1", foreign)).statusCode).toBe(400);
    // A logged-out watch must not deliver fresh policy after waking.
    const available = await read(undefined, foreign);
    const loggedOut = read(available.json().revision, foreign);
    await new Promise((r) => setTimeout(r, 60));
    await server.auth.logout(session.token);
    await admin.query(
      "update suite.workspaces set offline_hours=1 where id=$1",
      [foreign],
    );
    expect((await loggedOut).statusCode).toBe(401);
  } finally {
    await server.app.close();
    await db.destroy();
    await admin.end();
  }
});
