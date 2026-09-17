import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "./e2e/controls.helpers";
export const resourceListId = "resource-lists";
export async function publishResourceListFixture() {
  return publishExecutableFixture({
    id: resourceListId,
    sourceDirectory: "tests/fixtures/schema-editor",
    transform: (file, source) =>
      file === "module.ts"
        ? source
            .replaceAll("schema-editor", resourceListId)
            .replace('name: "Supplier intake"', 'name: "Resource lists"')
            .replace(
              'columns: ["candidate", "approved", "lines"]',
              'columns: ["candidate", "approved", "credit", "choice", "lines"]',
            )
            .replace(
              /  views:[\s\S]+$/,
              `  navigation: {path: "/${resourceListId}", permission: "${resourceListId}.records.read"},\n});\n`,
            )
        : source,
  });
}
export async function assignResourceListFixture(
  pool: Pool,
  workspaceId: string,
) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspaceId, resourceListId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspaceId, resourceListId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
    [workspaceId, resourceListId],
  );
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspaceId,
      [`${resourceListId}.records.read`, `${resourceListId}.records.write`],
    ],
  );
}
export const resourceListData = Array.from({ length: 24 }, (_, i) => ({
  id: randomUUID(),
  data: {
    candidate: `Office ${String(i + 1).padStart(2, "0")}`,
    approved: i % 2 === 0,
    ...(i % 4 === 0 ? { credit: null } : i % 4 === 1 ? { credit: 0 } : {}),
    choice: i % 3 === 0 ? 0 : i % 3 === 1 ? false : "",
    lines: [{ label: "Paper", quantity: 3, tags: ["standard"] }],
    delivery: { method: "pickup", desk: "Reception" },
    metrics: { boxes: 1 },
  },
}));
export async function exerciseResourceList(page: Page) {
  const content = page.getByRole("tabpanel", { name: "Intake", exact: true });
  const records = content.getByRole("region", { name: "Intake records" });
  const status = content.locator('.resource-pagination [role="status"]');
  await expect(records.getByRole("row")).toHaveCount(25);
  await selectValue(page, "Records per page", "10");
  await expect(status).toHaveText("Page 1. 10 records.");
  const first = await records.getByRole("cell").allTextContents();
  await content.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 2. 10 records.");
  await content.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 3. 4 records.");
  await expect(
    content.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  await content
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(status).toHaveText("Page 2. 10 records.");
  await content
    .getByRole("button", { name: "First page", exact: true })
    .click();
  await expect(status).toHaveText("Page 1. 10 records.");
  expect(await records.getByRole("cell").allTextContents()).toEqual(first);
  const startFilter = async (field: string) => {
    await content.getByRole("button", { name: /^Filters/ }).click();
    await selectValue(page, "Filter by", field);
  };
  await startFilter("approved");
  await expect(
    content.getByRole("checkbox", { name: "Approved", exact: true }),
  ).not.toBeChecked();
  await content.getByRole("button", { name: "Apply filter" }).click();
  await expect(records.getByRole("row")).toHaveCount(11);
  await content.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(status).toHaveText("Page 2. 2 records.");
  await startFilter("choice");
  await selectValue(page, "Choice", "choice:1");
  await content.getByRole("button", { name: "Apply filter" }).click();
  await expect(status).toHaveText("Page 1. 4 records.");
  await expect(
    content.getByRole("button", { name: "Previous page", exact: true }),
  ).toBeDisabled();
  await content.getByRole("button", { name: "Clear filters" }).click();
  await expect(status).toHaveText("Page 1. 10 records.");
  await startFilter("credit");
  await content
    .getByRole("checkbox", { name: "No value for credit limit", exact: true })
    .check();
  await content.getByRole("button", { name: "Apply filter" }).click();
  await expect(status).toHaveText("Page 1. 6 records.");
  await content
    .getByRole("button", { name: "Remove Credit limit filter" })
    .click();
  await expect(status).toHaveText("Page 1. 10 records.");
  await startFilter("credit");
  await content
    .getByRole("spinbutton", { name: "Credit limit", exact: true })
    .fill("0");
  await content.getByRole("button", { name: "Apply filter" }).click();
  await expect(status).toHaveText("Page 1. 6 records.");
  await expect(
    records.getByRole("cell", { name: "Office 02", exact: true }),
  ).toBeVisible();
  await expect(
    records.getByRole("cell", { name: "Office 01", exact: true }),
  ).toHaveCount(0);
  await content
    .getByRole("button", { name: "Remove Credit limit filter" })
    .click();
  await content
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Office 01");
  await expect(status).toHaveText("Page 1. 1 record.");
  const summary = records.locator("summary").first();
  await summary.focus();
  await page.keyboard.press("Enter");
  const itemSummary = records
    .locator("details[open] details > summary")
    .first();
  await itemSummary.focus();
  await page.keyboard.press("Enter");
  await expect(records.getByText("Paper", { exact: true })).toBeVisible();
  await expect(records).not.toContainText("[object Object]");
  return { content, records, status };
}
