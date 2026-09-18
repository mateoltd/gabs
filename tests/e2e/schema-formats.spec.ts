import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { startModuleDev } from "../../tooling/modules/module-dev/server";
import {
  assignFormats,
  exerciseFormats,
  exerciseLocalFormats,
  formatId,
  formatName,
  publishFormats,
  valid,
} from "../support/schema-formats-journey";

test("independently bundled development forms validate formats in host UI and simulation", async ({
  page,
}) => {
  test.setTimeout(90000);
  const server = await startModuleDev(
    resolve("tests/fixtures/schema-formats"),
    0,
  );
  try {
    await page.goto(server.origin);
    await exerciseFormats(page);
    const state = await (
      await page.request.get(server.origin + "/state")
    ).json();
    expect(
      state.records.records.map((row: { data: unknown }) => row.data),
    ).toEqual([valid]);
  } finally {
    await server.close();
  }
});

test("installed signed formats reject malformed API requests without committing and preserve retries", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const artifact = await publishFormats();
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
    const workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
    await assignFormats(pool, workspace);
    const key = crypto.randomUUID();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": key,
      "x-module-version": artifact.artifact.version as string,
    };
    const path = `/api/v1/module/${formatId}/workspaces/${workspace}/records`;
    const count = async () =>
      Number(
        (
          await pool.query(
            "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
            [workspace, formatId],
          )
        ).rows[0].count,
      );
    for (const [field, value] of Object.entries({
      identifier: "invalid",
      email: "reader..office@example.com",
      website: "/relative",
      date: "2025-02-29",
      time: "09:30:00",
      timestamp: "2025-02-29T09:30:00Z",
    })) {
      const response = await page.request.post(path, {
        headers,
        data: {
          resource: "records",
          action: "create",
          input: { data: { ...valid, [field]: value } },
        },
      });
      expect(response.status(), await response.text()).toBe(400);
      expect(await count()).toBe(0);
    }
    const create = () =>
      page.request.post(path, {
        headers,
        data: { resource: "records", action: "create", input: { data: valid } },
      });
    const accepted = await create();
    expect(accepted.status(), await accepted.text()).toBe(200);
    expect(await (await create()).json()).toEqual(await accepted.json());
    expect(await count()).toBe(1);
    const execute = (input: typeof valid, key: string) =>
      page.request.post(
        `/api/v1/module/${formatId}/workspaces/${workspace}/operations/echo`,
        { headers: { ...headers, "idempotency-key": key }, data: input },
      );
    const operationKey = crypto.randomUUID();
    for (const bad of [
      { ...valid, date: "2025-02-29" },
      { ...valid, email: "bad-output@example.com" },
    ]) {
      const response = await execute(bad, operationKey);
      expect(response.status(), await response.text()).toBe(400);
      expect(await count()).toBe(1);
    }
    const operationResult = await execute(valid, operationKey);
    expect(operationResult.status(), await operationResult.text()).toBe(200);
    expect(await operationResult.json()).toEqual(valid);
    expect(await (await execute(valid, operationKey)).json()).toEqual(valid);
    expect(await count()).toBe(2);
    await page.reload();
    await page.getByRole("link", { name: formatName, exact: true }).click();
    await exerciseFormats(page);
    expect(await count()).toBe(3);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Formatted intake"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/schema-formats", { recursive: true });
    await page
      .getByRole("heading", { name: "Formatted intake", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/schema-formats/wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: "docs/verification/schema-formats/narrow.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await exerciseLocalFormats(page, () => context.setOffline(true));
    expect(await count()).toBe(3);
  } finally {
    await pool.end();
  }
});
