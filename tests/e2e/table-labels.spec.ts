import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";
import { startModuleDev } from "../../tooling/modules/module-dev/server";
import { selectValue } from "./controls.helpers";
import {
  assignTableLabels,
  publishTableLabels,
  tableLabelsId,
  tableLabelsName,
  tableTargets,
  tableData,
  inspectTableLabels,
} from "../support/table-labels-journey";
test("preview tables bound and deduplicate lookups and discard results after permission changes", async ({
  page,
}) => {
  test.setTimeout(120000);
  const server = await startModuleDev(
    resolve("tests/fixtures/table-labels"),
    0,
  );
  let active = 0,
    peak = 0,
    requests = 0,
    hold = false;
  const held: (() => void)[] = [];
  await page.route("**/action", async (route) => {
    if (route.request().postDataJSON()?.call?.action !== "references")
      return route.continue();
    requests++;
    active++;
    peak = Math.max(peak, active);
    try {
      const response = await route.fetch();
      if (hold) await new Promise<void>((resolve) => held.push(resolve));
      else await new Promise((resolve) => setTimeout(resolve, 40));
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    } finally {
      active--;
    }
  });
  try {
    await page.goto(server.origin);
    await expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 45000 },
    );
    const { table } = await inspectTableLabels(page);
    await expect.poll(() => requests).toBe(10);
    await expect.poll(() => active).toBe(0);
    expect(peak).toBe(4);
    hold = true;
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await expect.poll(() => held.length).toBeGreaterThan(0);
    hold = false;
    await page.getByText("Permission simulator", { exact: true }).click();
    await page
      .getByLabel("table-labels.targets.read", { exact: true })
      .uncheck();
    for (const release of held.splice(0)) release();
    await expect(table).toContainText("Reference unavailable");
    await expect(table).not.toContainText("Target 105");
    await page.getByLabel("table-labels.targets.read", { exact: true }).check();
    await expect(table).toContainText("Target 105");
  } finally {
    for (const release of held) release();
    await server.close();
  }
});
test("installed reference tables resolve off-page nested links and reject stale labels after archival or denial", async ({
  page,
}) => {
  test.setTimeout(150000);
  await publishTableLabels();
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
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
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
    };
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers: { ...headers, "idempotency-key": crypto.randomUUID() },
          data: {
            id: workspace,
            name: "Reference table acceptance",
            currency: "EUR",
          },
        })
      ).ok(),
    ).toBe(true);
    await assignTableLabels(pool, workspace);
    for (const input of tableTargets)
      expect(
        (
          await page.request.post(
            `/api/v1/module/${tableLabelsId}/workspaces/${workspace}/records`,
            {
              headers: { ...headers, "idempotency-key": crypto.randomUUID() },
              data: { resource: "targets", action: "create", input },
            },
          )
        ).ok(),
      ).toBe(true);
    expect(
      (
        await page.request.post(
          `/api/v1/module/${tableLabelsId}/workspaces/${workspace}/records`,
          {
            headers: { ...headers, "idempotency-key": crypto.randomUUID() },
            data: {
              resource: "records",
              action: "create",
              input: { data: tableData },
            },
          },
        )
      ).ok(),
    ).toBe(true);
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page
      .getByRole("link", { name: tableLabelsName, exact: true })
      .click();
    const { table } = await inspectTableLabels(page);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Reference records"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/table-labels", { recursive: true });
    await page.screenshot({ path: "docs/verification/table-labels/wide.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/table-labels/narrow.png",
    });
    await table.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => table.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    await table.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.screenshot({
      path: "docs/verification/table-labels/narrow-end.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/references/records?**", (route) => {
      if (
        new URL(route.request().url()).searchParams.get("selected") ===
        tableTargets[103].id
      )
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            code: "FORBIDDEN",
            message: "Reference access revoked",
          }),
        });
      return route.continue();
    });
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await expect(table).toContainText(
      "Some reference labels could not be loaded.",
    );
    await expect(table).not.toContainText("Target 105");
    await page.unroute("**/references/records?**");
    await table
      .getByRole("button", { name: "Retry reference labels", exact: true })
      .click();
    await expect(table).toContainText("Target 105");
    await pool.query(
      "update suite.module_records set archived=true where workspace_id=$1 and module_id=$2 and resource='targets' and id=$3",
      [workspace, tableLabelsId, tableTargets[103].id],
    );
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await expect(table).toContainText("Reference unavailable");
    await expect(table).not.toContainText("Target 104");
    await expect(table).toContainText("Target 105");
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1 and protected",
      [workspace, `${tableLabelsId}.targets.read`],
    );
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await expect(table).toContainText(
      "Some reference labels could not be loaded.",
    );
    await expect(table).not.toContainText("Target 105");
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and protected",
      [workspace, `${tableLabelsId}.targets.read`],
    );
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await expect(table).toContainText("Target 105");
    await expect(table).not.toContainText("Target 104");
  } finally {
    await pool.end();
  }
});

