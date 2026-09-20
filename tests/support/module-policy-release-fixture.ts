import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { defineModule, Type } from "@suite/module-sdk";
import { signPackage } from "@suite/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";

export async function modulePolicyReleaseFixture(
  name = "Release policy checks",
) {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw Error("Explicit local fixture database is required.");
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  const id = `policy-release-${randomUUID().slice(0, 8)}`;
  const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
    publicKey = await readFile(`${keys}/public.pem`, "utf8");
  return {
    id,
    name,
    async publish(
      version: string,
      dependencies: Record<string, string>,
      permissions: string[] = [],
    ) {
      const pkg = signPackage(
        defineModule({
          id,
          name,
          version,
          description: "Policy dependency acceptance",
          publisher: "suite",
          host: "^1.0.0",
          backend: "^1.0.0",
          dependencies,
          permissions,
          configuration: Type.Object({}),
          operations: {},
          resources: {},
        }),
        privateKey,
      );
      const submitted = await submitRelease(registry, pkg, null, publicKey);
      await reviewRelease(
        registry,
        submitted,
        "approved",
        "Reviewed fixture dependency contract",
        publicKey,
      );
      await publishRelease(registry, submitted, publicKey);
    },
    async withdraw(version: string) {
      await admin.query(
        "delete from suite.module_releases where module_id=$1 and version=$2",
        [id, version],
      );
    },
    async entitle(workspaceId: string) {
      await admin.query(
        "insert into suite.entitlements(workspace_id,module_id) values($1,$2)",
        [workspaceId, id],
      );
    },
    async close() {
      await registry.end();
      await admin.end();
    },
  };
}
export type PolicyReleaseFixture = Awaited<
  ReturnType<typeof modulePolicyReleaseFixture>
>;
