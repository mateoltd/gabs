import "dotenv/config";
import { it, expect } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  defineModule,
  capability,
  resource,
  field,
  Type,
} from "@suite/module-sdk";
import { verifyCapabilityLease } from "@suite/module-sdk/capability-leases";
import { signPackage } from "@suite/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import { createApp } from "../../apps/api/src/app";

it("issues audited exact-release leases and rechecks revoked authority before idempotent replay", async () => {
  const previous = process.env.CAPABILITY_LEASE_PRIVATE_KEY;
  process.env.CAPABILITY_LEASE_PRIVATE_KEY = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const db = connectDatabase(),
    pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  const id = `lease-${randomUUID().slice(0, 8)}`,
    workspace = randomUUID();
  const module = defineModule({
    id,
    name: "Offline lease test",
    version: "1.0.0",
    publisher: "suite",
    description: "Server authority acceptance",
    host: "^1.0.0",
    backend: "^1.0.0",
    dependencies: {},
    configuration: Type.Object({}),
    permissions: [
      `${id}.entries.read`,
      `${id}.entries.write`,
      `${id}.export`,
      `${id}.notify`,
    ],
    operations: {},
    resources: {
      entries: resource({ name: field.text() }, { title: "Entries" }),
    },
    capabilities: {
      export: capability({
        kind: "files.export",
        permission: `${id}.export`,
        offline: "lease",
      }),
      notify: capability({
        kind: "notifications.show",
        permission: `${id}.notify`,
      }),
    },
  });
  try {
    const directory =
      process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const publicKey = await readFile(`${directory}/public.pem`, "utf8");
    const pkg = signPackage(
      module,
      await readFile(`${directory}/private.pem`, "utf8"),
    );
    const submission = await submitRelease(pool, pkg, null, publicKey);
    await reviewRelease(
      pool,
      submission,
      "approved",
      "Lease acceptance fixture",
      publicKey,
    );
    await publishRelease(pool, submission, publicKey);
    server = await createApp({
      db,
      auth: {
        mode: "development",
        origin: "http://localhost:4300",
        apiOrigin: "http://localhost:4310",
        mfaClaim: "mfa",
      },
    });
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Lease owner",
      emailVerified: true,
    });
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: user.id,
        name: "Lease workspace",
        kind: "company",
        modules: [id],
      }),
    );
    const session = await server.auth.issue(user.id, true);
    const headers = {
      cookie: `suite_session=${session.token}`,
      origin: "http://localhost:4300",
      "x-csrf-token": session.csrfToken,
      "x-module-version": module.version,
    };
    const acquire = (
      key = randomUUID(),
      capability = "export",
      version: string = module.version,
      workspaceId = workspace,
    ) =>
      server!.app.inject({
        method: "POST",
        url: `/api/v1/module/${id}/workspaces/${workspaceId}/capabilities/lease`,
        headers: {
          ...headers,
          "idempotency-key": key,
          "x-module-version": version,
        },
        payload: { capability },
      });
    const keyResponse = await server.app.inject({
      method: "GET",
      url: "/api/v1/capabilities/key",
      headers,
    });
    expect(keyResponse.statusCode).toBe(200);
    const key = randomUUID(),
      response = await acquire(key);
    expect(response.statusCode, response.body).toBe(200);
    const lease = response.json();
    expect(keyResponse.json()).toMatchObject({
      issuer: lease.payload.issuer,
      keyId: lease.keyId,
    });
    const repeat = await acquire(key);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toEqual(lease);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from suite.audit where workspace_id=$1 and action='module.capability.lease'",
          [workspace],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(lease.payload.expiresAt - lease.payload.issuedAt).toBe(24 * 3600000);
    const context = {
      issuer: "http://localhost:4310",
      userId: user.id,
      workspaceId: workspace,
      module,
      call: {
        moduleId: id,
        moduleVersion: module.version,
        capability: "export",
        input: { filename: "cached.txt", content: "Cached data" },
      },
      minimumPolicyRevision: lease.payload.policyRevision,
    };
    await expect(
      verifyCapabilityLease(lease, keyResponse.json().publicKey, context),
    ).resolves.toMatchObject({ membershipId: lease.payload.membershipId });
    expect((await acquire(randomUUID(), "notify")).statusCode).toBe(403);
    expect((await acquire(randomUUID(), "unknown")).statusCode).toBe(403);
    expect(
      (await acquire(randomUUID(), "export", "9.0.0")).statusCode,
    ).not.toBe(200);
    expect(
      (await acquire(randomUUID(), "export", module.version, randomUUID()))
        .statusCode,
    ).not.toBe(200);
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspace, `${id}.export`],
    );
    expect((await acquire(key)).statusCode).toBe(403);
    const revision = (
      await pool.query(
        "select revision from suite.workspace_policy where workspace_id=$1",
        [workspace],
      )
    ).rows[0].revision;
    await expect(
      verifyCapabilityLease(lease, keyResponse.json().publicKey, {
        ...context,
        minimumPolicyRevision: revision,
      }),
    ).rejects.toThrow(/policy changed/);
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and protected",
      [workspace, `${id}.export`],
    );
    await pool.query(
      "update suite.workspaces set offline_hours=0 where id=$1",
      [workspace],
    );
    expect((await acquire(key)).json().code).toBe("OFFLINE_DISABLED");
    await pool.query(
      "update suite.workspaces set offline_hours=2 where id=$1",
      [workspace],
    );
    expect((await acquire(key)).json().code).toBe(
      "CAPABILITY_LEASE_RENEWAL_REQUIRED",
    );
    const shortened = await acquire();
    expect(shortened.statusCode).toBe(200);
    expect(
      shortened.json().payload.expiresAt - shortened.json().payload.issuedAt,
    ).toBe(2 * 3600000);
    const rotationKey = randomUUID();
    expect((await acquire(rotationKey)).statusCode).toBe(200);
    process.env.CAPABILITY_LEASE_PRIVATE_KEY = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect((await acquire(rotationKey)).json().code).toBe(
      "CAPABILITY_LEASE_RENEWAL_REQUIRED",
    );
    expect((await acquire()).statusCode).toBe(200);
    delete process.env.CAPABILITY_LEASE_PRIVATE_KEY;
    expect((await acquire()).json().code).toBe("CAPABILITY_LEASE_UNAVAILABLE");
  } finally {
    await server?.app.close();
    await db.destroy();
    await pool.end();
    if (previous === undefined) delete process.env.CAPABILITY_LEASE_PRIVATE_KEY;
    else process.env.CAPABILITY_LEASE_PRIVATE_KEY = previous;
  }
});
