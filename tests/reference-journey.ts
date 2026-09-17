import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { publishExecutableFixture } from "./executable-fixture";
export const referenceModuleId = "reference-forms";
export async function publishReferenceFixture() {
  return publishExecutableFixture({
    id: referenceModuleId,
    sourceDirectory: "tests/fixtures/schema-editor",
    transform: (filename, source) =>
      filename === "module.ts"
        ? `
import { defineModule, field, resource, Type } from "@suite/module-sdk";
export default defineModule({
  id: "${referenceModuleId}", name: "Reference forms", version: "${source.match(/version: "([^"]+)"/)![1]}",
  description: "Reference acceptance", publisher: "suite", host: "^1.0.0", backend: "^1.0.0",
  dependencies: {}, configuration: Type.Object({}), operations: {},
  permissions: ["${referenceModuleId}.records.read", "${referenceModuleId}.records.write", "${referenceModuleId}.targets.read", "${referenceModuleId}.targets.write"],
  resources: {
    records: resource({
      name: field.text({ minLength: 1 }),
      links: Type.Array(Type.Object({ contactId: { ...field.reference("${referenceModuleId}", "targets"), title: "Contact" } }), { maxItems: 4 }),
      reviewer: field.optional(field.member({ title: "Reviewer" })),
    }, { title: "Records", columns: ["name", "links", "reviewer"] }),
    targets: resource({ name: field.text() }, { title: "Targets" }),
  },
  navigation: { path: "/${referenceModuleId}", permission: "${referenceModuleId}.records.read" },
});
`
        : source,
  });
}
export async function assignReferenceFixture(pool: Pool, workspaceId: string) {
  const id = referenceModuleId;
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspaceId, id],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspaceId, id],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
    [workspaceId, id],
  );
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspaceId,
      ["records", "targets"].flatMap((resource) =>
        ["read", "write"].map((action) => `${id}.${resource}.${action}`),
      ),
    ],
  );
}
export const referenceTargets = Array.from({ length: 105 }, () => randomUUID())
  .sort()
  .map((id, i) => ({
    id,
    data: { name: `Target ${String(i + 1).padStart(3, "0")}` },
  }));
export async function exerciseReferencePicker(page: Page) {
  await page
    .getByRole("link", { name: "Reference forms", exact: true })
    .click();
  await page.getByRole("button", { name: "New records", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Nested reference acceptance");
  await dialog.getByRole("button", { name: "Add links item" }).click();
  const picker = dialog.locator(".reference-picker").filter({
    has: page.getByRole("combobox", { name: "Contact", exact: true }),
  });
  const summary = picker.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("status")).toHaveText("25 choices on page 1.");
  await picker.getByRole("button", { name: "Next choices" }).click();
  await expect(picker.getByRole("status")).toHaveText("25 choices on page 2.");
  await picker.getByRole("combobox").click();
  await page.getByRole("option", { name: "Target 026", exact: true }).click();
  await picker.getByRole("textbox").fill("Target 105");
  await expect(picker.getByRole("status")).toHaveText("1 choice on page 1.");
  await expect(picker.getByRole("combobox")).toContainText("Target 026");
  await picker.getByRole("combobox").focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("option", { name: "Target 105", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Target 026", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Target 105", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("combobox")).toContainText("Target 105");
  await picker.getByRole("textbox").fill("");
  await expect(picker.getByRole("status")).toHaveText("25 choices on page 1.");
  await expect(picker.getByRole("combobox")).toContainText("Target 105");
  await dialog.getByRole("combobox", { name: "Reviewer", exact: true }).click();
  await page.getByRole("option", { name: "Alex Morgan", exact: true }).click();
  return { dialog, picker };
}
