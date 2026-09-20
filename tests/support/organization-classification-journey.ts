import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function organizationClassificationJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  const params = { workspaceId };
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const initial = (await state()).organization!;
  const { version, ...policy } = initial;
  const sales = policy.ranks.find((rank) => rank.name === "Sales")!;
  const warehouse = policy.ranks.find((rank) => rank.name === "Warehouse")!;
  const id = crypto.randomUUID();
  const emptyId = crypto.randomUUID();
  policy.groups = [
    {
      id,
      name: "Reviewers",
      rankIds: [sales.id],
      grants: [],
      denies: [],
      tags: [],
    },
  ];
  policy.tags = [
    { id, name: "Reviewers", rankIds: [warehouse.id], grants: [], denies: [] },
    { id: emptyId, name: "Unassigned", rankIds: [], grants: [], denies: [] },
  ];
  const saved = await send({
    operation: "platformCommand",
    params,
    body: { action: "organization", value: policy, version },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const before = (await state()).organization!;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const filter = page.getByRole("region", {
    name: "Chart classification filter",
  });
  const input = filter.getByRole("combobox", {
    name: "Highlight group or tag",
  });
  const chart = page.getByRole("group", {
    name: "Organization hierarchy",
    exact: true,
  });
  const matches = chart.locator('[data-classification-match="true"]');
  await expect(chart.getByRole("button")).toHaveCount(policy.ranks.length);
  const choose = async (query: string, option: string) => {
    await input.fill(query);
    await expect(
      page.getByRole("option", { name: option, exact: true }),
    ).toBeVisible();
    await input.press("Enter");
    await expect(input).toHaveAttribute("aria-expanded", "false");
  };
  await choose("group: rev", "Group: Reviewers");
  await expect(matches).toHaveCount(1);
  await expect(
    chart.getByRole("button", { name: "Configure Sales", exact: true }),
  ).toHaveAttribute("data-classification-match", "true");
  await choose("tag: rev", "Tag: Reviewers");
  await expect(matches).toHaveCount(1);
  const warehouseNode = chart.getByRole("button", {
    name: "Configure Warehouse",
    exact: true,
  });
  await expect(warehouseNode).toHaveAttribute(
    "data-classification-match",
    "true",
  );
  await expect(warehouseNode).toHaveAccessibleDescription(
    "Matches the chart classification filter.",
  );
  await expect(
    page.locator('.organization-minimap [data-classification-match="true"]'),
  ).toHaveCount(1);
  await input.fill("No such classification");
  await expect(
    page.getByText("No matching choices", { exact: true }),
  ).toBeVisible();
  await input.press("Escape");
  await expect(matches).toHaveCount(1);
  await filter.getByRole("button", { name: "Clear chart filter" }).click();
  await expect(matches).toHaveCount(0);
  await choose("unassigned", "Tag: Unassigned");
  await expect(filter.getByRole("status")).toContainText(
    `0 of ${policy.ranks.length} roles`,
  );
  await expect(chart.getByRole("button")).toHaveCount(policy.ranks.length);
  expect((await state()).organization).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Save organization", exact: true }),
  ).toBeDisabled();

  await choose("tag: rev", "Tag: Reviewers");
  const tags = page.getByRole("region", { name: "Role tags", exact: true });
  const tagSearch = tags.getByRole("combobox", {
    name: "Role tag",
    exact: true,
  });
  await tagSearch.fill("review");
  await expect(
    page.getByRole("option", { name: "Reviewers", exact: true }),
  ).toBeVisible();
  await tagSearch.press("Enter");
  await expect(tags.getByLabel("Tag name", { exact: true })).toHaveValue(
    "Reviewers",
  );
  await tags.getByRole("checkbox", { name: "Sales", exact: true }).check();
  await expect(filter.getByRole("status")).toContainText(
    `2 of ${policy.ranks.length} roles`,
  );
  await expect(matches).toHaveCount(2);
  expect((await state()).organization).toEqual(before);
  await tags.getByLabel("Tag name", { exact: true }).fill("Field reviewers");
  await expect(filter.getByRole("status")).toContainText(
    "Tag: Field reviewers",
  );
  await page
    .getByRole("button", { name: "Save organization", exact: true })
    .click();
  await expect
    .poll(async () => (await state()).organization!.version)
    .toBe(before.version + 1);
  expect((await state()).organization!.ranks).toEqual(before.ranks);
  await expect(matches).toHaveCount(2);
  const folder = "docs/verification/organization-classification";
  await mkdir(folder, { recursive: true });
  const prefix = native ? "desktop" : "web";
  await filter.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-chart.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill("rev");
  await expect(
    page.getByRole("option", { name: "Tag: Field reviewers", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${folder}/${prefix}-autocomplete-narrow.png`,
  });
  await input.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await tags
    .getByRole("button", { name: "Remove role tag", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect(filter.getByRole("status")).toContainText("All roles shown");
  await expect(matches).toHaveCount(0);
  await expect(
    tags.getByRole("button", { name: "Add role tag", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Save organization", exact: true })
    .click();
  await expect
    .poll(async () => (await state()).organization!.version)
    .toBe(before.version + 2);
  await page.reload();
  await choose("reviewers", "Group: Reviewers");
  await expect(matches).toHaveCount(1);
  expect((await state()).organization!.ranks).toEqual(before.ranks);
}
