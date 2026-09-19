import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "../support/executable-fixture";
import module from "../fixtures/offline-reads/module";
import { selectValue } from "./controls.helpers";

test("a signed custom view reads downloaded records after restart and distinguishes server-only requests", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const id = `offline-reads-${crypto.randomUUID().slice(0, 8)}`;
  const name = "Offline SDK notes";
  try {
    const artifact = await publishExecutableFixture({
      id,
      name,
      sourceDirectory: "tests/fixtures/offline-reads",
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = crypto.randomUUID();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
    };
    const created = await page.request.post("/api/v1/workspaces", {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: { id: workspace, name: "SDK read acceptance", currency: "EUR" },
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
    const response = await page.request.post(
      `/api/v1/module/${id}/workspaces/${workspace}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": crypto.randomUUID(),
          "x-module-version": artifact.version,
        },
        data: {
          action: "create",
          resource: "notes",
          input: { data: { name: "Office itinerary" } },
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("status", { name: "List source" })).toHaveText(
      "Server response",
    );
    await page
      .getByRole("button", { name: "Require server response", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("status", { name: "List source" }),
    ).toContainText("Downloaded ");
    await expect(
      page.getByText("This view has used downloaded records.", {
        exact: false,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Read Office itinerary", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Record source" }),
    ).toContainText("Office itinerary: Downloaded ");
    await page
      .getByRole("button", { name: "Require server response", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "A server response is required",
    );
    await page
      .getByRole("button", { name: "Create authoritative note", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "No change has been submitted",
    );
    await page
      .getByLabel("Find downloaded notes", { exact: true })
      .fill("Never downloaded");
    await page.getByRole("button", { name: "Read notes", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "not been downloaded for this request",
    );
    await page.getByLabel("Find downloaded notes", { exact: true }).fill("");
    await page.getByRole("button", { name: "Read notes", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/resource-reads", { recursive: true });
    await page.screenshot({
      path: "docs/verification/resource-reads/web-wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/resource-reads/web-narrow.png",
    });
    const records = await pool.query(
      "select data from suite.module_records where workspace_id=$1 and module_id=$2",
      [workspace, id],
    );
    expect(records.rows).toEqual([{ data: { name: "Office itinerary" } }]);
    await page.clock.install();
    await page.clock.setSystemTime(new Date(Date.now() + 25 * 3600000));
    await expect(
      page.getByText(
        "Connect to revalidate this workspace. Unsent drafts remain stored.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Downloaded notes", exact: true }),
    ).toHaveCount(0);
    await page.clock.setSystemTime(new Date());
    await page.setViewportSize({ width: 1440, height: 1000 });
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole("status", { name: "List source" })).toHaveText(
      "Server response",
    );
    await page
      .getByRole("button", { name: "Read Office itinerary", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Record source" }),
    ).toHaveText("Office itinerary: Server response");
    // A received revocation removes this view despite its downloaded data.
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspace, `${id}.notes.read`],
    );
    // Long-poll delivery may accept the newer policy and cancel a concurrent
    // bootstrap. Observe authoritative policy delivery through either path.
    const revokedPolicy = page.waitForResponse(async (response) => {
      if (
        !response.ok() ||
        !["bootstrap", "policy"].some((endpoint) =>
          response.url().includes(`/workspaces/${workspace}/${endpoint}`),
        )
      )
        return false;
      const body = await response.json();
      const permissions = (body.bootstrap ?? body).permissions;
      return (
        Array.isArray(permissions) && !permissions.includes(`${id}.notes.read`)
      );
    });
    await page.reload();
    const received = await (await revokedPolicy).json();
    expect((received.bootstrap ?? received).permissions).not.toContain(
      `${id}.notes.read`,
    );
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Downloaded notes", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Downloaded notes", exact: true }),
    ).toHaveCount(0);
  } finally {
    await pool.end();
  }
});
