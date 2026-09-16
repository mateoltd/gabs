import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { publishLocalPackage } from "../local-package-fixture";
import { selectValue } from "./controls.helpers";

test("partial local downloads survive reload, recheck missing-package access and install offline after review", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const provider = await publishLocalPackage({
    name: `Download foundation ${suffix}`,
  });
  const root = await publishLocalPackage({
    name: `Download notes ${suffix}`,
    dependencies: { [provider.pkg.module_id]: "^1" },
    dependencyPackages: [provider.pkg],
  });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let workspace = "",
    interrupted = true,
    providerRequests = 0;
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const saved = () =>
    page.getByRole("list", { name: "Saved local downloads", exact: true });
  const localProfiles = async () => {
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
  };
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await button("Open workspace").click();
    await expect(button("Account menu")).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
    for (const id of [provider.pkg.module_id, root.pkg.module_id]) {
      await pool.query(
        "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
        [workspace, id],
      );
      await pool.query(
        "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
        [workspace, id],
      );
      await pool.query(
        "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1 on conflict do nothing",
        [workspace, id],
      );
    }
    await context.route(
      `**/module/${provider.pkg.module_id}/workspaces/${workspace}/artifact`,
      async (route) => {
        providerRequests++;
        await route.continue();
      },
    );
    await context.route(
      `**/module/${root.pkg.module_id}/workspaces/${workspace}/artifact`,
      async (route) => {
        if (interrupted) await route.abort("failed");
        else await route.continue();
      },
    );
    await localProfiles();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Download recovery");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    await button("Manage local modules").click();
    await button("Browse personal modules").click();
    await button(`Install ${root.pkg.artifact.name}`).click();
    await expect(
      saved().getByText("1 of 2 releases saved", { exact: true }),
    ).toBeVisible();
    await expect(button("Resume download")).toBeEnabled();
    await expect(
      saved().getByText("1 of 2 releases saved", { exact: true }),
    ).toBeInViewport();
    expect(providerRequests).toBe(1);
    await expect(
      page
        .getByRole("table", { name: "Local modules", exact: true })
        .getByRole("row")
        .filter({ hasText: String(root.pkg.artifact.name) }),
    ).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/local-downloads", { recursive: true });
    await page.screenshot({
      path: "docs/verification/local-downloads/interrupted.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      saved().getByText("1 of 2 releases saved", { exact: true }),
    ).toBeInViewport();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/local-downloads/interrupted-narrow.png",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(button("Account menu")).toBeVisible();
    await localProfiles();
    // The reload destroys all in-memory download state.
    const profileId = await page.evaluate(async () => {
      const request = indexedDB.open("suite-local-profiles");
      const db = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      const read = db.transaction("vaults").objectStore("vaults").getAll();
      const vaults = await new Promise<{ id: string }[]>((resolve) => {
        read.onsuccess = () => resolve(read.result);
      });
      db.close();
      return vaults[0].id;
    });
    await selectValue(page, "Profile", profileId);
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Unlock profile").click();
    await button("Manage local modules").click();
    await expect(
      saved().getByText("1 of 2 releases saved", { exact: true }),
    ).toBeVisible();
    interrupted = false;
    await pool.query(
      "update suite.entitlements set active=false where workspace_id=$1 and module_id=$2",
      [workspace, root.pkg.module_id],
    );
    await button("Resume download").click();
    await expect(page.getByRole("alert")).toContainText("must be enabled");
    expect(providerRequests).toBe(1);
    await pool.query(
      "update suite.entitlements set active=true where workspace_id=$1 and module_id=$2",
      [workspace, root.pkg.module_id],
    );
    await button("Resume download").click();
    await expect(
      page.getByRole("group", {
        name: String(provider.pkg.artifact.name),
        exact: true,
      }),
    ).toBeVisible();
    expect(providerRequests).toBe(1);
    await button("Back to modules").click();
    await expect(
      saved().getByText("2 of 2 releases saved", { exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await button("Review installation").click();
    await page
      .getByLabel("Prefix", { exact: true })
      .first()
      .fill("Recovered: ");
    await button("Save local installation").click();
    await expect(
      page.getByText(
        `${root.pkg.artifact.name} is ready in this local profile.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(saved()).toHaveCount(0);
    await button("Close dialog").click();
    await button("Local actions").click();
    await selectValue(page, "Action", root.pkg.module_id + "/capture");
    await page.getByLabel("Text", { exact: true }).fill("Verified download");
    await button("Run locally").click();
    await expect(
      page.getByText("Completed and saved locally.", { exact: true }),
    ).toBeVisible();
    await button("Close dialog").click();
    await selectValue(
      page,
      "Module and resource",
      root.pkg.module_id + "/items",
    );
    await expect(
      page.getByRole("cell", {
        name: "Recovered: Verified download",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/verification/local-downloads/installed.png",
    });
  } finally {
    await context.setOffline(false);
    if (workspace)
      await pool.query(
        "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=any($2::text[])",
        [workspace, [provider.pkg.module_id, root.pkg.module_id]],
      );
    await pool.end();
  }
});
