import "dotenv/config";
import { test, expect } from "@playwright/test";
import { publishExecutableFixture } from "../support/executable-fixture";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { validateClientArtifacts } from "@suite/module-sdk/client-artifact";
import module from "../fixtures/custom-notes/module";
import { selectValue } from "./controls.helpers";

test("installs an independent signed TSX view, keeps styles local and persists real typed writes", async ({
  page,
}) => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    const pkg = await publishExecutableFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspaceId = randomUUID();
    const response = await page.request.post("/api/v1/workspaces", {
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
        "idempotency-key": randomUUID(),
      },
      data: {
        id: workspaceId,
        name: "Executable module acceptance",
        currency: "EUR",
      },
    });
    expect(response.ok()).toBeTruthy();
    // Provision only this fixture workspace. Purchase/assignment are separate lifecycle steps.
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true) on conflict(workspace_id,module_id) do update set active=true",
      [workspaceId, module.id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}') on conflict(workspace_id,module_id) do update set state='enabled'",
      [workspaceId, module.id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1 on conflict do nothing",
      [workspaceId, module.id],
    );
    await pool.query(
      "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [workspaceId, module.permissions],
    );
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await page.goto("/modules");
    await expect(
      page.getByRole("heading", { name: "Custom notes", exact: true }),
    ).toBeVisible();
    const before = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Custom notes", exact: true })
      .click();
    const region = page.getByRole("region", {
      name: "Custom notes workspace",
      exact: true,
    });
    await expect(
      region.getByRole("heading", { name: "Custom notes", exact: true }),
    ).toBeVisible();
    expect(await region.evaluate((el) => !!el.shadowRoot)).toBe(true);
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(before);
    await region
      .getByLabel("Note name", { exact: true })
      .fill("A record from an independent module");
    await region
      .getByRole("button", { name: "Save note", exact: true })
      .click();
    await expect(
      region.getByText("A record from an independent module", { exact: true }),
    ).toBeVisible();
    const read = page.waitForResponse(
      (response) => response.url().includes(`/queries/names`) && response.ok(),
    );
    await page.reload();
    await read;
    await expect(
      region.getByText("A record from an independent module", { exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/executable-modules", { recursive: true });
    await page.screenshot({
      path: "docs/verification/executable-modules/custom-view-wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/executable-modules/custom-view-narrow.png",
    });
    // Corrupt the downloaded executable. The installer must fail before it renders.
    await page.setViewportSize({ width: 1440, height: 960 });
    const damaged = structuredClone(pkg);
    validateClientArtifacts(damaged.artifact).home.javascript +=
      "\nthrow new Error('unsigned code ran');";
    await page.route(
      `**/api/v1/module/${module.id}/workspaces/*/artifact`,
      (route) => route.fulfill({ json: damaged }),
    );
    // Uninstall via UI first so a previous verified cache cannot satisfy this attempt.
    await page.goto("/modules");
    const card = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: "Custom notes", exact: true }),
    });
    await card.getByRole("button", { name: "Uninstall", exact: true }).click();
    await expect(
      card.getByText("Not installed on this device", { exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Install", exact: true }).click();
    await expect(
      page.getByText("Module checksum verification failed.", { exact: true }),
    ).toBeVisible();
  } finally {
    await pool.end();
  }
});
