import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
import module from "./fixtures/host-capabilities/module";
export const publishHostFixture = (id: string) =>
  publishExecutableFixture({
    id,
    name: "Capability notes",
    sourceDirectory: "tests/fixtures/host-capabilities",
  });
export async function assignHostFixture(
  pool: Pool,
  workspace: string,
  id: string,
) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspace, id],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspace, id],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspace, id],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspace,
      module.permissions.map((p) => p.replaceAll("custom-notes", id)),
    ],
  );
}
export async function exportPermission(
  pool: Pool,
  workspace: string,
  id: string,
  enabled: boolean,
) {
  await pool.query(
    enabled
      ? "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text)) where workspace_id=$1 and protected"
      : "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
    [workspace, `${id}.export`],
  );
}
