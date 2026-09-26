import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { RoleDetails } from "@suite/contracts";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function roleNamesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  app?: ElectronApplication,
) {
  const params = { workspaceId };
  const created = await send({
    operation: "roleCreate",
    params,
    body: { name: "Dispatch operator", permissions: ["orders.read"] },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const role = created.body as RoleDetails;
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const { version, ...policy } = (await state()).organization!;
  expect(
    (
      await send({
        operation: "platformCommand",
        params,
        body: { action: "organization", value: policy, version },
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const chart = page.getByRole("group", {
    name: "Organization hierarchy",
    exact: true,
  });
  const node = chart.locator(`[data-rank-id="${role.id}"]`);
  const open = async () => {
    await node.focus();
    await node.press("Enter");
  };
  const inherit = page.getByRole("checkbox", {
    name: "Inherit parent permissions",
    exact: true,
  });
  const done = page.getByRole("button", { name: "Done", exact: true });
  await open();
  await expect(inherit).not.toBeChecked();
  await inherit.check();
  await done.click();
  expect(
    (
      await send({
        operation: "roleEdit",
        params: { ...params, id: role.id },
        body: {
          name: "Dispatch lead",
          permissions: role.permissions,
          revision: role.revision,
        },
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const save = page.getByRole("button", {
    name: "Save organization",
    exact: true,
  });
  await save.click();
  const conflict = page.getByRole("region", {
    name: "Changed organization",
    exact: true,
  });
  await expect(conflict).toBeVisible();
  await expect(node).toContainText("Dispatch operator");
  await expect(save).toBeDisabled();
  await expect(
    page.getByText(
      "Reload the current organization to preview effective permissions.",
      { exact: true },
    ),
  ).toBeAttached();
  await expect(
    page.getByRole("checkbox", {
      name: /^Dispatch (operator|lead): orders.read$/,
    }),
  ).toBeDisabled();
  await open();
  await expect(inherit).toBeChecked();
  await done.click();
  const folder = "docs/verification/role-names",
    prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await conflict.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-conflict.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!app)
        .include('[aria-label="Changed organization"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  const path = `/api/v1/workspaces/${workspaceId}/platform`;
  if (app)
    await app.evaluate((_, path) => {
      const original = globalThis.fetch;
      (
        globalThis as typeof globalThis & { restoreChartRead?: () => void }
      ).restoreChartRead = () => {
        globalThis.fetch = original;
      };
      globalThis.fetch = async (...args) => {
        const url = args[0] instanceof Request ? args[0].url : String(args[0]);
        if (new URL(url).pathname === path && args[1]?.method === "GET")
          throw new Error("Chart read unavailable");
        return original(...args);
      };
    }, path);
  else
    await page.route(`**${path}`, (route) =>
      route.request().method() === "GET"
        ? route.abort("failed")
        : route.continue(),
    );
  const reload = conflict.getByRole("button", {
    name: "Reload current organization",
    exact: true,
  });
  try {
    await reload.click();
    await expect(reload).toBeEnabled({ timeout: 15000 });
    await expect(
      page.getByText(
        "The organization could not be reloaded. Check your connection and try again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(conflict).toBeVisible();
    await expect(node).toContainText("Dispatch operator");
    await open();
    await expect(inherit).toBeChecked();
    await done.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await conflict.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${folder}/${prefix}-reload-failed-narrow.png`,
    });
  } finally {
    if (app)
      await app.evaluate(() =>
        (
          globalThis as typeof globalThis & { restoreChartRead?: () => void }
        ).restoreChartRead?.(),
      );
    else await page.unroute(`**${path}`);
  }
  await reload.click();
  await expect(conflict).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(node).toContainText("Dispatch lead");
  await expect(save).toBeDisabled();
  await open();
  await expect(inherit).not.toBeChecked();
  await done.click();
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-recovered.png` });

  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Dispatch lead" })
    .getByRole("button", { name: "Edit permissions" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Role: Dispatch lead",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Role name", exact: true })
    .fill("Dispatch coordinator");
  await dialog.getByRole("button", { name: "Save role", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(node).toContainText("Dispatch coordinator");
  await page.getByPlaceholder("Search matrix roles").fill("Dispatch");
  await expect(
    page.getByRole("checkbox", {
      name: "Dispatch coordinator: orders.read",
      exact: true,
    }),
  ).toBeChecked();
  const current = (await state()).organization!;
  expect(current.version).toBe(version + 3);
  expect(current.ranks.find((r) => r.id === role.id)).toEqual({
    ...policy.ranks.find((r) => r.id === role.id),
    name: "Dispatch coordinator",
  });
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-people-renamed.png` });
}
