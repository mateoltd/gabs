import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { selectValue } from "./controls.helpers";
import {
  publishClientReferenceFixture,
  assignClientReferenceFixture,
  clientReferenceId,
  clientReferenceName,
  clientReferenceRows,
  exerciseClientReference,
} from "../reference-client-journey";
test("independent view uses typed lookup, server query and standalone reference choices", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  await publishClientReferenceFixture();
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = me.workspaces.find(
      (workspace: { kind: string }) => workspace.kind === "personal",
    ).id;
    await assignClientReferenceFixture(pool, workspace);
    for (const input of clientReferenceRows) {
      const response = await page.request.post(
        `/api/v1/module/${clientReferenceId}/workspaces/${workspace}/records`,
        {
          headers: {
            origin: new URL(page.url()).origin,
            "x-csrf-token": me.csrfToken,
            "idempotency-key": crypto.randomUUID(),
          },
          data: { resource: "targets", action: "create", input },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
    }
    await page.reload();
    const picker = await exerciseClientReference(page);
    expect(
      (
        await pool.query(
          "select data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='notes'",
          [workspace, clientReferenceId],
        )
      ).rows.map((row) => row.data),
    ).toEqual([
      { name: "Public client note", link: clientReferenceRows[104].id },
    ]);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await mkdir("docs/verification/reference-client", { recursive: true });
    await page.screenshot({
      path: "docs/verification/reference-client/web.png",
    });
    await context.route(
      `**/module/${clientReferenceId}/workspaces/${workspace}/references/notes?**`,
      (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            code: "GRANT_REQUIRED",
            message: "Reference lookup denied for this session.",
          }),
        }),
    );
    await picker.getByRole("textbox").fill("Denied");
    await expect(picker.getByRole("alert")).toContainText(
      "Reference lookup denied",
    );
    await context.unroute(
      `**/module/${clientReferenceId}/workspaces/${workspace}/references/notes?**`,
    );
    await picker
      .getByRole("button", { name: "Retry choices", exact: true })
      .click();
    await expect(picker.getByRole("alert")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Reference profile");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage local modules", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Browse personal modules", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Install ${clientReferenceName}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Save local installation", exact: true })
      .click();
    await expect(
      page.getByText(`${clientReferenceName} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await selectValue(
      page,
      "Module and resource",
      `${clientReferenceId}/targets`,
    );
    await context.setOffline(true);
    await page.getByRole("button", { name: "New record", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Local target");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await selectValue(
      page,
      "Module and resource",
      `${clientReferenceId}/notes`,
    );
    await page.getByRole("button", { name: "New record", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Standalone linked note");
    await dialog.getByRole("combobox", { name: "Target", exact: true }).click();
    await page
      .getByRole("option", { name: "Local target", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/verification/reference-client/local-narrow.png",
    });
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Standalone linked note", exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2 and resource='notes'",
          [workspace, clientReferenceId],
        )
      ).rows[0].count,
    ).toBe("1");
  } finally {
    await pool.end();
  }
});
