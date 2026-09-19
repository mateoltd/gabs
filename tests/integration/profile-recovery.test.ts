import "dotenv/config";
import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/api/src/app";
import {
  connectDatabase,
  identify,
} from "../../composition/src/server/product";
import { hashToken } from "@suite/server-core";
import { SuiteClient, type Transport } from "../../packages/client/src/api";
import { operationPath } from "../../packages/contracts/src";

it("issues account-bound recovery evidence only for recent verified MFA sessions, without renewing them", async () => {
  const db = connectDatabase();
  const server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Recovery account",
      emailVerified: true,
    });
    const session = await server.auth.issue(user.id, true);
    const headers = { cookie: `suite_session=${session.token}` };
    const request = () =>
      server.app.inject({
        method: "GET",
        url: "/api/v1/identity/recovery",
        headers,
      });
    const before = await db
      .selectFrom("suite.sessions")
      .selectAll()
      .where("token_hash", "=", hashToken(session.token))
      .executeTakeFirstOrThrow();
    const clock = await server.app.inject({
      method: "GET",
      url: "/api/v1/identity/recovery-clock",
    });
    expect(clock.statusCode).toBe(200);
    expect(clock.headers["cache-control"]).toBe("no-store");
    expect(clock.headers["x-suite-actor"]).toBeUndefined();
    expect(Object.keys(clock.json())).toEqual(["now"]);
    expect(Date.parse(clock.json().now)).toBeGreaterThanOrEqual(
      before.created_at.getTime(),
    );
    const result = await request();
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["x-suite-actor"]).toBe(user.id);
    const recovery = result.json();
    expect(recovery).toEqual({
      userId: user.id,
      sessionId: expect.stringMatching(/^[a-f0-9]{64}$/),
      authenticatedAt: before.created_at.toISOString(),
      expiresAt: new Date(before.created_at.getTime() + 300_000).toISOString(),
    });
    expect(result.body).not.toContain(session.token);
    expect(result.body).not.toContain(session.csrfToken);
    expect(result.body).not.toContain(before.token_hash);
    expect((await request()).json()).toEqual(recovery);
    const after = await db
      .selectFrom("suite.sessions")
      .selectAll()
      .where("token_hash", "=", hashToken(session.token))
      .executeTakeFirstOrThrow();
    expect(after).toEqual(before);
    const otherSession = await server.auth.issue(user.id, true);
    const changed = await server.app.inject({
      method: "GET",
      url: "/api/v1/identity/recovery",
      headers: { cookie: `suite_session=${otherSession.token}` },
    });
    expect(changed.json().sessionId).not.toBe(recovery.sessionId);
    // Caller claims cannot change the server's session age or identity.
    await db
      .updateTable("suite.sessions")
      .set({ created_at: new Date(Date.now() - 360_000) })
      .where("token_hash", "=", hashToken(session.token))
      .execute();
    const stale = await server.app.inject({
      method: "GET",
      url: "/api/v1/identity/recovery?authenticatedAt=now&mfa=true",
      headers: {
        ...headers,
        "x-authenticated-at": new Date().toISOString(),
        "x-mfa": "true",
      },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().code).toBe("REAUTHENTICATION_REQUIRED");
    // The existing session remains usable; denial of local recovery is not logout.
    expect(
      (await server.app.inject({ method: "GET", url: "/api/v1/me", headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: "/api/v1/identity/recovery",
          headers: {
            cookie: `suite_session=${otherSession.token}`,
            "x-suite-actor": randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(401);
    const noMfa = await server.auth.issue(user.id, false);
    const denied = await server.app.inject({
      method: "GET",
      url: "/api/v1/identity/recovery",
      headers: { cookie: `suite_session=${noMfa.token}`, "x-mfa": "true" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("MFA_REQUIRED");
    await server.auth.logout(otherSession.token);
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: "/api/v1/identity/recovery",
          headers: { cookie: `suite_session=${otherSession.token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.app.inject({
          method: "GET",
          url: "/api/v1/identity/recovery",
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await server.app.close();
    await db.destroy();
  }
});

it("the generated client exposes typed recovery evidence and rejects an unverified account", async () => {
  const db = connectDatabase();
  const server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
  try {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Unverified recovery",
      emailVerified: false,
    });
    const session = await server.auth.issue(user.id, true);
    const transport: Transport = async (request) => {
      const op = operationPath(request);
      const reply = await server.app.inject({
        method: op.method,
        url: op.path,
        headers: { cookie: `suite_session=${session.token}` },
      });
      return {
        status: reply.statusCode,
        body: reply.json(),
        actorId: reply.headers["x-suite-actor"] as string | undefined,
      };
    };
    const client = new SuiteClient(transport);
    await expect(
      client.request({ operation: "profileRecovery" }),
    ).rejects.toMatchObject({ status: 403, code: "MFA_REQUIRED" });
    await db
      .updateTable("suite.users")
      .set({ email_verified: true })
      .where("id", "=", user.id)
      .execute();
    const result = await client.request({ operation: "profileRecovery" });
    const account: string = result.userId;
    expect(account).toBe(user.id);
    expect(
      Date.parse(result.expiresAt) - Date.parse(result.authenticatedAt),
    ).toBe(300_000);
    await db
      .updateTable("suite.users")
      .set({ active: false })
      .where("id", "=", user.id)
      .execute();
    await expect(
      client.request({ operation: "profileRecovery" }),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  } finally {
    await server.app.close();
    await db.destroy();
  }
});
