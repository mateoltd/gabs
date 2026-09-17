import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
import { setRange } from "./resource-ranges-journey";
import { selectValue } from "./e2e/controls.helpers";
export const queryId = `resource-query-${crypto.randomUUID().slice(0, 8)}`;
export const queryName = `Resource explorer ${queryId.slice(-8)}`;
export const queryData = Array.from({ length: 7 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  data: {
    name: `Record ${String(index + 1).padStart(2, "0")}`,
    amount: index,
    approved: index % 2 === 0,
  },
}));
export const publishQueryFixture = () =>
  publishExecutableFixture({
    id: queryId,
    sourceDirectory: "tests/fixtures/resource-query",
    transform: (_file, source) =>
      source
        .replaceAll("query-proof", queryId)
        .replaceAll("Resource explorer", queryName),
  });
export async function assignQueryFixture(pool: Pool, workspace: string) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspace, queryId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspace, queryId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspace, queryId],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspace,
      [
        `${queryId}.view`,
        ...["records", "other"].flatMap((resource) =>
          ["read", "write"].map((action) => `${queryId}.${resource}.${action}`),
        ),
      ],
    ],
  );
}
export async function exerciseQuery(page: Page) {
  const state = page.getByTestId("query-state");
  const table = page.getByRole("region", {
    name: "Query records",
    exact: true,
  });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(state).toHaveText("Page 1. 2 records.");
  await expect(table).toContainText("Record 01");
  await button("Next records").click();
  await expect(state).toHaveText("Page 2. 2 records.");
  await expect(table).toContainText("Record 03");
  await button("Previous records").click();
  await expect(state).toHaveText("Page 1. 2 records.");
  await button("Sort").click();
  await selectValue(page, "Sort field 1", "amount");
  await selectValue(page, "Direction 1", "desc");
  await button("Apply sort").focus();
  await page.keyboard.press("Enter");
  await expect(table).toContainText("Record 07");
  await button("Next records").click();
  await expect(table).toContainText("Record 05");
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("Record 03");
  await expect(state).toHaveText("Page 1. 1 records.");
  await expect(table).toContainText("Record 03");
  await expect(button("Next records")).toBeDisabled();
  await button("Pause reading").click();
  await expect(state).toHaveText("Reading paused.");
  await expect(table).toHaveCount(0);
  await button("Resume reading").click();
  await expect(table).toContainText("Record 03");
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("");
  await selectValue(page, "Source", "other");
  await expect(state).toHaveText("Page 1. 1 records.");
  await expect(table).toContainText("Other record");
  await expect(table).not.toContainText("Record 07");
  await selectValue(page, "Source", "records");
  await expect(table).toContainText("Record 07");
  await setRange(page, "amount", "6");
  await expect(state).toHaveText("Page 1. 1 records.");
  await expect(table).toContainText("Record 07");
  await button("Remove Amount range").click();
  await expect(state).toHaveText("Page 1. 2 records.");
  return { state, table, button };
}
