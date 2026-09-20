import "dotenv/config";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { PlatformState } from "@suite/module-sdk/platform";
import { layoutOrganization } from "@suite/module-sdk/governance";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function organizationScaleJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  page.setDefaultTimeout(15000);
  const params = { workspaceId };
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const initial = await state();
  // Seed a realistically populated company; all subsequent policy edits use the public API/UI.
  const added = Array.from(
    { length: 500 - initial.roles.length },
    (_, index) => ({
      id: crypto.randomUUID(),
      name: `Scale role ${String(index + 1).padStart(3, "0")}`,
    }),
  );
  const db = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try {
    await db.query(
      "insert into suite.roles(id, workspace_id, name, permissions, protected) select id, $1, name, '{}', false from jsonb_to_recordset($2::jsonb) as r(id uuid, name text)",
      [workspaceId, JSON.stringify(added)],
    );
  } finally {
    await db.end();
  }
  const full = await state();
  const { version, ...original } = full.organization!;
  const target = added.at(-1)!;
  const peer = added.at(-2)!;
  const groups = Array.from({ length: 100 }, (_, index) => ({
    id: crypto.randomUUID(),
    name: `Scale group ${String(index + 1).padStart(3, "0")}`,
    rankIds:
      index === 99
        ? [target.id]
        : added.slice(index * 5, index * 5 + 5).map((role) => role.id),
    tags: [],
    grants: index === 99 ? ["orders.export"] : [],
    denies: [],
  }));
  const tags = groups.map((group, index) => ({
    id: crypto.randomUUID(),
    name: `Scale tag ${String(index + 1).padStart(3, "0")}`,
    rankIds: group.rankIds,
    grants: [],
    denies: index === 99 ? ["orders.export"] : [],
  }));
  const policy = layoutOrganization({ ...original, groups, tags });
  expect(policy.ranks).toHaveLength(500);
  const admitted = await send({
    operation: "platformCommand",
    params,
    idempotencyKey: crypto.randomUUID(),
    body: { action: "organization", version, value: policy },
  });
  expect(admitted.status, JSON.stringify(admitted.body)).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const matrix = page.locator(".permission-section");
  await expect(matrix.locator("thead th")).toHaveCount(9);
  await matrix.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(matrix.getByRole("status")).toHaveText("Roles 9–16 of 500");
  await matrix
    .getByRole("searchbox", { name: "Search matrix roles", exact: true })
    .fill(target.name);
  await expect(matrix.locator("thead th")).toHaveCount(2);
  const permission = page.getByRole("checkbox", {
    name: `${target.name}: orders.export`,
    exact: true,
  });
  await expect(matrix.locator("td").filter({ has: permission })).toContainText(
    "Denied by Tag: Scale tag 100",
  );
  const choose = async (trigger: Locator, name: string) => {
    await trigger.click();
    await page
      .getByRole("combobox", { name: "Search choices", exact: true })
      .fill(name);
    await page.getByRole("option", { name, exact: true }).click();
  };
  const graph = page.getByRole("group", {
    name: "Organization hierarchy",
    exact: true,
  });
  const node = graph.getByRole("button", {
    name: `Configure ${target.name}`,
    exact: true,
  });
  await choose(
    page.getByRole("combobox", { name: "Find role in chart", exact: true }),
    target.name,
  );
  await expect(node).toBeFocused();
  expect(
    await node.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("none");
  expect(
    await node.evaluate((element) => {
      const box = element.getBoundingClientRect(),
        canvas = element.closest("svg")!.getBoundingClientRect();
      return (
        box.left >= canvas.left &&
        box.right <= canvas.right &&
        box.top >= canvas.top &&
        box.bottom <= canvas.bottom
      );
    }),
  ).toBe(true);
  const cameraBefore = await graph.getAttribute("viewBox");
  await graph.focus();
  await graph.press("ArrowLeft");
  await expect(graph).not.toHaveAttribute("viewBox", cameraBefore!);
  const beforePan = await graph.getAttribute("viewBox");
  const graphBox = (await graph.boundingBox())!;
  await page.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(graphBox.x + graphBox.width / 2 + 40, graphBox.y + 20, {
    steps: 3,
  });
  await page.mouse.up();
  await expect(graph).not.toHaveAttribute("viewBox", beforePan!);
  await node.focus();
  await node.press("Enter");
  const dialog = page.getByRole("dialog", { name: target.name, exact: true });
  await dialog
    .getByRole("searchbox", { name: "Search parent roles", exact: true })
    .fill(peer.name);
  await dialog.getByRole("checkbox", { name: peer.name, exact: true }).check();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  // Drag a distant role using actual pointer coordinates in the panned viewport.
  const beforeDrag = await node.getAttribute("transform");
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect(node).not.toHaveAttribute("transform", beforeDrag!);
  await expect(dialog).toBeHidden();
  const tagEditor = page.getByRole("region", {
    name: "Role tags",
    exact: true,
  });
  await choose(
    tagEditor.getByRole("combobox", { name: "Role tag", exact: true }),
    "Scale tag 100",
  );
  await tagEditor
    .getByRole("searchbox", { name: "Search tag roles", exact: true })
    .fill(target.name);
  await expect(
    tagEditor.getByRole("checkbox", { name: target.name, exact: true }),
  ).toBeChecked();
  await selectValue(page, "Tag permission", "orders.export");
  await tagEditor
    .getByRole("combobox", { name: "Policy for orders.export", exact: true })
    .click();
  await page
    .getByRole("option")
    .and(page.locator('[data-value="none"]'))
    .click();
  const groupEditor = page.getByRole("region", { name: "Groups", exact: true });
  await choose(
    groupEditor.getByRole("combobox", { name: "Group", exact: true }),
    "Scale group 100",
  );
  await expect(
    groupEditor
      .getByRole("group", { name: "Grouped roles", exact: true })
      .getByRole("checkbox"),
  ).toHaveCount(20);
  await groupEditor
    .getByRole("searchbox", { name: "Search group roles", exact: true })
    .fill(peer.name);
  await groupEditor
    .getByRole("checkbox", { name: peer.name, exact: true })
    .check();
  const save = async () => {
    const version = (await state()).organization!.version;
    await page
      .getByRole("button", { name: "Save organization", exact: true })
      .click();
    await expect
      .poll(async () => (await state()).organization!.version)
      .toBe(version + 1);
  };
  await save();
  const saved = (await state()).organization!;
  expect(saved.groups.slice(0, 99)).toEqual(groups.slice(0, 99));
  expect(saved.tags!.slice(0, 99)).toEqual(tags.slice(0, 99));
  expect(saved.ranks.filter((role) => role.id !== target.id)).toEqual(
    policy.ranks.filter((role) => role.id !== target.id),
  );
  expect(saved.ranks.find((role) => role.id === target.id)!.parents).toEqual([
    policy.rootId,
    peer.id,
  ]);
  expect(saved.groups[99].rankIds).toEqual([target.id, peer.id]);
  expect(saved.tags![99].denies).toEqual([]);
  await expect(matrix.locator("td").filter({ has: permission })).toContainText(
    "Allowed by Scale group 100",
  );
  await permission.click();
  await expect(permission).toBeChecked();
  await expect
    .poll(
      async () =>
        (await state()).roles.find((role) => role.id === target.id)!
          .permissions,
    )
    .toContain("orders.export");
  await page.reload();
  await expect(graph.getByRole("button")).toHaveCount(500);
  await choose(
    page.getByRole("combobox", { name: "Find role in chart", exact: true }),
    target.name,
  );
  const folder = "docs/verification/organization-scale",
    prefix = native ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await graph.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-chart.png` });
  const overview = page.getByRole("img", {
    name: "Organization overview",
    exact: true,
  });
  const beforeOverview = await graph.getAttribute("viewBox");
  await overview.click();
  await expect(graph).not.toHaveAttribute("viewBox", beforeOverview!);
  await page.getByRole("button", { name: "Fit chart", exact: true }).click();
  expect(await graph.getAttribute("viewBox")).toContain("0 0");

  expect(
    (await overview.getAttribute("viewBox"))!.split(" ").map(Number)[2],
  ).toBeGreaterThan(1000);
  await matrix
    .getByRole("searchbox", { name: "Search matrix roles", exact: true })
    .fill(target.name);
  await selectValue(page, "Module", "orders");
  await matrix.evaluate((element) =>
    element.scrollIntoView({ block: "start" }),
  );
  await permission.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-matrix.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include(".permission-section")
        .include(".organization-canvas")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await permission.scrollIntoViewIfNeeded();
  expect(
    await matrix
      .locator(".permission-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-matrix-narrow.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await page
    .locator(".module-install-card")
    .filter({ has: page.getByRole("heading", { name: "Orders", exact: true }) })
    .getByRole("button", { name: "Review device access", exact: true })
    .click();
  await selectValue(page, "Review role", target.id);
  await expect(
    page.getByRole("dialog", { name: "Orders device access", exact: true }),
  ).toContainText("Scale group 100");
}
