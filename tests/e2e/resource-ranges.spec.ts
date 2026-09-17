import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import {
  publishRangeFixture,
  assignRangeFixture,
  rangeId,
  rangeData,
  exerciseRanges,
  setRange,
} from "../support/resource-ranges-journey";
test("typed range controls use server validation and isolated offline cache keys", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await publishRangeFixture();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspaceId = randomUUID();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    };
    const created = await page.request.post("/api/v1/workspaces", {
      headers,
      data: {
        id: workspaceId,
        name: "Generated list acceptance",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    await assignRangeFixture(pool, workspaceId);
    for (const input of rangeData) {
      const saved = await page.request.post(
        `/api/v1/module/${rangeId}/workspaces/${workspaceId}/records`,
        {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: { resource: "records", action: "create", input },
        },
      );
      expect(saved.ok(), await saved.text()).toBeTruthy();
    }
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
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
    await page
      .getByRole("link", { name: "Range records", exact: true })
      .click();
    const { records, status } = await exerciseRanges(page);
    const endpoint = `/api/v1/module/${rangeId}/workspaces/${workspaceId}/records`;
    const list = async (input: unknown) =>
      page.request.post(endpoint, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: { resource: "records", action: "list", input },
      });
    for (const input of [
      { ranges: { amount: { gte: "0" } } },
      { limit: "10" },
      { ranges: { amount: { gte: 0, invented: 1 } } },
      { unexpected: true },
      { ranges: { approved: { gte: true } } },
      { ranges: { missing: { gte: 1 } } },
      { ranges: { date: { gte: "tomorrow" } } },
      { ranges: { amount: { gt: 1, lte: 1 } } },
    ]) {
      const rejected = await list(input);
      expect(rejected.status(), await rejected.text()).toBe(400);
    }
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1 and protected",
      [workspaceId, `${rangeId}.records.read`],
    );
    const denied = await list({ ranges: { amount: { gte: 0 } } });
    expect(denied.status()).toBe(403);
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and protected",
      [workspaceId, `${rangeId}.records.read`],
    );
    // PostgreSQL comparisons must agree with standalone Unicode order.
    for (const name of ["U\uE000", "U😀"]) {
      const saved = await page.request.post(endpoint, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: {
          resource: "records",
          action: "create",
          input: {
            data: { name, amount: 0, date: "2026-09-17", approved: true },
          },
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
    }
    const unicode = await list({ ranges: { name: { gt: "U\uE000" } } });
    expect(unicode.ok()).toBeTruthy();
    expect(
      (await unicode.json()).items.map(
        (r: { data: { name: string } }) => r.data.name,
      ),
    ).toEqual(["U😀"]);
    expect(
      (
        await new AxeBuilder({ page })
          .include("#module-resource-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/resource-ranges", { recursive: true });
    await page.screenshot({
      path: "docs/verification/resource-ranges/wide.png",
    });
    await context.setOffline(true);
    await expect(
      page.getByText(
        "Offline copy. Changes remain pending until the server accepts them.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(status).toHaveText("Page 1. 2 records.");
    await page
      .getByRole("button", { name: "Clear ranges", exact: true })
      .click();
    // Empty ranges reuse the original downloaded page, not a filtered result.
    await expect(status).toHaveText("Page 1. 10 records.");
    await setRange(page, "date", "2026-09-04", "2026-09-10");
    await expect(
      page.getByText(
        "No matching records have been downloaded on this device.",
      ),
    ).toBeVisible();
    await setRange(page, "amount", "0", "1");
    // Reversing insertion order uses the same normalized range cache key.
    await expect(status).toHaveText("Page 1. 2 records.");
    await expect(records).toContainText("Record 04");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /^Ranges/ }).click();
    await selectValue(page, "Range field", "amount");
    await selectValue(page, "Comparison", "between");
    await page
      .getByRole("form", { name: "Filter ranges" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/resource-ranges/narrow.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Apply range", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/resource-ranges/narrow-actions.png",
    });
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});

test("standalone range controls query encrypted records offline and reset pagination", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const pkg = await publishRangeFixture();
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
    async ({ pkg, publicKey }) => {
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
        const records: { id: string; name: string }[] = [];
        for (let index = 0; index < 51; index++) {
          const name = `Local record ${String(index + 1).padStart(3, "0")}`;
          const record = await client.resource("records").create({
            name,
            amount: index,
            date: "2026-09-17",
            approved: true,
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
    { pkg, publicKey },
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
  await selectValue(page, "Module and resource", `${rangeId}/records`);
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
  await setRange(page, "amount", "10", "12");
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("Local record 011");
  await expect(table).toContainText("Local record 013");
  await expect(table).not.toContainText("Local record 014");
  await expect(
    page.getByRole("button", { name: "Next records", exact: true }),
  ).toHaveCount(0);
  await mkdir("docs/verification/resource-ranges", { recursive: true });
  await page.screenshot({
    path: "docs/verification/resource-ranges/local.png",
  });
  await setRange(page, "amount", "99");
  await expect(table.getByRole("row")).toHaveCount(1);
  await expect(
    page.getByText("No records match the current ranges.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/verification/resource-ranges/local-empty.png",
  });
  await page
    .getByRole("button", { name: "Remove Amount range", exact: true })
    .click();
  await expect(table.getByRole("row")).toHaveCount(51);
});
