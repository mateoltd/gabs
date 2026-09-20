import { expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Static, MemberSchema } from "@suite/contracts";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import type { PolicyReleaseFixture } from "./module-policy-release-fixture";
import { selectValue } from "../e2e/controls.helpers";

export async function modulePolicyReleasesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  releases: PolicyReleaseFixture,
  native = false,
) {
  const params = { workspaceId };
  await releases.publish("1.0.0", { inventory: "^2.0.0" });
  await releases.entitle(workspaceId);
  const configured = await send({
    operation: "moduleEdit",
    params: { ...params, moduleId: releases.id },
    body: { state: "enabled", accessPolicy: "admin" },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(configured.status, JSON.stringify(configured.body)).toBe(200);
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const members = async () =>
    (await send({ operation: "members", params })).body as Static<
      typeof MemberSchema
    >[];
  const initial = await state(),
    self = (await members())[0],
    sales = initial.roles.find((r) => r.name === "Sales")!;
  const edited = await send({
    operation: "memberEdit",
    params: { ...params, id: self.id },
    body: {
      active: true,
      roleIds: [...self.roles.map((r) => r.id), sales.id],
      modules: ["contacts"],
      directModules: ["contacts"],
    },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(edited.status, JSON.stringify(edited.body)).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const editor = page.getByRole("region", { name: "Role tags", exact: true });
  await editor
    .getByRole("button", { name: "Add role tag", exact: true })
    .click();
  await editor.getByLabel("Tag name", { exact: true }).fill("Release staff");
  await editor.getByRole("checkbox", { name: "Sales", exact: true }).check();
  await editor
    .getByRole("checkbox", { name: releases.name, exact: true })
    .check();
  await page
    .getByRole("button", { name: "Save organization", exact: true })
    .click();
  await expect
    .poll(async () => (await members())[0].modules.slice().sort())
    .toEqual(["contacts", "inventory", releases.id].sort());
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: `Manage ${self.name}`,
      exact: true,
    }),
  });
  await expect(row).toContainText("Inventory");
  await releases.publish("1.1.0", { contacts: "^1.0.0" });
  // Reads immediately filter obsolete access; the client adopts the new policy
  // through its existing delivery loop, whose idle interval is 15 seconds.
  await expect
    .poll(async () => (await members())[0].modules.slice().sort(), {
      timeout: 25000,
    })
    .toEqual(["contacts", releases.id].sort());
  await expect(row).not.toContainText("Inventory", { timeout: 25000 });
  await expect(row).toContainText(releases.name);
  await row
    .getByRole("button", { name: `Manage ${self.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Manage ${self.name}`,
    exact: true,
  });
  await expect(
    dialog.getByRole("region", { name: "Role module policies" }),
  ).toContainText(`${releases.name}: Assigned. Tag: Release staff`);
  await expect(
    dialog
      .getByRole("group", { name: "Direct module assignments", exact: true })
      .getByRole("checkbox", { name: "Contacts", exact: true }),
  ).toBeChecked();
  const folder = "docs/verification/module-policy-releases",
    prefix = native ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/${prefix}-sources.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page.locator(".module-install-card").filter({
    has: page.getByRole("heading", { name: releases.name, exact: true }),
  });
  const update = async (version: string) => {
    await card.getByRole("button", { name: "Configure", exact: true }).click();
    await page
      .getByLabel("Pinned version (empty follows current release)", {
        exact: true,
      })
      .fill(version);
    await page
      .getByRole("button", { name: "Save update policy", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await state()).settings.find((s) => s.key === `pin:${releases.id}`)
            ?.value.version,
      )
      .toBe(version);
    await page.keyboard.press("Escape");
  };
  await update("1.0.0");
  expect((await members())[0].modules.slice().sort()).toEqual(
    ["contacts", "inventory", releases.id].sort(),
  );
  await releases.publish("1.2.0", {});
  await page.reload();
  expect((await members())[0].modules.slice().sort()).toEqual(
    ["contacts", "inventory", releases.id].sort(),
  );
  await update("");
  await expect
    .poll(async () => (await members())[0].modules.slice().sort())
    .toEqual(["contacts", releases.id].sort());
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await row
    .getByRole("button", { name: `Manage ${self.name}`, exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Role module policies" }),
  ).not.toContainText("Inventory");
  await expect(
    dialog.getByRole("region", { name: "Role module policies" }),
  ).not.toContainText("Contacts");
  await expect(
    dialog
      .getByRole("group", { name: "Direct module assignments", exact: true })
      .getByRole("checkbox", { name: "Contacts", exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog
    .getByRole("region", { name: "Role module policies" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-sources-narrow.png` });
}
