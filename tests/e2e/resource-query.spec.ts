import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createModuleClient } from "@suite/module-sdk";
import queryModule from "../fixtures/resource-query/module";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { startModuleDev } from "../../tooling/modules/module-dev/server";
import { selectValue } from "./controls.helpers";
import {
  publishQueryFixture,
  assignQueryFixture,
  queryId,
  queryName,
  queryData,
  exerciseQuery,
} from "../support/resource-query-journey";

test("development resource queries cancel stale pages, survive rerenders and recheck changed permissions", async ({
  page,
}) => {
  test.setTimeout(120000);
  const server = await startModuleDev(
    resolve("tests/fixtures/resource-query"),
    0,
  );
  let requests = 0;
  let fail = false;
  let holdSearch: string | undefined;
  let release: (() => void) | undefined;
  let released = 0;
  await page.route("**/action", async (route) => {
    const call = route.request().postDataJSON()?.call;
    if (call?.action !== "list") return route.continue();
    requests++;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { message: "Temporarily unavailable" },
      });
    const response = await route.fetch();
    if (holdSearch && call.input.search === holdSearch) {
      await new Promise<void>((done) => {
        release = done;
      });
      released++;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(server.origin);
    await expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 45000 },
    );
    const { table, state, button } = await exerciseQuery(page);
    const before = requests;
    await page
      .getByRole("textbox", { name: "Unrelated input", exact: true })
      .fill("Retained while reading");
    await expect(table).toContainText("Record 07");
    expect(requests).toBe(before);
    fail = true;
    await button("Refresh records").click();
    await expect(state).toHaveText("Records could not be loaded.");
    await expect(table).toHaveCount(0);
    await expect(page.locator("#custom-preview")).toContainText(
      "Temporarily unavailable",
    );
    fail = false;
    await button("Retry records").click();
    await expect(table).toContainText("Record 07");
    const search = page.getByRole("textbox", {
      name: "Search records",
      exact: true,
    });
    holdSearch = "Record 02";
    await search.fill(holdSearch);
    await expect.poll(() => !!release).toBe(true);
    await expect(state).toHaveText("Loading records…");
    await expect(table).toHaveCount(0);
    await search.fill("Record 03");
    await expect(table).toContainText("Record 03");
    holdSearch = undefined;
    release!();
    await expect.poll(() => released).toBe(1);
    await expect(table).toContainText("Record 03");
    await expect(table).not.toContainText("Record 02");
    release = undefined;
    holdSearch = "Record 06";
    await search.fill(holdSearch);
    await expect.poll(() => !!release).toBe(true);
    await page.getByText("Permission simulator", { exact: true }).click();
    const revoked = page.waitForResponse(
      (response) =>
        response.url().endsWith("/action") &&
        response.request().postDataJSON()?.action === "permissions",
    );
    await page
      .getByLabel("query-proof.records.read", { exact: true })
      .uncheck();
    const changed = await revoked;
    expect(changed.ok()).toBe(true);
    expect((await changed.json()).permissions).not.toContain(
      "query-proof.records.read",
    );
    holdSearch = undefined;
    release!();
    await expect(state).toHaveText("Records could not be loaded.");
    await expect(table).toHaveCount(0);
    await expect(page.locator("#custom-preview")).toContainText(
      "Missing permission",
    );
    await page.getByLabel("query-proof.records.read", { exact: true }).check();
    await expect(table).toContainText("Record 06");
    await expect(
      page.getByRole("textbox", { name: "Unrelated input", exact: true }),
    ).toHaveValue("Retained while reading");
    await mkdir("docs/verification/resource-query", { recursive: true });
    await page.locator("#custom-preview").screenshot({
      path: "docs/verification/resource-query/development.png",
    });
  } finally {
    release?.();
    await server.close();
  }
});

