import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function groupAdministrationJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  const state = async () =>
    (await send({ operation: "platformState", params: { workspaceId } }))
      .body as PlatformState;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  const initial = (await state()).organization!;
  const sales = initial.ranks.find((rank) => rank.name === "Sales")!;
  const warehouse = initial.ranks.find((rank) => rank.name === "Warehouse")!;
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const editor = page.getByRole("region", { name: "Groups", exact: true });
  const add = editor.getByRole("button", { name: "Add group", exact: true });
  const save = async () => {
    const version = (await state()).organization!.version;
    await page
      .getByRole("button", { name: "Save organization", exact: true })
      .click();
    await expect
      .poll(async () => (await state()).organization!.version)
      .toBe(version + 1);
  };
  const choose = async (name: string) => {
    await editor.getByRole("combobox", { name: "Group", exact: true }).click();
    const search = page.getByRole("combobox", {
      name: "Search choices",
      exact: true,
    });
    await search.fill(name);
    await page.getByRole("option", { name, exact: true }).click();
  };
  await add.click();
  await expect(editor.getByLabel("Group name", { exact: true })).toHaveValue(
    "New group",
  );
  await add.click();
  await expect(editor.getByLabel("Group name", { exact: true })).toHaveValue(
    "New group 2",
  );
  await choose("New group");
  await editor
    .getByLabel("Group name", { exact: true })
    .fill("Export reviewers");
  await editor
    .getByLabel("Group labels (comma separated)", { exact: true })
    .fill("Finance, Field team");
  for (const name of ["Sales", "Warehouse"])
    await editor.getByRole("checkbox", { name, exact: true }).check();
  await selectValue(page, "Group permission", "orders.export");
  await selectValue(page, "Policy for orders.export", "grant");
  expect((await state()).organization).toEqual(initial);
  await choose("New group 2");
  await editor
    .getByLabel("Group name", { exact: true })
    .fill("Restricted exports");
  await editor.getByRole("checkbox", { name: "Sales", exact: true }).check();
  await selectValue(page, "Group permission", "orders.export");
  await selectValue(page, "Policy for orders.export", "deny");
  await save();
  const saved = (await state()).organization!;
  expect(saved.ranks).toEqual(initial.ranks);
  expect(saved.groups).toEqual([
    expect.objectContaining({
      name: "Export reviewers",
      tags: ["Finance", "Field team"],
      rankIds: [sales.id, warehouse.id],
      grants: ["orders.export"],
      denies: [],
    }),
    expect.objectContaining({
      name: "Restricted exports",
      rankIds: [sales.id],
      grants: [],
      denies: ["orders.export"],
    }),
  ]);
  await page.reload();
  await choose("Restricted exports");
  await selectValue(page, "Module", "orders");
  const cell = (name: string) =>
    page.locator("td").filter({
      has: page.getByRole("checkbox", {
        name: `${name}: orders.export`,
        exact: true,
      }),
    });
  await expect(cell("Sales")).toContainText("Denied by Restricted exports");
  await expect(cell("Sales")).toContainText(
    "Overrides grants from Export reviewers",
  );
  await expect(cell("Warehouse")).toContainText("Allowed by Export reviewers");
  await editor
    .getByRole("checkbox", { name: "Administrador", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Save organization", exact: true })
    .click();
  await expect(
    page.getByText("The root cannot receive group denials.", { exact: true }),
  ).toBeVisible();
  expect((await state()).organization).toEqual(saved);
  await expect(
    editor.getByRole("checkbox", { name: "Administrador", exact: true }),
  ).toBeChecked();
  await editor
    .getByRole("checkbox", { name: "Administrador", exact: true })
    .uncheck();
  await selectValue(page, "Group permission", "orders.export");
  await selectValue(page, "Policy for orders.export", "none");
  await expect(cell("Sales")).toContainText("Allowed by Export reviewers");
  expect((await state()).organization).toEqual(saved);
  await selectValue(page, "Policy for orders.export", "deny");
  await editor
    .getByLabel("Group name", { exact: true })
    .fill("Confidential exports");
  await save();
  const folder = "docs/verification/group-administration";
  const prefix = native ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  const capture = async (narrow: boolean) => {
    await editor.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    await page.screenshot({
      path: `${folder}/${prefix}${narrow ? "-narrow" : ""}-top.png`,
    });
    await editor
      .getByRole("button", { name: "Remove group", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${folder}/${prefix}${narrow ? "-narrow" : ""}.png`,
    });
  };
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[aria-labelledby="groups-heading"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await capture(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const remove = editor.getByRole("button", {
    name: "Remove group",
    exact: true,
  });
  await remove.focus();
  await remove.press("Enter");
  await expect(add).toBeFocused();
  await expect(editor.getByLabel("Group name", { exact: true })).toHaveCount(0);
  expect((await state()).organization!.groups).toHaveLength(2);
  await save();
  await page.reload();
  await expect(editor.getByLabel("Group name", { exact: true })).toHaveValue(
    "Export reviewers",
  );
  await expect(
    editor.getByLabel("Group labels (comma separated)", { exact: true }),
  ).toHaveValue("Finance, Field team");
  await expect(cell("Sales")).toContainText("Allowed by Export reviewers");
  expect((await state()).organization!.ranks).toEqual(initial.ranks);
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await page
    .locator(".module-install-card")
    .filter({ has: page.getByRole("heading", { name: "Orders", exact: true }) })
    .getByRole("button", { name: "Review device access", exact: true })
    .click();
  await selectValue(page, "Review role", sales.id);
  await expect(
    page.getByRole("dialog", { name: "Orders device access", exact: true }),
  ).toContainText("Allowed by Export reviewers");
  await page.keyboard.press("Escape");
  const current = (await state()).organization!;
  const { version, ...policy } = current;
  const groups = Array.from({ length: 100 }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Team ${String(index + 1).padStart(3, "0")}`,
    rankIds: [sales.id],
    tags: [],
    grants: [],
    denies: [],
  }));
  const admitted = await send({
    operation: "platformCommand",
    params: { workspaceId },
    body: { action: "organization", version, value: { ...policy, groups } },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(admitted.status, JSON.stringify(admitted.body)).toBe(200);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.reload();
  await choose("Team 100");
  await expect(editor.getByLabel("Group name", { exact: true })).toHaveCount(1);
  await editor
    .getByLabel("Group name", { exact: true })
    .fill("Final review team");
  await selectValue(page, "Group permission", "orders.export");
  await selectValue(page, "Policy for orders.export", "grant");
  await save();
  const final = (await state()).organization!;
  expect(final.groups).toHaveLength(100);
  expect(final.groups.slice(0, 99)).toEqual(groups.slice(0, 99));
  expect(final.groups[99]).toEqual({
    ...groups[99],
    name: "Final review team",
    grants: ["orders.export"],
  });
  expect(final.ranks).toEqual(initial.ranks);
  await page.reload();
  await choose("Final review team");
  await expect(editor).toContainText("Allow orders.export");
}
