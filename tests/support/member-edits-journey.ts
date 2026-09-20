import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { MemberSchema, Static } from "@suite/contracts";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";
import { dropAcceptedReply } from "./drop-reply";

export async function memberEditsJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  app?: ElectronApplication,
) {
  const params = { workspaceId };
  const members = async () =>
    (await send({ operation: "members", params })).body as Static<
      typeof MemberSchema
    >[];
  const before = (await members())[0];
  const read = async () =>
    (await members()).find((member) => member.id === before.id)!;
  const state = (await send({ operation: "platformState", params }))
    .body as PlatformState;
  const sales = state.roles.find((role) => role.name === "Sales")!;
  const warehouse = state.roles.find((role) => role.name === "Warehouse")!;
  const audits = async () =>
    (
      (await send({ operation: "audit", params })).body as {
        items: { action: string }[];
      }
    ).items.filter((row) => row.action === "members.updated").length;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  const manage = page.getByRole("button", {
    name: `Manage ${before.name}`,
    exact: true,
  });
  await manage.click();
  const dialog = page.getByRole("dialog", {
    name: `Manage ${before.name}`,
    exact: true,
  });
  const salesChoice = dialog.getByRole("checkbox", {
    name: "Sales",
    exact: true,
  });
  const warehouseChoice = dialog.getByRole("checkbox", {
    name: "Warehouse",
    exact: true,
  });
  const save = dialog.getByRole("button", { name: "Save access", exact: true });
  await salesChoice.check();
  const changed = await send({
    operation: "memberEdit",
    params: { ...params, id: before.id },
    body: {
      revision: before.revision,
      active: true,
      roleIds: [...before.roles.map((role) => role.id), warehouse.id],
      modules: before.modules,
      directModules: before.directModules,
    },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);
  const concurrent = await read();
  await save.click();
  const conflict = dialog.getByRole("region", {
    name: "Changed member access",
    exact: true,
  });
  await expect(conflict).toBeVisible();
  await expect(salesChoice).toBeChecked();
  await expect(warehouseChoice).not.toBeChecked();
  await expect(save).toBeDisabled();
  expect(await read()).toEqual(concurrent);
  expect(await audits()).toBe(1);
  const folder = "docs/verification/member-edits";
  const prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await conflict.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-conflict.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!app)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await conflict.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-conflict-narrow.png` });
  await conflict
    .getByRole("button", { name: "Reload current access", exact: true })
    .click();
  await expect(conflict).toHaveCount(0);
  await expect(dialog.getByRole("checkbox").first()).toBeFocused();
  await expect(salesChoice).not.toBeChecked();
  await expect(warehouseChoice).toBeChecked();
  await salesChoice.check();
  await save.click();
  await expect(dialog).toBeHidden();
  expect((await read()).roles.map((role) => role.id).sort()).toEqual(
    [...before.roles.map((role) => role.id), sales.id, warehouse.id].sort(),
  );
  expect(await audits()).toBe(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await manage.click();
  await warehouseChoice.uncheck();
  const lost = await dropAcceptedReply(
    page,
    `/api/v1/workspaces/${workspaceId}/members/${before.id}`,
    "PATCH",
    app,
  );
  try {
    await save.click();
    await expect
      .poll(async () =>
        (await read()).roles.some((role) => role.id === warehouse.id),
      )
      .toBe(false);
    await expect(save).toBeEnabled();
    await expect(dialog).toBeVisible();
    expect(await audits()).toBe(3);
    await save.click();
    await expect(dialog).toBeHidden();
    const keys = await lost.keys();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe("");
    expect(keys[1]).toBe(keys[0]);
    expect(await audits()).toBe(3);
  } finally {
    await lost.close();
  }
  await page.reload();
  await manage.click();
  await expect(salesChoice).toBeChecked();
  await expect(warehouseChoice).not.toBeChecked();
  await dialog
    .getByRole("checkbox", { name: "Active membership", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-accepted.png` });
}
