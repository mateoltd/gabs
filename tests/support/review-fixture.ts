import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import { signPackage } from "../../packages/sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";

/** Local acceptance release: ordinary generated records with online-only writes. */
export async function publishOnlineReviewFixture(
  admin: Pool,
  workspace: string,
  id: string,
) {
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  try {
    const directory =
      process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const privateKey = await readFile(`${directory}/private.pem`, "utf8"),
      publicKey = await readFile(`${directory}/public.pem`, "utf8");
    const module = defineModule({
      id,
      name: "Online review records",
      version: "1.0.0",
      description: "Online-only review acceptance",
      host: "^1.0.0",
      backend: "^1.0.0",
      publisher: "suite",
      dependencies: {},
      configuration: Type.Object({}),
      permissions: [`${id}.records.read`, `${id}.records.write`],
      operations: {},
      navigation: { path: `/${id}`, permission: `${id}.records.read` },
      resources: {
        records: resource(
          {
            name: field.text({ minLength: 1 }),
            note: field.optional(field.text()),
          },
          { title: "Records", columns: ["name", "note"], policy: "online" },
        ),
      },
    });
    const submission = await submitRelease(
      registry,
      signPackage(module, privateKey),
      null,
      publicKey,
    );
    await reviewRelease(
      registry,
      submission,
      "approved",
      "Reviewed local online-policy acceptance fixture",
      publicKey,
    );
    await publishRelease(registry, submission, publicKey);
    await admin.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspace, id],
    );
    await admin.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspace, id],
    );
    await admin.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
      [workspace, id],
    );
    await admin.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and name='Owner'",
      [workspace, module.permissions],
    );
  } finally {
    await registry.end();
  }
}
