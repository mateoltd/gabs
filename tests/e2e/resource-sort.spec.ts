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
  publishSortFixture,
  assignSortFixture,
  sortId,
  sortData,
  exerciseSort,
  setSort,
} from "../resource-sort-journey";
test("sorted server pages preserve boundaries, reject foreign cursors and reuse authorized offline pages", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await publishSortFixture();
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
    await assignSortFixture(pool, workspaceId);
    for (const input of sortData) {
      const saved = await page.request.post(
        `/api/v1/module/${sortId}/workspaces/${workspaceId}/records`,
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
      .getByRole("link", { name: "Sorted records", exact: true })
      .click();
    const { records, status, second } = await exerciseSort(page);
    await page.getByRole("button", { name: "Reset sort", exact: true }).click();
    await expect(records.getByRole("row").nth(1)).toContainText("Record 01");
    const refreshed = page.waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== "POST" || !response.url().endsWith("/records"))
        return false;
      const body = request.postDataJSON();
      return (
        body.action === "list" &&
        body.input.orderBy?.length === 1 &&
        body.input.orderBy[0].field === "amount" &&
        !body.input.cursor
      );
    });
    await setSort(page, [{ field: "amount", direction: "desc" }]);
    expect((await refreshed).ok()).toBeTruthy();
    await expect(records.getByRole("row").nth(1)).toContainText("Record 24");
    await context.setOffline(true);
    await expect(
      page.getByText(
        "Offline copy. Changes remain pending until the server accepts them.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(status).toHaveText("Page 2. 10 records.");
    expect(await records.getByRole("row").allTextContents()).toEqual(second);
    await page.getByRole("button", { name: "First page", exact: true }).click();
    await setSort(page, [{ field: "amount", direction: "asc" }]);
    await expect(
      page.getByText(
        "No matching records have been downloaded on this device.",
      ),
    ).toBeVisible();
    await setSort(page, [{ field: "amount", direction: "desc" }]);
    await expect(records.getByRole("row").nth(1)).toContainText("Record 24");
    await context.setOffline(false);
    await expect(
      page.getByText(
        "Offline copy. Changes remain pending until the server accepts them.",
        { exact: true },
      ),
    ).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include("#module-resource-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/resource-sort", { recursive: true });
    await page.screenshot({ path: "docs/verification/resource-sort/wide.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: /^Sort \(1\)$/ }).click();
    await page
      .getByRole("form", { name: "Sort records" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/resource-sort/narrow.png",
    });
    await page
      .getByRole("button", { name: "Apply sort", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/resource-sort/narrow-actions.png",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const endpoint = `/api/v1/module/${sortId}/workspaces/${workspaceId}/records`;
    const post = async (input: unknown, url = endpoint) =>
      page.request.post(url, {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: { resource: "records", action: "list", input },
      });
    const input = {
      orderBy: [{ field: "amount", direction: "desc" }],
      limit: 5,
    };
    const firstResponse = await post(input);
    expect(firstResponse.ok(), await firstResponse.text()).toBeTruthy();
    const first = await firstResponse.json();
    expect(
      first.items.map((r: { id: string }) => Number(r.id.slice(-2))),
    ).toEqual([24, 21, 22, 23, 18]);
    for (const bad of [
      { ...input, orderBy: [{ field: "invented", direction: "asc" }] },
      { ...input, orderBy: [{ field: "amount", direction: "up" }] },
      { ...input, cursor: sortData[0].id },
      { ...input, cursor: first.nextCursor, where: { approved: true } },
      {
        ...input,
        cursor: first.nextCursor,
        orderBy: [{ field: "amount", direction: "asc" }],
      },
      { cursor: first.nextCursor },
    ]) {
      const rejected = await post(bad);
      expect(rejected.status(), await rejected.text()).toBe(400);
    }
    const tampered =
      first.nextCursor.slice(0, 10) +
      (first.nextCursor[10] === "a" ? "b" : "a") +
      first.nextCursor.slice(11);
    expect((await post({ ...input, cursor: tampered })).status()).toBe(400);
    const other = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: { id: other, name: "Other cursor scope", currency: "EUR" },
        })
      ).ok(),
    ).toBeTruthy();
    await assignSortFixture(pool, other);
    expect(
      (
        await post(
          { ...input, cursor: first.nextCursor },
          `/api/v1/module/${sortId}/workspaces/${other}/records`,
        )
      ).status(),
    ).toBe(400);
    const anchor = first.items.at(-1);
    const archived = await page.request.post(endpoint, {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        resource: "records",
        action: "archive",
        input: { id: anchor.id, baseVersion: anchor.version },
      },
    });
    expect(archived.ok(), await archived.text()).toBeTruthy();
    const next = await post({ ...input, cursor: first.nextCursor });
    expect(next.ok(), await next.text()).toBeTruthy();
    expect(
      (await next.json()).items.map((r: { id: string }) =>
        Number(r.id.slice(-2)),
      ),
    ).toEqual([19, 20, 15, 16, 17]);
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});

test("standalone sorted pages survive unlock and reset safely across resources", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pkg = await publishSortFixture();
  const publicKey = await readFile(
    `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
    "utf8",
  );
  const bundle = await build({
    stdin: {
      contents:
        "export {createLocalProfile} from './packages/platform/src/local-profiles';export {hydrateModule,createModuleClient} from '@suite/module-sdk';export {moduleContract} from '@suite/module-sdk/client-artifact';",
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
    entryPoints: [resolve("packages/platform/src/local-worker-entry.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await page.route("**/local-worker-entry.ts", (route) =>
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
      )) as typeof import("../../packages/platform/src/local-profiles") &
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
  await selectValue(page, "Module and resource", `${sortId}/records`);
  const table = page.getByRole("region", {
    name: "Records records",
    exact: true,
  });
  await expect(table.getByRole("row")).toHaveCount(51);
  await setSort(page, [{ field: "amount", direction: "desc" }]);
  await expect(table.getByRole("row").nth(1)).toContainText("Local record 051");
  await page.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Local record 001");
  await mkdir("docs/verification/resource-sort", { recursive: true });
  await page.screenshot({ path: "docs/verification/resource-sort/local.png" });
  await selectValue(page, "Module and resource", `${sortId}/supplements`);
  await expect(
    page
      .getByRole("region", { name: "Notes records", exact: true })
      .getByRole("row"),
  ).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await selectValue(page, "Module and resource", `${sortId}/records`);
  await expect(table.getByRole("row")).toHaveCount(51);
  await expect(
    page.getByRole("button", { name: "Reset sort", exact: true }),
  ).toHaveCount(0);
  await expect(table.getByRole("row").nth(1)).toContainText(seeded.first);
  await expect(page.locator(".select-popup")).toBeHidden();
  await page.screenshot({
    path: "docs/verification/resource-sort/local-reset.png",
  });
});