test("signed resource query views compose public controls, cancel transport and recover after reconnect", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let release: (() => void) | undefined;
  let cancelled = 0;
  try {
    const pkg = await publishQueryFixture();
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
            name: "Resource query acceptance",
            currency: "EUR",
          },
        })
      ).ok(),
    ).toBe(true);
    await assignQueryFixture(pool, workspace);
    for (const [resource, rows] of [
      ["records", queryData],
      [
        "other",
        [
          {
            id: "00000000-0000-4000-8000-000000000008",
            data: { name: "Other record", amount: 100, approved: true },
          },
        ],
      ],
    ] as const)
      for (const input of rows) {
        const saved = await page.request.post(
          `/api/v1/module/${queryId}/workspaces/${workspace}/records`,
          {
            headers: { ...headers, "idempotency-key": crypto.randomUUID() },
            data: { resource, action: "create", input },
          },
        );
        expect(saved.ok(), await saved.text()).toBe(true);
      }
    let damageMutation = true;
    const typed = createModuleClient(
      { ...queryModule, id: queryId, version: pkg.version },
      async (call) => {
        const response = await page.request.post(
          `/api/v1/module/${queryId}/workspaces/${workspace}/records`,
          {
            headers: {
              ...headers,
              "x-module-version": pkg.version,
              ...(call.key ? { "idempotency-key": call.key } : {}),
            },
            data: {
              resource: call.resource,
              action: call.action,
              input: call.input,
            },
          },
        );
        expect(response.ok(), await response.text()).toBe(true);
        const result = await response.json();
        if (call.action === "create" && damageMutation) {
          damageMutation = false;
          return { ...result, data: { ...result.data, amount: "malformed" } };
        }
        return result;
      },
    ).resource("records");
    const receiptKey = crypto.randomUUID();
    const captured = {
      name: "Response recovery proof",
      amount: 99,
      approved: false,
    };
    await expect(typed.create(captured, receiptKey)).rejects.toMatchObject({
      code: "INVALID_RESOURCE_RESPONSE",
      idempotencyKey: receiptKey,
    });
    const accepted = await typed.create(captured, receiptKey);
    expect(accepted.data).toEqual(captured);
    expect(
      Number(
        (
          await pool.query(
            "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2 and data->>'name'=$3",
            [workspace, queryId, captured.name],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await pool.query(
            "select count(*) from suite.audit where workspace_id=$1 and action=$2 and target_id=$3",
            [workspace, `${queryId}.records.create`, accepted.id],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    await typed.archive(accepted.id, accepted.version, crypto.randomUUID());
    const query = (data: { minimum: number; cursor?: string }) =>
      page.request.post(
        `/api/v1/module/${queryId}/workspaces/${workspace}/queries/approved`,
        { headers: { ...headers, "x-module-version": pkg.version }, data },
      );
    const firstQuery = await query({ minimum: 2 });
    expect(firstQuery.ok(), await firstQuery.text()).toBe(true);
    const firstPage = await firstQuery.json();
    expect(firstPage.names).toEqual(["Record 07", "Record 05"]);
    expect(firstPage.nextCursor).toBeTruthy();
    const nextQuery = await query({ minimum: 2, cursor: firstPage.nextCursor });
    expect(nextQuery.ok(), await nextQuery.text()).toBe(true);
    expect(await nextQuery.json()).toEqual({
      names: ["Record 03"],
      nextCursor: null,
    });
    expect(
      (await query({ minimum: 3, cursor: firstPage.nextCursor })).status(),
    ).toBe(400);
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1 and protected",
      [workspace, `${queryId}.records.read`],
    );
    try {
      expect((await query({ minimum: 2 })).status()).toBe(403);
    } finally {
      await pool.query(
        "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and protected",
        [workspace, `${queryId}.records.read`],
      );
    }
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
    await page.getByRole("link", { name: queryName, exact: true }).click();
    const { table, state } = await exerciseQuery(page);
    const resourceRoute = `**/module/${queryId}/workspaces/${workspace}/records`;
    await page.route(resourceRoute, async (route) => {
      if (route.request().postDataJSON()?.action !== "list")
        return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.items[0].data.amount = "malformed";
      await route.fulfill({ response, json: body });
    });
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await expect(state).toHaveText("Records could not be loaded.");
    await expect(table).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: queryName, exact: true }),
    ).toContainText("data that could not be verified");
    await mkdir("docs/verification/resource-response", { recursive: true });
    await page.screenshot({
      path: "docs/verification/resource-response/invalid-read.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/resource-response/invalid-read-narrow.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.unroute(resourceRoute);
    await page
      .getByRole("button", { name: "Retry records", exact: true })
      .click();
    await expect(table).toContainText("Record 07");
    expect(
      (
        await new AxeBuilder({ page })
          .include(`[aria-label="${queryName}"]`)
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const search = page.getByRole("textbox", {
      name: "Search records",
      exact: true,
    });
    page.on("requestfailed", (request) => {
      if (
        request.url().includes(`/module/${queryId}/`) &&
        request.postDataJSON()?.input?.search === "Record 02"
      )
        cancelled++;
    });
    await page.route(
      `**/module/${queryId}/workspaces/${workspace}/records`,
      async (route) => {
        if (route.request().postDataJSON()?.input?.search !== "Record 02")
          return route.continue();
        const response = await route.fetch();
        await new Promise<void>((done) => {
          release = done;
        });
        await route.fulfill({ response }).catch(() => {});
      },
    );
    await search.fill("Record 02");
    await expect.poll(() => !!release).toBe(true);
    await search.fill("Record 03");
    await expect(table).toContainText("Record 03");
    await expect.poll(() => cancelled).toBeGreaterThan(0);
    release!();
    await context.setOffline(true);
    await expect(state).toHaveText("Reconnect to read records.");
    await expect(table).toHaveCount(0);
    await context.setOffline(false);
    await expect(table).toContainText("Record 03");
    await search.fill("");
    await expect(table).toContainText("Record 07");
    await mkdir("docs/verification/resource-query", { recursive: true });
    await page.screenshot({
      path: "docs/verification/resource-query/wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/resource-query/narrow.png",
    });
  } finally {
    release?.();
    await pool.end();
  }
});
