import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  publishHostFixture,
  assignHostFixture,
  exportPermission,
} from "../host-capability-journey";
import { selectValue } from "./controls.helpers";
test("published modules use typed host exports while current authority rejects undeclared, revoked and foreign requests", async ({
  page,
}) => {
  test.setTimeout(90000);
  const id = `host-${randomUUID().slice(0, 8)}`,
    pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    const pkg = await publishHostFixture(id);
    expect(pkg.manifest.clientRequirements).toMatchObject({
      home: { "client.host": 1 },
    });
    expect(pkg.manifest.capabilities).toMatchObject({
      export: { kind: "files.export", permission: `${id}.export` },
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json(),
      workspace = randomUUID();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    };
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: { id: workspace, name: "Host capabilities", currency: "EUR" },
        })
      ).ok(),
    ).toBe(true);
    await assignHostFixture(pool, workspace, id);
    const authorize = (
      capability: string,
      version: string | undefined = pkg.version,
      target = workspace,
    ) =>
      page.request.post(
        `/api/v1/module/${id}/workspaces/${target}/capabilities/authorize`,
        {
          headers: {
            ...headers,
            ...(version ? { "x-module-version": version } : {}),
          },
          data: { capability },
        },
      );
    expect((await authorize("export")).status()).toBe(200);
    expect((await authorize("undeclared")).status()).toBe(403);
    expect((await authorize("export", "99.0.0")).status()).toBe(409);
    expect(
      (await authorize("export", pkg.version, randomUUID())).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(
          `/api/v1/module/${id}/workspaces/${workspace}/capabilities/authorize`,
          { headers, data: { capability: "export" } },
        )
      ).status(),
    ).toBe(400);
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page
      .getByRole("link", { name: "Capability notes", exact: true })
      .click();
    const area = page.getByRole("region", {
      name: "Module host actions",
      exact: true,
    });
    const download = page.waitForEvent("download");
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("module-notes.txt");
    expect(await readFile((await file.path())!, "utf8")).toBe(
      "Exported through the typed module host\n",
    );
    await expect(area.getByRole("status")).toHaveText("Download offered");
    await area
      .getByRole("button", { name: "Inspect local network", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      "requires the desktop application",
    );
    await exportPermission(pool, workspace, id, false);
    expect((await authorize("export")).status()).toBe(403);
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText("current permissions");
    expect(downloads).toEqual([]);
    await mkdir("docs/verification/host-capabilities", { recursive: true });
    await page.screenshot({
      path: "docs/verification/host-capabilities/revoked-web.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/host-capabilities/revoked-narrow.png",
    });
    await exportPermission(pool, workspace, id, true);
    await page.reload();
    await expect(area).toBeVisible();
    await page.evaluate(() => {
      delete document.documentElement.dataset.hostFixtureComplete;
      document.addEventListener(
        "host-fixture-complete",
        () => {
          document.documentElement.dataset.hostFixtureComplete = "true";
        },
        { once: true },
      );
    });
    let releaseAuthorization: (() => void) | undefined;
    const heldAuthorization = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    let authorizationReady = false;
    const authorizationRoute = `**/module/${id}/workspaces/${workspace}/capabilities/authorize`;
    await page.route(authorizationRoute, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      authorizationReady = true;
      await heldAuthorization;
      await route.fulfill({ response });
    });
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect.poll(() => authorizationReady).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(area).toHaveCount(0);
    releaseAuthorization!();
    await page.waitForFunction(
      () => document.documentElement.dataset.hostFixtureComplete === "true",
    );
    expect(downloads).toEqual([]);
    await page.unroute(authorizationRoute);
    await pool.query(
      "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=$2",
      [workspace, id],
    );
    expect((await authorize("export")).status()).toBe(403);
    await pool.query(
      "update suite.module_activations set state='enabled' where workspace_id=$1 and module_id=$2",
      [workspace, id],
    );
    await pool.query(
      "update suite.memberships set active=false where workspace_id=$1 and user_id=$2",
      [workspace, me.user.id],
    );
    expect((await authorize("export")).status()).toBe(403);
  } finally {
    await pool.end();
  }
});
