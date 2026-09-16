import "dotenv/config";
import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineModule, Type } from "@suite/module-sdk";
import { signPackage } from "../packages/module-sdk/node/signing";
import { startRegistryConsole } from "../tooling/registry-console/server";
describe("Protected registry operator console", () => {
  it("rejects application credentials and protects review actions with operator authentication and same-origin CSRF checks", async () => {
    const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const publicKey = await readFile(`${keys}/public.pem`, "utf8");
    const assets = await mkdtemp(join(tmpdir(), "suite-console-"));
    const application = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    try {
      await expect(
        startRegistryConsole({ pool: application, publicKey, assets, port: 0 }),
      ).rejects.toThrow(/operator connection/);
    } finally {
      await application.end();
    }
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
      options: "-c role=suite_registry",
    });
    const consoleServer = await startRegistryConsole({
      pool,
      publicKey,
      assets,
      port: 0,
    });
    const { origin, accessCode } = consoleServer;
    const id = `console-${randomUUID().slice(0, 8)}`;
    const pkg = signPackage(
      defineModule({
        id,
        name: "Console acceptance",
        version: "1.0.0",
        description: "Fixture",
        host: "^1.0.0",
        backend: "^1.0.0",
        publisher: "suite",
        dependencies: {},
        permissions: [],
        configuration: Type.Object({}),
        operations: {},
        resources: {},
      }),
      await readFile(`${keys}/private.pem`, "utf8"),
    );
    try {
      expect((await fetch(`${origin}/api/submissions`)).status).toBe(401);
      expect(
        (
          await fetch(`${origin}/api/session`, {
            method: "POST",
            headers: {
              origin: "https://untrusted.example",
              "content-type": "application/json",
            },
            body: JSON.stringify({ code: accessCode }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${origin}/api/session`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ code: "incorrect" }),
          })
        ).status,
      ).toBe(401);
      const login = await fetch(`${origin}/api/session`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ code: accessCode }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly; SameSite=Strict");
      const session = (await login.json()) as { csrf: string; actor: string };
      const headers = {
        origin,
        cookie: cookie.split(";")[0],
        "content-type": "application/json",
        "x-csrf-token": session.csrf,
      };
      const rebound = await new Promise<number | undefined>(
        (accept, reject) => {
          const req = httpRequest(
            `${origin}/api/submissions`,
            { headers: { ...headers, host: "untrusted.example" } },
            (res) => {
              res.resume();
              res.on("end", () => accept(res.statusCode));
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
      expect(rebound).toBe(403);
      const upload = (client = pkg, extra = {}) =>
        fetch(`${origin}/api/submissions`, {
          method: "POST",
          headers: { ...headers, ...extra },
          body: JSON.stringify({ client, server: null }),
        });
      expect((await upload(pkg, { "x-csrf-token": "wrong" })).status).toBe(403);
      const corrupt = structuredClone(pkg);
      corrupt.artifact.name = "Tampered";
      expect((await upload(corrupt)).status).toBe(400);
      const submitted = await upload();
      expect(submitted.status).toBe(200);
      const { id: submission } = (await submitted.json()) as { id: string };
      const action = (payload: unknown) =>
        fetch(`${origin}/api/submissions/${submission}`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      expect((await action({ action: "publish" })).status).toBe(400);
      expect((await action({ action: "approve", reason: " " })).status).toBe(
        400,
      );
      expect(
        (
          await action({
            action: "approve",
            reason: "Reviewed HTTP acceptance fixture",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await action({
            action: "approve",
            reason: "Reviewed HTTP acceptance fixture",
          })
        ).status,
      ).toBe(200);
      expect(
        (await action({ action: "reject", reason: "Changed mind" })).status,
      ).toBe(400);
      expect((await action({ action: "publish" })).status).toBe(200);
      expect((await action({ action: "publish" })).status).toBe(200);
      const detail = (await (
        await fetch(`${origin}/api/submissions/${submission}`, { headers })
      ).json()) as {
        events: { action: string; actor: string }[];
        state: string;
      };
      expect(detail.state).toBe("published");
      expect(detail.events.map((e) => e.action)).toEqual([
        "submitted",
        "approved",
        "published",
      ]);
      expect(detail.events.every((e) => e.actor === session.actor)).toBe(true);
      expect(
        (await fetch(`${origin}/api/session`, { method: "DELETE", headers }))
          .status,
      ).toBe(200);
      expect(
        (await fetch(`${origin}/api/submissions`, { headers })).status,
      ).toBe(401);
    } finally {
      await consoleServer.close();
      await pool.end();
      const admin = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      });
      await admin.query(
        "delete from suite.module_releases where module_id=$1",
        [id],
      );
      await admin.query(
        "delete from suite.module_review_events where submission_id in (select id from suite.module_submissions where module_id=$1)",
        [id],
      );
      await admin.query(
        "delete from suite.module_submissions where module_id=$1",
        [id],
      );
      await admin.end();
      await rm(assets, { recursive: true, force: true });
    }
  });
});
