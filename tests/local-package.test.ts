import "dotenv/config";
import { it, expect } from "vitest";
import { Pool } from "pg";
import { createApp } from "../apps/api/src/app";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../packages/server-core/src";
import { mkdtemp, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  hydrateModule,
  Type,
  defineModule,
  operation,
} from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import {
  validateLocalArtifact,
  requiresServer,
} from "@suite/module-sdk/local-artifact";
import { verifyArtifact } from "@suite/module-sdk/verification";
import { executeLocalCall, type LocalModule } from "@suite/module-sdk/local";
import { publishLocalPackage } from "./local-package-fixture";
import { buildLocalBundle } from "../packages/module-sdk/node/build-local";
import {
  signPackage,
  verifyPackage,
} from "../packages/module-sdk/node/signing";
it("builds, reviews and publishes an independent local-only package without a server component", async () => {
  const { pkg, publicKey, submission, path } = await publishLocalPackage();
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    expect(
      (
        await pool.query(
          "select backend_kind,state from suite.module_submissions where id=$1",
          [submission],
        )
      ).rows[0],
    ).toMatchObject({ backend_kind: "none", state: "published" });
    expect(
      (
        await pool.query(
          "select digest from suite.module_releases where module_id=$1",
          [pkg.module_id],
        )
      ).rows[0].digest,
    ).toBe(pkg.digest);
    await expect(
      readFile(path.replace(".json", ".server.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    for (const mode of ["missing-local", "corporate"] as const) {
      const invalid = structuredClone(pkg);
      if (mode === "missing-local") delete invalid.artifact.local;
      else
        (
          invalid.artifact.operations as Record<string, { policy: string }>
        ).capture.policy = "online";
      await expect(
        pool.query(
          "insert into suite.module_submissions(id,module_id,version,publisher_id,client_package,backend_kind) values($1,$2,$3,'suite',$4,'none')",
          [crypto.randomUUID(), pkg.module_id, pkg.version, invalid],
        ),
      ).rejects.toThrow(
        mode === "missing-local"
          ? /Local operations require/
          : /require a staged server/,
      );
    }
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
        subject: crypto.randomUUID(),
        name: "Local installer",
        email: `${crypto.randomUUID()}@test.local`,
        emailVerified: true,
      });
      const workspaceId = crypto.randomUUID();
      await inWorkspace(db, workspaceId, (tx) =>
        provisionWorkspace(tx, {
          id: workspaceId,
          userId: user.id,
          name: "Local-only distribution",
          modules: [pkg.module_id],
          kind: "company",
        }),
      );
      const session = await server.auth.issue(user.id, true);
      const response = await server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspaceId}/platform`,
        headers: {
          cookie: `suite_session=${session.token}`,
          origin: "http://localhost:4300",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        payload: {
          action: "install",
          value: {
            moduleId: pkg.module_id,
            deviceId: crypto.randomUUID(),
            releases: [
              {
                moduleId: pkg.module_id,
                version: pkg.version,
                digest: pkg.digest,
              },
            ],
          },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().installation).toMatchObject({ action: "install" });
    } finally {
      await server.app.close();
      await db.destroy();
    }
    await verifyArtifact(pkg, publicKey);
    verifyPackage(pkg, publicKey);
    const module = hydrateModule(moduleContract(pkg.artifact));
    expect(requiresServer(module)).toBe(false);
    expect(module).not.toHaveProperty("local");
    const bundle = validateLocalArtifact(pkg.artifact)!;
    const implementation = (
      await import(
        `data:text/javascript;base64,${Buffer.from(bundle.javascript).toString("base64")}`
      )
    ).default as LocalModule;
    const value = await executeLocalCall(
      module,
      {
        profileId: "independent-profile",
        configuration: {},
        call: {
          moduleId: module.id,
          moduleVersion: module.version,
          action: "operation",
          operation: "capture",
          input: { text: "Independent local data" },
          key: crypto.randomUUID(),
        },
        snapshot: { records: {}, receipts: {} },
      },
      implementation,
    );
    expect(value.snapshot.records.items[0]).toMatchObject({
      id: value.result,
      data: { text: "Independent local data" },
    });
    const corrupt = structuredClone(pkg);
    corrupt.artifact.local = {
      ...bundle,
      javascript: bundle.javascript + "\n// corrupt",
    };
    expect(() => verifyPackage(corrupt, publicKey)).toThrow(
      /signature|checksum/,
    );
    await expect(verifyArtifact(corrupt, publicKey)).rejects.toThrow(
      /checksum/,
    );
    const stranger = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    await expect(verifyArtifact(pkg, stranger)).rejects.toThrow(/Untrusted/);
  } finally {
    await pool.end();
  }
});
it("requires local bytes at signing and rejects privileged imports and escaping source", async () => {
  const module = defineModule({
    id: "build-local-proof",
    name: "Build proof",
    version: "1.0.0",
    description: "Local build boundaries",
    host: "^1.0.0",
    backend: "^1.0.0",
    publisher: "suite",
    dependencies: {},
    permissions: ["build-local-proof.run"],
    resources: {},
    configuration: Type.Object({}),
    operations: {
      run: operation({
        title: "Run",
        permission: "build-local-proof.run",
        policy: "local",
        input: Type.Object({}),
        output: Type.Null(),
      }),
    },
  });
  const privateKey = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  expect(() => signPackage(module, privateKey)).toThrow(
    /Local operations require/,
  );
  const directory = await mkdtemp(resolve(".local/local-build-"));
  try {
    await expect(buildLocalBundle(module, directory)).rejects.toThrow(
      /module-local.ts/,
    );
    await writeFile(
      resolve(directory, "module-local.ts"),
      'import fs from "node:fs";export default fs;',
    );
    await expect(buildLocalBundle(module, directory)).rejects.toThrow(
      /Unsupported local import/,
    );
    await writeFile(
      resolve(directory, "module-local.ts"),
      'export {default} from "../../modules/contacts/module";',
    );
    await expect(buildLocalBundle(module, directory)).rejects.toThrow(
      /stay inside/,
    );
    await rm(resolve(directory, "module-local.ts"));
    await symlink(
      resolve("modules/contacts/module.ts"),
      resolve(directory, "module-local.ts"),
    );
    await expect(buildLocalBundle(module, directory)).rejects.toThrow(
      /stay inside/,
    );
    expect(
      requiresServer({
        ...module,
        operations: {
          ...module.operations,
          online: { ...module.operations.run, policy: "online" },
        },
      }),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
