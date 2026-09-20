import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { RoleDetails } from "@suite/contracts";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";
import { dropAcceptedReply } from "./drop-reply";

export async function roleEditsJourney(
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
  const original = created.body as RoleDetails;
  const read = async () =>
    ((await send({ operation: "roles", params })).body as RoleDetails[]).find(
      (r) => r.id === original.id,
    )!;
  const edit = async (name: string, permissions: string[]) => {
    const role = await read();
    const result = await send({
      operation: "roleEdit",
      params: { ...params, id: role.id },
      body: { name, permissions, revision: role.revision },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  };
  const audits = async () =>
    (
      (await send({ operation: "audit", params })).body as {
        items: { action: string }[];
      }
    ).items.filter((row) => row.action === "roles.saved").length;
  const baseline = await audits();
  const folder = "docs/verification/role-edits",
    prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Dispatch operator" })
    .getByRole("button", { name: "Edit permissions" })
    .click();
  const dialog = page.getByRole("dialog", { name: /^Role: Dispatch/ });
  const nameInput = dialog.getByRole("textbox", {
    name: "Role name",
    exact: true,
  });
  const stock = dialog.getByRole("checkbox", {
    name: "View stock and movements",
    exact: true,
  });
  const save = dialog.getByRole("button", { name: "Save role", exact: true });
  await nameInput.fill("Dispatch coordinator");
  await edit("Dispatch operator", ["orders.read", "inventory.read"]);
  await save.click();
  const conflict = dialog.getByRole("region", {
    name: "Changed role permissions",
    exact: true,
  });
  await expect(conflict).toBeVisible();
  await expect(nameInput).toHaveValue("Dispatch coordinator");
  await expect(stock).not.toBeChecked();
  await expect(save).toBeDisabled();
  expect(await audits()).toBe(baseline + 1);
  await conflict.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-people-conflict.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!app)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await conflict
    .getByRole("button", { name: "Reload current permissions" })
    .click();
  await expect(conflict).toHaveCount(0);
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveValue("Dispatch operator");
  await expect(stock).toBeChecked();
  await nameInput.fill("Dispatch coordinator");
  const path = `/api/v1/workspaces/${workspaceId}/roles/${original.id}`;
  const lost = await dropAcceptedReply(page, path, "PUT", app);
  try {
    await save.click();
    await expect
      .poll(async () => (await read()).name)
      .toBe("Dispatch coordinator");
    await expect(save).toBeEnabled();
    await expect(
      dialog.getByText(
        "The role update could not be confirmed. Retry without changing your choices to check its saved result.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await save.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${folder}/${prefix}-people-retry-narrow.png`,
    });
    await save.click();
    await expect(dialog).toBeHidden();
    const keys = await lost.keys();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe("");
    expect(keys[1]).toBe(keys[0]);
    expect(await audits()).toBe(baseline + 2);
  } finally {
    await lost.close();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByPlaceholder("Search matrix roles").fill("Dispatch");
  const matrix = page.getByRole("region", {
    name: "Permission matrix",
    exact: true,
  });
  const orders = matrix.getByRole("checkbox", {
    name: /^Dispatch (coordinator|lead): orders.read$/,
  });
  await expect(orders).toBeChecked();
  await expect(
    matrix.getByRole("checkbox", {
      name: "Dispatch coordinator: workspace.manage",
      exact: true,
    }),
  ).toBeDisabled();
  await edit("Dispatch lead", ["orders.read", "inventory.read"]);
  await orders.click();
  const review = page.getByRole("region", {
    name: "Permission change review",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("This role changed.");
  await expect(orders).toBeChecked();
  expect(await audits()).toBe(baseline + 3);
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-matrix-conflict.png` });
  await review
    .getByRole("button", { name: "Reload current roles", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect(matrix).toBeFocused();
  const inventory = matrix.getByRole("checkbox", {
    name: "Dispatch lead: inventory.read",
    exact: true,
  });
  await expect(inventory).toBeChecked();
  const lostMatrix = await dropAcceptedReply(page, path, "PUT", app);
  try {
    await inventory.click();
    await expect
      .poll(async () => (await read()).permissions)
      .toEqual(["orders.read"]);
    await expect(review).toBeVisible();
    await expect(inventory).toBeDisabled();
    await review
      .getByRole("button", { name: "Retry permission change", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await expect(inventory).not.toBeChecked();
    const keys = await lostMatrix.keys();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe("");
    expect(keys[1]).toBe(keys[0]);
    expect(await audits()).toBe(baseline + 4);
  } finally {
    await lostMatrix.close();
  }
  await page.reload();
  await page.getByPlaceholder("Search matrix roles").fill("Dispatch");
  await expect(inventory).not.toBeChecked();
  await expect(
    matrix.getByRole("checkbox", {
      name: "Dispatch lead: orders.read",
      exact: true,
    }),
  ).toBeChecked();
  await inventory.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-matrix-accepted.png` });
}