test("standalone tables page through encrypted records and resolve nested labels after unlocking", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const pkg = await publishTableLabels();
  const publicKey = await readFile(
    `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
    "utf8",
  );
  const bundle = await build({
    stdin: {
      contents:
        "export {createLocalProfile} from './composition/src/local/product';export {hydrateModule,createModuleClient} from '@suite/module-sdk';export {moduleContract} from '@suite/module-sdk/client-artifact';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await page.route("**/table-profile-seed.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  const worker = await build({
    entryPoints: [resolve("composition/src/local/worker-entry.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await page.route("**/worker-entry.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: worker.outputFiles[0].text,
    }),
  );
  await page.goto("/");
  const seeded = await page.evaluate(
    async ({ pkg, publicKey, target }) => {
      const path = "/table-profile-seed.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../composition/src/local/product") &
        typeof import("@suite/module-sdk") &
        typeof import("@suite/module-sdk/client-artifact");
      const session = await sdk.createLocalProfile(
        "Paged reference profile",
        "correct horse battery staple",
      );
      try {
        await session.install(pkg, publicKey);
        const module = sdk.hydrateModule(sdk.moduleContract(pkg.artifact));
        const client = sdk.createModuleClient(module, (call, options) =>
          session.execute(module, call, options),
        );
        const targetRow = await client.resource("targets").create(target.data);
        const records: { id: string; name: string }[] = [];
        for (let index = 0; index < 51; index++) {
          const name = `Local record ${String(index + 1).padStart(3, "0")}`;
          const record = await client.resource("records").create({
            name,
            pair: [targetRow.id, index],
            links: { primary: targetRow.id },
            extras: { fixed: "kept" },
          });
          records.push({ id: record.id, name });
        }
        records.sort((a, b) => a.id.localeCompare(b.id));
        return {
          profileId: session.id,
          first: records[0].name,
          last: records[50].name,
        };
      } finally {
        session.lock();
      }
    },
    { pkg, publicKey, target: tableTargets[104] },
  );
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Open local profiles", exact: true })
    .click();
  await selectValue(page, "Profile", seeded.profileId);
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await selectValue(page, "Module and resource", `${tableLabelsId}/records`);
  const table = page.getByRole("region", {
    name: "Records records",
    exact: true,
  });
  await expect(table.getByRole("row")).toHaveCount(51);
  await expect(table).toContainText(seeded.first);
  await expect(table).not.toContainText(seeded.last);
  await page.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText(seeded.last);
  for (const details of await table.locator("details").all())
    await details.locator(":scope > summary").click();
  await expect(table.getByText("Target 105", { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Next records", exact: true }),
  ).toBeDisabled();
  await mkdir("docs/verification/table-labels", { recursive: true });
  await page.screenshot({
    path: "docs/verification/table-labels/local-page.png",
  });
  await page
    .getByRole("button", { name: "Previous records", exact: true })
    .click();
  await expect(table.getByRole("row")).toHaveCount(51);
});
