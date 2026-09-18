import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { OperationRequest } from "../../packages/contracts/src";
import type { PlatformState } from "@suite/module-sdk/platform";
import { selectValue } from "../e2e/controls.helpers";
export type ReviewTransport = (
  request: OperationRequest,
) => Promise<{ status: number; body: unknown }>;
export async function createReviewWorkspace(send: ReviewTransport) {
  const workspaceId = randomUUID();
  const created = await send({
    operation: "workspaceCreate",
    body: {
      id: workspaceId,
      name: "Capability policy review",
      currency: "EUR",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  return workspaceId;
}
export async function capabilityReviewJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  const state = (
    await send({ operation: "platformState", params: { workspaceId } })
  ).body as PlatformState;
  const sales = state.roles.find((role) => role.name === "Sales")!;
  const open = async () => {
    await page.getByRole("link", { name: "Modules", exact: true }).click();
    await page
      .locator(".module-install-card")
      .filter({
        has: page.getByRole("heading", { name: "Orders", exact: true }),
      })
      .getByRole("button", { name: "Review device access", exact: true })
      .click();
    await expect(
      page.getByText("Verified release 2.1.0.", { exact: false }),
    ).toBeVisible();
  };
  const dialog = page.getByRole("dialog", {
    name: "Orders device access",
    exact: true,
  });
  await open();
  await selectValue(page, "Review role", sales.id);
  await expect(
    dialog.getByText("No permission granted", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Online authorization required.", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("link", { name: "Manage permissions", exact: true })
    .click();
  const checkbox = page.getByRole("checkbox", {
    name: "Sales: orders.export",
    exact: true,
  });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.locator("td").filter({ has: checkbox })).toContainText(
    "Allowed by Sales",
  );
  await open();
  await selectValue(page, "Review role", sales.id);
  await expect(
    dialog.getByText("Allowed by Sales", { exact: true }),
  ).toBeVisible();
  const { version, ...policy } = state.organization!;
  const saved = await send({
    operation: "platformCommand",
    params: { workspaceId },
    idempotencyKey: randomUUID(),
    body: {
      action: "organization",
      version,
      value: {
        ...policy,
        groups: [
          {
            id: randomUUID(),
            name: "Restricted exports",
            rankIds: [sales.id],
            tags: [],
            grants: [],
            denies: ["orders.export"],
          },
        ],
      },
    },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  await dialog
    .getByRole("button", { name: "Refresh review", exact: true })
    .click();
  await expect(
    dialog.getByText("Denied by Restricted exports", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Overrides grants from Sales", { exact: true }),
  ).toBeVisible();
  await selectValue(page, "Review release", "2.0.0");
  await expect(
    dialog.getByRole("heading", {
      name: "No device capabilities declared",
      exact: true,
    }),
  ).toBeVisible();
  await selectValue(page, "Review release", "2.1.0");
  await expect(
    dialog.getByText("Denied by Restricted exports", { exact: true }),
  ).toBeVisible();
  const axe = new AxeBuilder({ page }).include('[role="dialog"]');
  if (native) axe.setLegacyMode();
  expect((await axe.analyze()).violations).toEqual([]);
  await mkdir("docs/verification/capability-review", { recursive: true });
  await page.screenshot({
    path: `docs/verification/capability-review/${native ? "native" : "wide"}.png`,
  });
  if (!native) {
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: "docs/verification/capability-review/narrow.png",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await dialog
    .getByRole("link", { name: "Manage permissions", exact: true })
    .click();
  await expect(checkbox).toBeChecked();
  await expect(page.locator("td").filter({ has: checkbox })).toContainText(
    "Denied by Restricted exports",
  );
  await expect(page.locator("td").filter({ has: checkbox })).toContainText(
    "Overrides grants from Sales",
  );
  await checkbox.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/capability-review/matrix-${native ? "native" : "web"}.png`,
  });
  await open();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .locator(".module-install-card")
      .filter({
        has: page.getByRole("heading", { name: "Orders", exact: true }),
      })
      .getByRole("button", { name: "Review device access", exact: true }),
  ).toBeFocused();
}
