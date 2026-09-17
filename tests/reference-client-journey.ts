import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
export const clientReferenceId = `reference-client-${randomUUID().slice(0, 8)}`;
export const clientReferenceName = `Reference client ${clientReferenceId.slice(-8)}`;
export const clientReferenceRows = Array.from({ length: 105 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
  data: { name: `Target ${String(index + 1).padStart(3, "0")}` },
}));
export const publishClientReferenceFixture = () =>
  publishExecutableFixture({
    id: clientReferenceId,
    sourceDirectory: "tests/fixtures/reference-client",
    transform: (_filename, source) =>
      source
        .replaceAll("reference-client", clientReferenceId)
        .replaceAll("Reference client", clientReferenceName),
  });
export async function assignClientReferenceFixture(
  pool: Pool,
  workspace: string,
) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspace, clientReferenceId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspace, clientReferenceId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspace, clientReferenceId],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspace,
      ["notes", "targets"].flatMap((resource) =>
        ["read", "write"].map(
          (action) => `${clientReferenceId}.${resource}.${action}`,
        ),
      ),
    ],
  );
}
export async function exerciseClientReference(page: Page) {
  await page
    .getByRole("link", { name: clientReferenceName, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Linked note", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Public client note");
  const picker = page.locator(".reference-picker");
  await picker.locator("summary").click();
  await expect(picker.getByRole("status")).toHaveText("25 choices on page 1.");
  await picker
    .getByRole("button", { name: "Next choices", exact: true })
    .click();
  await expect(picker.getByRole("status")).toHaveText("25 choices on page 2.");
  await picker.getByRole("textbox").fill("Target 105");
  await expect(picker.getByRole("status")).toHaveText("1 choice on page 1.");
  await picker.getByRole("combobox").click();
  await page.getByRole("option", { name: "Target 105", exact: true }).click();
  await picker.getByRole("textbox").fill("");
  await expect(picker.getByRole("combobox")).toContainText("Target 105");
  await page
    .getByRole("button", { name: "Check server lookup", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Server verified Target 105" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save linked note", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved Public client note" }),
  ).toBeVisible();
  return picker;
}
