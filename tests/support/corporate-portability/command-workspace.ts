import { expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { publishExecutableFixture } from "../executable-fixture";
import module from "../../fixtures/queued-notes/module";

export async function commandWorkspace(api: APIRequestContext, pool: Pool) {
  const modules = ["parent", "child"].map((kind) => ({
    id: `import-${kind}-${randomUUID().slice(0, 8)}`,
    name: `Imported ${kind} commands`,
  }));
  for (const entry of modules)
    await publishExecutableFixture({
      ...entry,
      sourceDirectory: "tests/fixtures/queued-notes",
      transform: (file, source) =>
        file !== "view.tsx"
          ? source
          : source.replace(
              '<Field label="Note name">',
              '<Field label="Prerequisite identity"><Input value={parent ?? ""} onChange={(event) => setParent(event.target.value)} /></Field><Field label="Note name">',
            ),
    });
  const me = await (await api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const response = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: workspaceId,
      name: "Imported command dependencies",
      currency: "EUR",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  for (const { id } of modules) {
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspaceId, id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspaceId, id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
      [workspaceId, id],
    );
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [
        workspaceId,
        module.permissions.map((permission) =>
          permission.replaceAll(module.id, id),
        ),
      ],
    );
  }
  return { workspaceId, userId: me.user.id as string, headers, modules };
}
