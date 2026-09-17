import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { selectValue } from "./controls.helpers";
import { startModuleDev } from "../../tooling/module-dev/server";
import {
  assignMapTuple,
  publishMapTuple,
  mapTupleId,
  mapTupleName,
  mapTupleRows,
  mapTupleExpected,
  exerciseMapTuple,
} from "../map-tuple-journey";
test("development tuple and map editors preserve typed references, keys and unfinished JSON", async ({
  page,
}) => {
  test.setTimeout(120000);
  const server = await startModuleDev(resolve("tests/fixtures/map-tuple"), 0);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(server.origin);
    await exerciseMapTuple(page);
    const state = await (
      await page.request.get(server.origin + "/state")
    ).json();
    expect(state.records.records.map((r: { data: unknown }) => r.data)).toEqual(
      [mapTupleExpected()],
    );
  } finally {
    await server.close();
  }
});
test("installed SDK tuple and map forms save validated records and remain usable at narrow width", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  await publishMapTuple();
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
    await assignMapTuple(pool, workspace);
    for (const input of mapTupleRows) {
      const response = await page.request.post(
        `/api/v1/module/${mapTupleId}/workspaces/${workspace}/records`,
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
    await page.getByRole("link", { name: mapTupleName, exact: true }).click();
    const view = await exerciseMapTuple(page);
    expect(
      (
        await pool.query(
          "select data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='records'",
          [workspace, mapTupleId],
        )
      ).rows.map((r) => r.data),
    ).toEqual([mapTupleExpected()]);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Structured links"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/map-tuple", { recursive: true });
    await view
      .getByRole("heading", { name: "Structured links", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "docs/verification/map-tuple/wide.png" });
    await view
      .getByRole("group", { name: "Links", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "docs/verification/map-tuple/wide-map.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await view
      .getByRole("group", { name: "Links", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "docs/verification/map-tuple/narrow.png" });
    await view
      .getByRole("group", { name: "Pair", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/map-tuple/narrow-pair.png",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Local structured fields");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await button("Browse personal modules").click();
    await button(`Install ${mapTupleName}`).click();
    await button("Save local installation").click();
    await expect(
      page.getByText(`${mapTupleName} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await button("Close dialog").click();
    await selectValue(page, "Module and resource", `${mapTupleId}/targets`);
    await context.setOffline(true);
    await button("New record").click();
    await page
      .getByRole("dialog")
      .getByLabel("Name", { exact: true })
      .fill("Target 105");
    await button("Save locally").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await selectValue(page, "Module and resource", `${mapTupleId}/records`);
    await button("New record").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Fixed", { exact: true })).toHaveValue(
      "kept",
    );
    await dialog
      .getByLabel("Name", { exact: true })
      .fill("Local structured record");
    await dialog.getByRole("combobox", { name: "Pair 1", exact: true }).click();
    await page.getByRole("option", { name: "Target 105", exact: true }).click();
    await dialog.getByLabel("Quantity", { exact: true }).fill("1");
    await dialog
      .getByLabel("New key for links", { exact: true })
      .fill("primary");
    await dialog
      .getByLabel("New key for links", { exact: true })
      .press("Enter");
    await dialog
      .getByRole("combobox", { name: "Links: primary", exact: true })
      .click();
    await page.getByRole("option", { name: "Target 105", exact: true }).click();
    const pending = dialog.getByLabel("New key for extras", { exact: true });
    await pending.fill("unfinished");
    await button("Save locally").click();
    await expect(dialog).toBeVisible();
    expect(
      await pending.evaluate(
        (input: HTMLInputElement) => input.validity.customError,
      ),
    ).toBe(true);
    await pending.press("Escape");
    await expect(dialog).toBeVisible();
    const localKey = dialog.getByLabel("Links key 1", { exact: true });
    await localKey.fill("renaming");
    await localKey.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(localKey).toHaveValue("primary");
    await button("Save locally").click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "Local structured record", exact: true }),
    ).toBeVisible();
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2 and resource='records'",
          [workspace, mapTupleId],
        )
      ).rows[0].count,
    ).toBe("1");
    await page.screenshot({ path: "docs/verification/map-tuple/local.png" });
  } finally {
    await pool.end();
  }
});
