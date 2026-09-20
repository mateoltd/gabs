import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { MemberSchema, Static } from "@suite/contracts";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";

export async function modulePoliciesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  native = false,
) {
  const params = { workspaceId };
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const members = async () =>
    (await send({ operation: "members", params })).body as Static<
      typeof MemberSchema
    >[];
  const initial = await state(),
    self = (await members())[0];
  const sales = initial.roles.find((r) => r.name === "Sales")!;
  const setup = await send({
    operation: "memberEdit",
    params: { ...params, id: self.id },
    body: {
      revision: self.revision,
      active: true,
      roleIds: [...self.roles.map((r) => r.id), sales.id],
      modules: [],
      directModules: [],
    },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  const organization = () =>
    page.getByRole("link", { name: "Organization", exact: true }).click();
  const editor = page.getByRole("region", { name: "Role tags", exact: true });
  const save = async () => {
    const version = (await state()).organization!.version;
    await page
      .getByRole("button", { name: "Save organization", exact: true })
      .click();
    await expect
      .poll(async () => (await state()).organization!.version)
      .toBe(version + 1);
  };
  await organization();
  await editor
    .getByRole("button", { name: "Add role tag", exact: true })
    .click();
  await editor.getByLabel("Tag name", { exact: true }).fill("Project staff");
  await editor.getByRole("checkbox", { name: "Sales", exact: true }).check();
  await editor.getByRole("checkbox", { name: "Projects", exact: true }).check();
  expect((await members())[0].modules).toEqual([]);
  await save();
  await expect
    .poll(async () => (await members())[0].modules.slice().sort())
    .toEqual(["contacts", "projects"]);
  expect((await members())[0].directModules).toEqual([]);
  const tag = (await state()).organization!.tags![0];
  await page.reload();
  await selectValue(page, "Role tag", tag.id);
  await expect(
    editor.getByRole("checkbox", { name: "Projects", exact: true }),
  ).toBeChecked();
  const folder = "docs/verification/module-policies";
  await mkdir(folder, { recursive: true });
  const prefix = native ? "desktop" : "web";
  await editor
    .getByRole("group", { name: "Assigned modules", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-policy.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[aria-labelledby="role-tags-heading"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const wide =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await page.setViewportSize({ width: 390, height: 844 });
  await editor
    .getByRole("group", { name: "Assigned modules", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-policy-narrow.png` });
  if (wide) await page.setViewportSize(wide);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  const manage = async () =>
    page
      .getByRole("button", { name: `Manage ${self.name}`, exact: true })
      .click();
  await manage();
  const dialog = page.getByRole("dialog", {
    name: `Manage ${self.name}`,
    exact: true,
  });
  await expect(
    dialog.getByRole("region", { name: "Role module policies" }),
  ).toContainText("Projects: Assigned. Tag: Project staff");
  const direct = dialog.getByRole("group", {
    name: "Direct module assignments",
    exact: true,
  });
  await expect(
    direct.getByRole("checkbox", { name: "Contacts", exact: true }),
  ).not.toBeChecked();
  await dialog
    .getByRole("region", { name: "Role module policies" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-member.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await direct.getByRole("checkbox", { name: "Contacts", exact: true }).check();
  await dialog
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect((await members())[0].directModules).toEqual(["contacts"]);
  // Removing the role withdraws its policy sources, preserving the direct grant.
  await manage();
  await dialog
    .getByRole("group", { name: "Roles", exact: true })
    .getByRole("checkbox", { name: "Sales", exact: true })
    .uncheck();
  await dialog
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect((await members())[0].modules).toEqual(["contacts"]);
  await manage();
  await dialog
    .getByRole("group", { name: "Roles", exact: true })
    .getByRole("checkbox", { name: "Sales", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect((await members())[0].modules.slice().sort()).toEqual([
    "contacts",
    "projects",
  ]);
  await organization();
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Contacts staff");
  const group = page.getByRole("group", {
    name: "Contacts staff",
    exact: true,
  });
  await group.getByRole("checkbox", { name: "Sales", exact: true }).check();
  await group.getByRole("checkbox", { name: "Contacts", exact: true }).check();
  await save();
  await group
    .getByRole("group", { name: "Assigned modules", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-group.png` });
  await selectValue(page, "Role tag", tag.id);
  await editor
    .getByRole("button", { name: "Remove role tag", exact: true })
    .click();
  await save();
  expect((await members())[0].modules).toEqual(["contacts"]);
  expect((await members())[0].modulePolicies).toEqual([
    {
      moduleId: "contacts",
      sources: ["Group: Contacts staff"],
      assigned: true,
    },
  ]);
  await group
    .getByRole("button", { name: "Remove group", exact: true })
    .click();
  await save();
  expect((await members())[0].modules).toEqual(["contacts"]);
  expect((await members())[0].modulePolicies).toEqual([]);
  expect((await state()).organization!.ranks).toEqual(
    initial.organization!.ranks,
  );
}
