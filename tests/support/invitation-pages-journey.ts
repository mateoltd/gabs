import "dotenv/config";
import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import type { InvitationPage } from "@suite/contracts";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function invitationPagesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  app?: ElectronApplication,
) {
  const params = { workspaceId };
  const db = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    await db.query(
      `insert into suite.invitations(id,workspace_id,email,role_id,invited_by,created_at,expires_at)
      select gen_random_uuid(), $1, 'staff-' || lpad(g::text,3,'0') || '@test.local',
        (select id from suite.roles where workspace_id=$1 and name='Viewer'),
        (select user_id from suite.memberships where workspace_id=$1 limit 1),
        now() - (g+1)*interval '1 minute',
        now() + case when g<5 then interval '-1 day' else interval '7 days' end
      from generate_series(0,124) g`,
      [workspaceId],
    );
  } finally {
    await db.end();
  }
  const read = async () =>
    (await send({ operation: "invitations", params })).body as InvitationPage;
  const folder = "docs/verification/invitation-pages",
    prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Invitations", exact: true }).click();
  const table = page.getByRole("table", { name: "Invitations", exact: true });
  const next = page.getByRole("button", { name: "Next page", exact: true });
  const previous = page.getByRole("button", { name: "Previous", exact: true });
  const search = page.getByRole("searchbox", {
    name: "Search invitations",
    exact: true,
  });
  await expect(table.getByRole("row")).toHaveCount(21);
  await expect(
    page.getByRole("button", { name: "View invitations", exact: true }),
  ).toHaveText("120");
  await expect(
    page.getByText("20 of 125 invitations in this workspace", { exact: true }),
  ).toBeVisible();
  await expect(table).toContainText("staff-000@test.local");
  await expect(table).not.toContainText("staff-124@test.local");
  await expect(previous).toBeDisabled();
  await next.focus();
  await next.press("Enter");
  await expect(table).toContainText("staff-020@test.local");
  await previous.click();
  await expect(table).toContainText("staff-000@test.local");
  for (let i = 0; i < 6; i++) {
    await expect(next).toBeEnabled();
    await next.click();
    await expect(table).toContainText(
      `staff-${String((i + 1) * 20).padStart(3, "0")}@test.local`,
    );
  }
  await expect(next).toBeDisabled();
  await expect(table.getByRole("row")).toHaveCount(6);
  await expect(table).toContainText("staff-124@test.local");
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-last-page.png` });
  await search.fill("STAFF-124");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(
    page.getByText("1 invitation matching your search", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View invitations", exact: true }),
  ).toHaveText("120");
  await page
    .getByRole("button", {
      name: "Revoke invitation for staff-124@test.local",
      exact: true,
    })
    .click();
  await expect(table).toContainText("Revoked");
  await expect(
    page.getByRole("button", { name: "View invitations", exact: true }),
  ).toHaveText("119");
  await page.setViewportSize({ width: 390, height: 844 });
  await table
    .getByRole("cell", { name: "Revoked", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-search-narrow.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await search.fill("missing-person");
  await expect(
    page.getByRole("heading", { name: "No matching invitations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0 invitations matching your search", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite a member", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Invite a teammate",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("new-person@test.local");
  await dialog
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(search).toHaveValue("");
  await expect(table.getByRole("row").nth(1)).toContainText(
    "new-person@test.local",
  );
  expect((await read()).workspaceTotal).toBe(126);
  expect((await read()).pendingTotal).toBe(120);
  // A failed page read must be recoverable, never presented as an empty workspace.
  const path = `/api/v1/workspaces/${workspaceId}/invitations`;
  if (app)
    await app.evaluate((_, path) => {
      const original = globalThis.fetch;
      (
        globalThis as typeof globalThis & { restoreInvitationRead?: () => void }
      ).restoreInvitationRead = () => {
        globalThis.fetch = original;
      };
      globalThis.fetch = async (...args) => {
        if (
          new URL(String(args[0])).pathname === path &&
          args[1]?.method === "GET"
        )
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
      page.getByText("Invitations could not be loaded.", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("heading", { name: "No invitations yet", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Try again", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/${prefix}-read-failure.png` });
  } finally {
    if (app)
      await app.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            restoreInvitationRead?: () => void;
          }
        ).restoreInvitationRead?.(),
      );
    else await page.unroute(`**${path}*`);
  }
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(table).toContainText("staff-019@test.local");
  await expect(previous).toBeEnabled();
  await expect(
    page.getByText("Invitations could not be loaded.", { exact: true }),
  ).toHaveCount(0);
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
  await expect(table.getByRole("row").nth(1)).toContainText(
    "new-person@test.local",
  );
  await next.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-first-page.png` });
}
