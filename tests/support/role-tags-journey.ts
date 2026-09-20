import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function roleTagsJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  const state = async () =>
    (await send({ operation: "platformState", params: { workspaceId } }))
      .body as PlatformState;
  const initial = await state();
  const sales = initial.roles.find((role) => role.name === "Sales")!;
  const warehouse = initial.roles.find((role) => role.name === "Warehouse")!;
  const organization = () =>
    page.getByRole("link", { name: "Organization", exact: true }).click();
  const editor = page.getByRole("region", { name: "Role tags", exact: true });
  const save = async () => {
    const previous = (await state()).organization!.version;
    const button = page.getByRole("button", {
      name: "Save organization",
      exact: true,
    });
    await button.click();
    await expect(button).toBeDisabled();
    await expect
      .poll(async () => (await state()).organization!.version)
      .toBe(previous + 1);
  };
  await organization();
  await editor
    .getByRole("button", { name: "Add role tag", exact: true })
    .click();
  await editor.getByLabel("Tag name", { exact: true }).fill("Export reviewers");
  for (const name of ["Sales", "Warehouse"])
    await editor.getByRole("checkbox", { name, exact: true }).check();
  await selectValue(page, "Tag permission", "orders.export");
  await selectValue(page, "Policy for orders.export", "grant");
  // Draft policy cannot alter current server authority before save.
  expect((await state()).organization!.tags ?? []).toEqual([]);
  await save();
  const tag = (await state()).organization!.tags![0];
  expect(tag.rankIds.sort()).toEqual([sales.id, warehouse.id].sort());
  expect((await state()).organization!.ranks).toEqual(
    initial.organization!.ranks,
  );
  await page.reload();
  await selectValue(page, "Role tag", tag.id);
  await expect(
    editor.getByRole("checkbox", { name: "Sales", exact: true }),
  ).toBeChecked();
  await selectValue(page, "Module", "orders");
  const cell = (name: string) =>
    page.locator("td").filter({
      has: page.getByRole("checkbox", {
        name: `${name}: orders.export`,
        exact: true,
      }),
    });
  await expect(cell("Sales")).toContainText("Allowed by Tag: Export reviewers");
  await expect(cell("Warehouse")).toContainText(
    "Allowed by Tag: Export reviewers",
  );
  await editor
    .getByRole("button", { name: "Add role tag", exact: true })
    .click();
  await editor
    .getByLabel("Tag name", { exact: true })
    .fill("Restricted exports");
  await editor.getByRole("checkbox", { name: "Sales", exact: true }).check();
  await selectValue(page, "Tag permission", "orders.export");
  await selectValue(page, "Policy for orders.export", "deny");
  await save();
  await expect(cell("Sales")).toContainText(
    "Denied by Tag: Restricted exports",
  );
  await expect(cell("Warehouse")).toContainText(
    "Allowed by Tag: Export reviewers",
  );
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await page
    .locator(".module-install-card")
    .filter({ has: page.getByRole("heading", { name: "Orders", exact: true }) })
    .getByRole("button", { name: "Review device access", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Orders device access",
    exact: true,
  });
  await selectValue(page, "Review role", sales.id);
  await expect(dialog).toContainText("Denied by Tag: Restricted exports");
  await expect(dialog).toContainText(
    "Overrides grants from Tag: Export reviewers",
  );
  await selectValue(page, "Review role", warehouse.id);
  await expect(dialog).toContainText("Allowed by Tag: Export reviewers");
  await page.keyboard.press("Escape");
  await organization();
  const restricted = (await state()).organization!.tags!.find(
    (tag) => tag.name === "Restricted exports",
  )!;
  await selectValue(page, "Role tag", restricted.id);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[aria-labelledby="role-tags-heading"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const directory = "docs/verification/role-tags";
  await mkdir(directory, { recursive: true });
  const capture = async (narrow: boolean) => {
    const name = `${native ? "desktop" : "web"}${narrow ? "-narrow" : ""}`;
    await editor
      .getByRole("heading", { name: "Role tags", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${directory}/${name}-top.png`,
      animations: "disabled",
    });
    await editor
      .getByRole("button", { name: "Remove role tag", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${directory}/${name}.png`,
      animations: "disabled",
    });
  };
  await capture(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(true);
  await page.setViewportSize({ width: 1360, height: 900 });
  const remove = editor.getByRole("button", {
    name: "Remove role tag",
    exact: true,
  });
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(
    editor.getByRole("button", { name: "Add role tag", exact: true }),
  ).toBeFocused();
  await save();
  await selectValue(page, "Module", "orders");
  await expect(cell("Sales")).toContainText("Allowed by Tag: Export reviewers");
  expect((await state()).organization!.tags!.map((tag) => tag.name)).toEqual([
    "Export reviewers",
  ]);
  await selectValue(page, "Role tag", tag.id);
  await editor
    .getByLabel("Tag name", { exact: true })
    .fill("Finance reviewers");
  await save();
  await page.reload();
  await selectValue(page, "Module", "orders");
  await expect(cell("Sales")).toContainText(
    "Allowed by Tag: Finance reviewers",
  );
}
