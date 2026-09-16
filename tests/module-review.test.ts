import "dotenv/config";
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { ModuleDefinition } from "@suite/module-sdk";
import { buildServerPackage } from "../packages/module-sdk/node/build-server";
import { signPackage } from "../packages/module-sdk/node/signing";
import {
  verifyServerPackage,
  signServerPackage,
} from "../packages/module-sdk/node/server-package";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../tooling/registry-review";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../packages/server-core/src";

describe("Reviewed independent server releases", () => {
  it("keeps review immutable, blocks premature publication and executes staged code without a host rebuild", async () => {
    if (!process.env.MIGRATION_DATABASE_URL)
      throw Error("Explicit fixture publisher required");
    const publisher = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    const registry = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
      options: "-c role=suite_registry",
    });
    const db = connectDatabase();
    const app = await createApp({
      db,
      auth: {
        mode: "development",
        origin: "http://localhost:4300",
        apiOrigin: "http://localhost:4310",
        mfaClaim: "mfa",
      },
    });
    const id = `review-${randomUUID().slice(0, 8)}`;
    await mkdir(".local", { recursive: true });
    const directory = await mkdtemp(resolve(".local/review-test-"));
    try {
      for (const name of ["module.ts", "module-server.ts"]) {
        await writeFile(
          resolve(directory, name),
          (
            await readFile(`tests/fixtures/reviewed-notes/${name}`, "utf8")
          ).replaceAll("reviewed-notes", id),
        );
      }
      const module = (
        await import(pathToFileURL(resolve(directory, "module.ts")).href)
      ).default as ModuleDefinition;
      const keyDirectory =
        process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
      const privateKey = await readFile(`${keyDirectory}/private.pem`, "utf8");
      const publicKey = await readFile(`${keyDirectory}/public.pem`, "utf8");
      const client = signPackage(module, privateKey);
      const server = await buildServerPackage(module, directory, privateKey);
      expect(verifyServerPackage(server, publicKey)).toBe(server);
      const corrupt = structuredClone(server);
      corrupt.payload.javascript += "\nthrow Error('unreviewed');";
      expect(() => verifyServerPackage(corrupt, publicKey)).toThrow(
        /signature|checksum/,
      );
      await expect(
        submitRelease(registry, client, null, publicKey),
      ).rejects.toThrow(/server component/);
      await expect(
        submitRelease(registry, client, corrupt, publicKey),
      ).rejects.toThrow(/signature|checksum/);
      const submission = await submitRelease(
        registry,
        client,
        server,
        publicKey,
      );
      expect(await submitRelease(registry, client, server, publicKey)).toBe(
        submission,
      );
      await expect(
        stageRelease(registry, submission, publicKey),
      ).rejects.toThrow(/Approve/);
      await expect(
        publishRelease(registry, submission, publicKey),
      ).rejects.toThrow(/approved/);
      await expect(
        publisher.query(
          "insert into suite.module_releases(module_id,version,manifest,digest,signature,key_id,artifact) values($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            client.version,
            client.manifest,
            client.digest,
            client.signature,
            client.key_id,
            client.artifact,
          ],
        ),
      ).rejects.toThrow(/approved/);
      await expect(
        publisher.query(
          "update suite.module_submissions set client_package='{}' where id=$1",
          [submission],
        ),
      ).rejects.toThrow(/immutable/);
      await reviewRelease(
        registry,
        submission,
        "approved",
        "Reviewed exact fixture code and contract",
        publicKey,
      );
      await expect(
        publishRelease(registry, submission, publicKey),
      ).rejects.toThrow(/Stage/);
      await stageRelease(registry, submission, publicKey);
      await Promise.all([
        publishRelease(registry, submission, publicKey),
        publishRelease(registry, submission, publicKey),
      ]);
      const decisions = await publisher.query(
        "select action from suite.module_review_events where submission_id=$1 order by id",
        [submission],
      );
      expect(decisions.rows.map((r) => r.action)).toEqual([
        "submitted",
        "approved",
        "staged",
        "published",
      ]);

      // The API was started before publication and has no source catalogue entry for this module.
      const user = await identify(db, {
        issuer: "test",
        subject: randomUUID(),
        name: "Reviewed module owner",
        email: `${randomUUID()}@test.local`,
        emailVerified: true,
      });
      const workspace = randomUUID();
      await inWorkspace(db, workspace, (tx) =>
        provisionWorkspace(tx, {
          id: workspace,
          userId: user.id,
          name: "Independent backend",
          kind: "company",
        }),
      );
      await publisher.query(
        "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
        [workspace, id],
      );
      await publisher.query(
        "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
        [workspace, id],
      );
      await publisher.query(
        "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
        [workspace, id],
      );
      await publisher.query(
        "update suite.roles set permissions=permissions || $2::text[] where workspace_id=$1 and protected",
        [workspace, module.permissions],
      );
      const session = await app.auth.issue(user.id, true);
      const invoke = (key: string, fail = false) =>
        app.app.inject({
          method: "POST",
          url: `/api/v1/module/${id}/workspaces/${workspace}/operations/capture`,
          headers: {
            cookie: `suite_session=${session.token}`,
            origin: "http://localhost:4300",
            "x-csrf-token": session.csrfToken,
            "idempotency-key": key,
          },
          payload: {
            name: fail ? "Undo this note" : "Independent server",
            fail,
          },
        });
      const key = randomUUID();
      const response = await invoke(key);
      expect(response.statusCode, response.body).toBe(200);
      expect((await invoke(key)).json()).toEqual(response.json());
      const counts = async () =>
        (
          await publisher.query(
            "select (select count(*) from suite.module_records where workspace_id=$1) as records,(select count(*) from suite.outbox where workspace_id=$1) as events,(select count(*) from suite.audit where workspace_id=$1) as audits,(select count(*) from suite.idempotency where workspace_id=$1) as retries",
            [workspace],
          )
        ).rows[0];
      const before = await counts();
      expect(before.records).toBe("1");
      const rejected = await invoke(randomUUID(), true);
      expect(rejected.json().code).toBe("MODULE_BUSINESS_ERROR");
      expect(await counts()).toEqual(before);
      await publisher.query(
        "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
        [workspace, `${id}.capture`],
      );
      expect((await invoke(randomUUID())).statusCode).toBe(403);
      expect(await counts()).toEqual(before);

      // Retain independently deployed old backends for workspace version pins.
      await publisher.query(
        "update suite.roles set permissions=permissions || $2::text[] where workspace_id=$1 and protected",
        [workspace, [`${id}.capture`]],
      );
      const nextModule = { ...module, version: "1.0.3" };
      await writeFile(
        resolve(directory, "module.ts"),
        (await readFile(resolve(directory, "module.ts"), "utf8")).replace(
          'version: "1.0.0"',
          'version: "1.0.3"',
        ),
      );
      await writeFile(
        resolve(directory, "module-server.ts"),
        (
          await readFile(resolve(directory, "module-server.ts"), "utf8")
        ).replace("name: input.name", 'name: "New backend: " + input.name'),
      );
      const nextServer = await buildServerPackage(
        nextModule,
        directory,
        privateKey,
      );
      const nextId = await submitRelease(
        registry,
        signPackage(nextModule, privateKey),
        nextServer,
        publicKey,
      );
      await reviewRelease(
        registry,
        nextId,
        "approved",
        "Reviewed compatible next backend",
        publicKey,
      );
      await stageRelease(registry, nextId, publicKey);
      await publishRelease(registry, nextId, publicKey);
      const newest = await invoke(randomUUID());
      expect(newest.statusCode, newest.body).toBe(200);
      expect(
        (
          await publisher.query(
            "select data from suite.module_records where workspace_id=$1 and id=$2",
            [workspace, newest.json().id],
          )
        ).rows[0].data.name,
      ).toBe("New backend: Independent server");
      await publisher.query(
        "insert into suite.platform_settings(workspace_id,key,value,version) values($1,$2,$3,1)",
        [workspace, `pin:${id}`, { version: "1.0.0" }],
      );
      const pinned = await invoke(randomUUID());
      expect(pinned.statusCode, pinned.body).toBe(200);
      expect(
        (
          await publisher.query(
            "select data from suite.module_records where workspace_id=$1 and id=$2",
            [workspace, pinned.json().id],
          )
        ).rows[0].data.name,
      ).toBe("Independent server");

      // A reviewed but broken executable must not expose its client release.
      const brokenModule = { ...module, version: "1.0.2" };
      const brokenClient = signPackage(brokenModule, privateKey);
      const brokenServer = signServerPackage(
        brokenModule,
        "export function createServer() { throw Error('Stage failure'); }",
        privateKey,
      );
      const brokenId = await submitRelease(
        registry,
        brokenClient,
        brokenServer,
        publicKey,
      );
      await expect(stageRelease(registry, brokenId, publicKey)).rejects.toThrow(
        /Approve/,
      );
      await reviewRelease(
        registry,
        brokenId,
        "approved",
        "Fixture for failed staging recovery",
        publicKey,
      );
      await expect(stageRelease(registry, brokenId, publicKey)).rejects.toThrow(
        "Stage failure",
      );
      expect(
        (
          await registry.query(
            "select staged_at from suite.module_submissions where id=$1",
            [brokenId],
          )
        ).rows[0].staged_at,
      ).toBeNull();
      await expect(
        publishRelease(registry, brokenId, publicKey),
      ).rejects.toThrow(/Stage/);

      const rejectedClient = signPackage(
        { ...module, version: "1.0.1", operations: {} },
        privateKey,
      );
      const rejection = await submitRelease(
        registry,
        rejectedClient,
        null,
        publicKey,
      );
      await reviewRelease(
        registry,
        rejection,
        "rejected",
        "Changes require a new version",
        publicKey,
      );
      await expect(
        reviewRelease(registry, rejection, "approved", "Override", publicKey),
      ).rejects.toThrow(/immutable/);
      await expect(
        publishRelease(registry, rejection, publicKey),
      ).rejects.toThrow(/approved/);
      expect(
        (
          await publisher.query(
            "select count(*) from suite.module_releases where module_id=$1",
            [id],
          )
        ).rows[0].count,
      ).toBe("2");
    } finally {
      await app.app.close();
      await db.destroy();
      await publisher.query(
        "delete from suite.module_releases where module_id=$1",
        [id],
      );
      await publisher.query(
        "delete from suite.module_review_events where submission_id in (select id from suite.module_submissions where module_id=$1)",
        [id],
      );
      await publisher.query(
        "delete from suite.module_submissions where module_id=$1",
        [id],
      );
      await registry.end();
      await publisher.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
