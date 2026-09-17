import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "./e2e/controls.helpers";
export const sortId = "resource-sort";
export const publishSortFixture = () =>
  publishExecutableFixture({
    id: sortId,
    sourceDirectory: "tests/fixtures/resource-sort",
  });
export async function assignSortFixture(pool: Pool, workspaceId: string) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspaceId, sortId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspaceId, sortId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
    [workspaceId, sortId],
  );
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [workspaceId, [`${sortId}.records.read`, `${sortId}.records.write`]],
  );
}

export const sortData = Array.from({ length: 24 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  data: {
    name: `Record ${String(i + 1).padStart(2, "0")}`,
    ...(i === 0 ? {} : { amount: i === 1 ? null : Math.floor((i - 2) / 3) }),
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    approved: i % 2 === 0,
  },
}));
export async function setSort(
  page: Page,
  fields: { field: string; direction: "asc" | "desc" }[],
) {
  await page.getByRole("button", { name: /^Sort(?: \(\d+\))?$/ }).click();
  const form = page.getByRole("form", { name: "Sort records" });
  for (let i = 0; i < fields.length; i++) {
    if (
      i > 0 &&
      (await form
        .getByRole("combobox", { name: `Sort field ${i + 1}`, exact: true })
        .count()) === 0
    )
      await form
        .getByRole("button", { name: "Add sort field", exact: true })
        .click();
    await selectValue(page, `Sort field ${i + 1}`, fields[i].field);
    await selectValue(page, `Direction ${i + 1}`, fields[i].direction);
  }
  await form.getByRole("button", { name: "Apply sort", exact: true }).focus();
  await page.keyboard.press("Enter");
}
export async function exerciseSort(page: Page) {
  const content = page.getByRole("tabpanel", { name: "Records", exact: true });
  const records = content.getByRole("region", {
    name: "Records records",
    exact: true,
  });
  const status = content.locator('.resource-pagination [role="status"]');
  const names = () => records.getByRole("row").allTextContents();
  await expect(records.getByRole("row")).toHaveCount(25);
  await selectValue(page, "Records per page", "10");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await setSort(page, [{ field: "amount", direction: "desc" }]);
  await expect(status).toHaveText("Page 1. 10 records.");
  await expect(records.getByRole("row").nth(1)).toContainText("Record 24");
  const first = await names();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 2. 10 records.");
  const second = await names();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 3. 4 records.");
  await expect(records.getByRole("row").nth(3)).toContainText("Record 01");
  await expect(records.getByRole("row").nth(4)).toContainText("Record 02");
  await page.getByRole("button", { name: "First page", exact: true }).click();
  await expect(status).toHaveText("Page 1. 10 records.");
  expect(await names()).toEqual(first);
  // Multi-field priority can be changed with keyboard-operable controls.
  await page.getByRole("button", { name: /^Sort \(1\)$/ }).click();
  const form = page.getByRole("form", { name: "Sort records" });
  await form.getByRole("button", { name: "Add sort field" }).click();
  await selectValue(page, "Sort field 2", "approved");
  await form.getByRole("button", { name: "Move sort 2 earlier" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    form.getByRole("combobox", { name: "Sort field 1", exact: true }),
  ).toContainText("Approved");
  await form.getByRole("button", { name: "Apply sort", exact: true }).click();
  await expect(records.getByRole("row").nth(1)).toContainText("Record 24");
  await expect(records.getByRole("row").nth(2)).toContainText("Record 22");
  await page.getByRole("button", { name: "Reset sort", exact: true }).click();
  await expect(records.getByRole("row").nth(1)).toContainText("Record 01");
  await setSort(page, [{ field: "amount", direction: "desc" }]);
  await expect(records.getByRole("row").nth(1)).toContainText("Record 24");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 2. 10 records.");
  expect(await names()).toEqual(second);
  await page.getByRole("button", { name: "First page", exact: true }).click();
  await expect(records.getByRole("row").nth(1)).toContainText("Record 24");
  return { content, records, status, first, second };
}
