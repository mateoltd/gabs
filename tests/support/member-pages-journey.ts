import "dotenv/config";
import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import type { Member, MemberPage } from "@suite/contracts";
import type { ReviewTransport } from "./capability-review-journey";
import { seedMemberPages } from "./member-pages-fixture";
import { selectValue } from "../e2e/controls.helpers";

export async function memberPagesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  app?: ElectronApplication,
) {
  const db = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    await seedMemberPages(db, workspaceId);
  } finally {
    await db.end();
  }
  const params = { workspaceId };
  const folder = "docs/verification/member-pages",
    prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  const table = page.getByRole("table", { name: "Members", exact: true });
  const next = page.getByRole("button", { name: "Next page", exact: true });
  const previous = page.getByRole("button", { name: "Previous", exact: true });
  const search = page.getByRole("searchbox", {
    name: "Search members",
    exact: true,
  });
  await expect(table.getByRole("row")).toHaveCount(21);
  await expect(
    page.getByText("20 of 126 members in this workspace", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "121 of 200 seats used", exact: true }),
  ).toBeVisible();
  await expect(previous).toBeDisabled();
  await next.focus();
  await next.press("Enter");
  await expect(table).toContainText("Team 019");
  // Changing tabs resets the cursor and keeps global summaries independent of the page.
  await page.getByRole("tab", { name: "Invitations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No invitations yet", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(table).toContainText("Team 000");
  for (let i = 0; i < 6; i++) {
    await expect(next).toBeEnabled();
    await next.click();
    await expect(table).toContainText(
      `Team ${String((i + 1) * 20 - 1).padStart(3, "0")}`,
    );
  }
  await expect(next).toBeDisabled();
  await expect(table.getByRole("row")).toHaveCount(7);
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-last-page.png` });
  await search.fill("STAFF-124");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(
    page.getByText("1 member matching your search", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Manage Team 124", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Manage Team 124",
    exact: true,
  });
  const beforePage = (
    await send({ operation: "members", params, query: { search: "staff-124" } })
  ).body as MemberPage;
  const before = beforePage.items[0];
  const roles = (await send({ operation: "roles", params })).body as {
    id: string;
    name: string;
  }[];
  const sales = roles.find((r) => r.name === "Sales")!;
  await dialog
    .getByRole("checkbox", { name: "Warehouse", exact: true })
    .check();
  const changed = await send({
    operation: "memberEdit",
    params: { ...params, id: before.id },
    idempotencyKey: crypto.randomUUID(),
    body: {
      revision: before.revision,
      active: true,
      roleIds: [...before.roles.map((r) => r.id), sales.id],
      modules: before.modules,
      directModules: before.directModules,
    },
  });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  await dialog
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Changed member access", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Reload current access", exact: true })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: "Sales", exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Warehouse", exact: true }),
  ).not.toBeChecked();
  await dialog
    .getByRole("checkbox", { name: "Active membership", exact: true })
    .uncheck();
  await dialog
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(table).toContainText("Removed");
  const current = (
    await send({ operation: "member", params: { ...params, id: before.id } })
  ).body as Member;
  expect(current.active).toBe(false);
  expect(current.roles.some((r) => r.id === sales.id)).toBe(true);
  await expect(
    page.getByRole("img", { name: "120 of 200 seats used", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await table
    .getByRole("cell", { name: "Removed", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-search-narrow.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  const viewer = page
    .getByRole("row")
    .filter({ has: page.getByText("Viewer", { exact: true }) });
  await expect(
    viewer.getByRole("cell", { name: "119", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await search.fill("Viewer");
  await expect(
    page.getByText("20 of 125 members matching your search", { exact: true }),
  ).toBeVisible();
  await search.fill("missing-person");
  await expect(
    page.getByRole("heading", { name: "No matching members", exact: true }),
  ).toBeVisible();
  await search.fill("");
  await expect(next).toBeEnabled();
  const path = `/api/v1/workspaces/${workspaceId}/members`;
  if (app)
    await app.evaluate((_, path) => {
      const original = globalThis.fetch;
      (
        globalThis as typeof globalThis & { restoreMemberRead?: () => void }
      ).restoreMemberRead = () => {
        globalThis.fetch = original;
      };
      globalThis.fetch = async (...args) => {
        const url = args[0] instanceof Request ? args[0].url : String(args[0]);
        if (new URL(url).pathname === path && args[1]?.method === "GET")
          throw new Error("Page read unavailable");
        return original(...args);
      };
    }, path);
  else
    await page.route(`**${path}*`, (route) =>
      route.request().method() === "GET"
        ? route.abort("failed")
        : route.continue(),
    );
  try {
    await next.click();
    await expect(
      page.getByText("Members could not be loaded.", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("heading", { name: "No members yet", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("img", {
        name: "Workspace seat usage unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Try again", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/${prefix}-read-failure.png` });
  } finally {
    if (app)
      await app.evaluate(() =>
        (
          globalThis as typeof globalThis & { restoreMemberRead?: () => void }
        ).restoreMemberRead?.(),
      );
    else await page.unroute(`**${path}*`);
  }
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(table).toContainText("Team 019");
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!app)
        .include(".people-page")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await previous.click();
  await expect(table).toContainText("Team 000");
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-first-page.png` });
}
