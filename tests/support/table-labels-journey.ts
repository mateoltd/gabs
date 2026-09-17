import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
export const tableLabelsId = `table-labels-${crypto.randomUUID().slice(0, 8)}`;
export const tableLabelsName = `Reference tables ${tableLabelsId.slice(-8)}`;
export const tableTargets = Array.from({ length: 105 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`,
  data: { name: `Target ${String(i + 1).padStart(3, "0")}` },
}));
export const tableData = {
  name: "Nested record",
  pair: [tableTargets[104].id, 0],
  links: { "a/b~c": tableTargets[104].id },
  extras: { fixed: "kept", supplier: tableTargets[103].id },
};
export const publishTableLabels = () =>
  publishExecutableFixture({
    id: tableLabelsId,
    sourceDirectory: "tests/fixtures/table-labels",
    transform: (_file, source) =>
      source
        .replaceAll("table-labels", tableLabelsId)
        .replaceAll("Reference tables", tableLabelsName),
  });
export async function assignTableLabels(pool: Pool, workspace: string) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspace, tableLabelsId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspace, tableLabelsId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspace, tableLabelsId],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspace,
      ["records", "targets"].flatMap((resource) =>
        ["read", "write"].map(
          (action) => `${tableLabelsId}.${resource}.${action}`,
        ),
      ),
    ],
  );
}
export async function inspectTableLabels(page: Page) {
  const table = page.getByRole("region", {
    name: "Reference table",
    exact: true,
  });
  const row = table.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Nested record", exact: true }),
  });
  await expect(row).toBeVisible();
  for (const details of await row.locator("details").all())
    await details.locator(":scope > summary").click();
  await expect(row.getByText("Target 105", { exact: true })).toHaveCount(2);
  await expect(row.getByText("Target 104", { exact: true })).toBeVisible();
  await expect(row).not.toContainText("[object Object]");
  await expect(row).not.toContainText(tableTargets[104].id);
  await expect(row.getByText("0", { exact: true })).toBeVisible();
  return { table, row };
}
