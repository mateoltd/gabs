import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "../executable-fixture";
import module from "../fixtures/custom-notes/module";
import { selectValue } from "./controls.helpers";

test("incompatible signed updates fail before download and preserve the installed release and records", async ({
  page,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const id = `host-ui-${crypto.randomUUID().slice(0, 8)}`;
  const name = "Host compatibility notes";
  try {
    const first = await publishExecutableFixture({ id, name });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = crypto.randomUUID();
    const created = await page.request.post("/api/v1/workspaces", {
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
        "idempotency-key": crypto.randomUUID(),
      },
      data: {
        id: workspace,
        name: "Host compatibility acceptance",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspace, id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspace, id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
      [workspace, id],
    );
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [
        workspace,
        module.permissions.map((p) => p.replaceAll("custom-notes", id)),
      ],
    );
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page.getByRole("link", { name, exact: true }).click();
    await page
      .getByLabel("Note name", { exact: true })
      .fill("Preserved across incompatible update");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByText("Preserved across incompatible update", { exact: true }),
    ).toBeVisible();
    const future = await publishExecutableFixture({
      id,
      name,
      hostRequirements: { "ui.Button": 99 },
    });
    let downloads = 0;
    page.on("request", (request) => {
      if (
        request.url().includes(`/module/${id}/`) &&
        request.url().includes("/artifact")
      )
        downloads++;
    });
    await page.goto("/modules");
    const card = page
      .locator(".module-install-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toContainText(`Version ${future.version}`);
    await expect(card).toContainText(`Installed ${first.version}`);
    await card.getByRole("button", { name: "Update", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText(
      "requires host contract ui.Button revision 99",
    );
    await expect(card.getByRole("alert")).toContainText(
      "Update the application or select a compatible module release",
    );
    await expect(card).toContainText(`Installed ${first.version}`);
    expect(downloads).toBe(0);
    const stored = await page.evaluate(
      async ({ key, id }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("suite-offline-v1");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise<{ version?: string; pending: boolean }>(
            (resolve, reject) => {
              const r = db
                .transaction("records")
                .objectStore("records")
                .get(key);
              r.onsuccess = () =>
                resolve({
                  version: r.result?.installed?.[id]?.version,
                  pending: !!r.result?.lifecycle?.[id],
                });
              r.onerror = () => reject(r.error);
            },
          );
        } finally {
          db.close();
        }
      },
      { key: `${me.user.id}/${workspace}/module-state`, id },
    );
    expect(stored).toEqual({ version: first.version, pending: false });
    const records = await pool.query(
      "select data from suite.module_records where workspace_id=$1 and module_id=$2",
      [workspace, id],
    );
    expect(records.rows).toContainEqual({
      data: { name: "Preserved across incompatible update" },
    });
    await mkdir("docs/verification/host-ui", { recursive: true });
    await card.screenshot({
      path: "docs/verification/host-ui/incompatible-update.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await card.screenshot({
      path: "docs/verification/host-ui/incompatible-update-narrow.png",
    });
    // A stale or incomplete catalog cannot bypass the signed artifact check.
    await page.setViewportSize({ width: 1440, height: 1000 });
    const platformUrl = `**/api/v1/workspaces/${workspace}/platform`;
    await page.route(platformUrl, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const state = await response.json();
      for (const release of state.releases)
        if (release.module_id === id)
          delete release.manifest.clientRequirements;
      await route.fulfill({ response, json: state });
    });
    await page.reload();
    await card.getByRole("button", { name: "Update", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText(
      "requires host contract ui.Button revision 99",
    );
    await expect.poll(() => downloads).toBeGreaterThan(0);
    await expect(
      card.getByRole("button", { name: "Update", exact: true }),
    ).toBeEnabled();
    await expect(card).toContainText(`Installed ${first.version}`);
    await expect(
      card.getByText("Installation pending", { exact: false }),
    ).toHaveCount(0);
    const receipts = await pool.query(
      "select version from suite.module_installations where workspace_id=$1 and module_id=$2 and state='installed'",
      [workspace, id],
    );
    expect(receipts.rows).toEqual([{ version: first.version }]);
    await page.unroute(platformUrl);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const repaired = await publishExecutableFixture({ id, name });
    await page.reload();
    await expect(card).toContainText(`Version ${repaired.version}`);
    await card.getByRole("button", { name: "Update", exact: true }).click();
    await expect(card).toContainText(`Installed ${repaired.version}`);
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByText("Preserved across incompatible update", { exact: true }),
    ).toBeVisible();
  } finally {
    await pool.end();
  }
});
