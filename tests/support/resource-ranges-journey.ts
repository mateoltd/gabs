import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";
export const rangeId = "resource-ranges";
export const publishRangeFixture = () =>
  publishExecutableFixture({
    id: rangeId,
    sourceDirectory: "tests/fixtures/resource-ranges",
  });
export async function assignRangeFixture(pool: Pool, workspaceId: string) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspaceId, rangeId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspaceId, rangeId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
    [workspaceId, rangeId],
  );
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [workspaceId, [`${rangeId}.records.read`, `${rangeId}.records.write`]],
  );
}

export const rangeData = Array.from({ length: 24 }, (_, i) => ({
  id: randomUUID(),
  data: {
    name: `Record ${String(i + 1).padStart(2, "0")}`,
    ...(i === 0 ? {} : { amount: i === 1 ? null : (i - 2) / 2 }),
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    approved: i % 2 === 0,
  },
}));
export async function setRange(
  page: Page,
  field: string,
  lower: string,
  upper?: string,
) {
  await page.getByRole("button", { name: /^Ranges/ }).click();
  await selectValue(page, "Range field", field);
  await selectValue(
    page,
    "Comparison",
    upper === undefined ? "gte" : "between",
  );
  const form = page.getByRole("form", { name: "Filter ranges" });
  await form
    .getByLabel(upper === undefined ? "Bound" : "Lower bound", { exact: true })
    .fill(lower);
  if (upper !== undefined)
    await form.getByLabel("Upper bound", { exact: true }).fill(upper);
  await form.getByRole("button", { name: "Apply range", exact: true }).click();
}
export async function exerciseRanges(page: Page) {
  const records = page.getByRole("region", {
    name: "Records records",
    exact: true,
  });
  const status = page.locator('.resource-pagination [role="status"]');
  await expect(records.getByRole("row")).toHaveCount(25);
  await selectValue(page, "Records per page", "10");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 2. 10 records.");
  await setRange(page, "amount", "0", "1");
  await expect(status).toHaveText("Page 1. 3 records.");
  await expect(records).toContainText("Record 03");
  await expect(records).not.toContainText("Record 02");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await selectValue(page, "Filter by", "approved");
  await page.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(status).toHaveText("Page 1. 1 record.");
  await expect(records).toContainText("Record 04");
  await page
    .getByRole("button", { name: "Remove Approved filter", exact: true })
    .click();
  await setRange(page, "date", "2026-09-04", "2026-09-10");
  await expect(status).toHaveText("Page 1. 2 records.");
  await expect(records).toContainText("Record 04");
  await expect(records).toContainText("Record 05");
  // Contradictory bounds remain visible for correction; they must not replace the active query.
  await setRange(page, "amount", "3", "1");
  await expect(
    page.getByRole("form", { name: "Filter ranges" }).getByRole("alert"),
  ).toContainText("range must include at least one value");
  await expect(status).toHaveText("Page 1. 2 records.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  return { records, status };
}
