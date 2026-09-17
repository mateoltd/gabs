import "dotenv/config";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import { createApp } from "../../apps/api/src/app";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import { signPackage } from "../../packages/sdk/node/signing";
describe("Independent module distribution", () => {
  it("loads a fifth signed module from the registry and serves its resource without host source edits", async () => {
    const db = connectDatabase();
    const id = "acceptance-" + randomUUID().slice(0, 8);
    const module = defineModule({
      id,
      name: "Acceptance ledger",
      version: "1.0.0",
      description: "Distribution acceptance",
      host: "^1.0.0",
      backend: "^1.0.0",
      publisher: "suite",
      dependencies: {},
      permissions: [`${id}.entries.read`, `${id}.entries.write`],
      configuration: Type.Object({}, { additionalProperties: false }),
      operations: {},
      navigation: { path: `/${id}`, permission: `${id}.entries.read` },
      resources: {
        entries: resource(
          { name: field.text({ minLength: 1 }) },
          { title: "Entries" },
        ),
      },
    });
    const keyDirectory =
      process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const pkg = signPackage(
      module,
      await readFile(`${keyDirectory}/private.pem`, "utf8"),
    );
    // An ordinary API connection must not bypass release publication controls.
    await expect(
      db.insertInto("suite.module_releases").values(pkg).execute(),
    ).rejects.toMatchObject({ code: "42501" });
    if (!process.env.MIGRATION_DATABASE_URL)
      throw Error(
        "The test requires an explicit fixture publisher connection.",
      );
    const publisher = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    try {
      const publicKey = await readFile(`${keyDirectory}/public.pem`, "utf8");
      const submission = await submitRelease(publisher, pkg, null, publicKey);
      await reviewRelease(
        publisher,
        submission,
        "approved",
        "Reviewed test fixture",
        publicKey,
      );
      await publishRelease(publisher, submission, publicKey);
    } finally {
      await publisher.end();
    }
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
        name: "Publisher acceptance",
        email: `${randomUUID()}@test.local`,
        emailVerified: true,
      });
      const workspace = randomUUID();
      await inWorkspace(db, workspace, (tx) =>
        provisionWorkspace(tx, {
          id: workspace,
          userId: user.id,
          name: "Distribution",
          modules: [id],
          kind: "company",
        }),
      );
      const session = await server.auth.issue(user.id, true),
        headers = {
          cookie: `suite_session=${session.token}`,
          origin: "http://localhost:4300",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": randomUUID(),
        };
      const artifact = await server.app.inject({
        method: "GET",
        url: `/api/v1/module/${id}/workspaces/${workspace}/artifact`,
        headers,
      });
      expect(artifact.statusCode).toBe(200);
      expect(artifact.json().digest).toBe(pkg.digest);
      const deviceId = randomUUID();
      const install = await server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace}/platform`,
        headers,
        payload: {
          action: "install",
          value: {
            moduleId: id,
            deviceId,
            releases: [
              { moduleId: id, version: pkg.version, digest: pkg.digest },
            ],
          },
        },
      });
      expect(install.statusCode).toBe(200);
      const record = await server.app.inject({
        method: "POST",
        url: `/api/v1/module/${id}/workspaces/${workspace}/records`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {
          action: "create",
          resource: "entries",
          input: {
            id: randomUUID(),
            data: { name: "Independently installed" },
          },
        },
      });
      expect(record.statusCode).toBe(200);
      expect(record.json().data.name).toBe("Independently installed");
      const uninstall = await server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace}/platform`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: { action: "uninstall", value: { moduleId: id, deviceId } },
      });
      expect(uninstall.statusCode).toBe(200);
      const retained = await inWorkspace(db, workspace, (tx) =>
        tx
          .selectFrom("suite.module_records")
          .select(["data", "archived"])
          .where("workspace_id", "=", workspace)
          .where("module_id", "=", id)
          .where("id", "=", record.json().id)
          .executeTakeFirstOrThrow(),
      );
      expect(retained.data.name).toBe("Independently installed");
      expect(retained.archived).toBe(false);
    } finally {
      await server.app.close();
      await db.destroy();
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
    }
  });
});
