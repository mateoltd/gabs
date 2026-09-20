import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { Bootstrap } from "@suite/contracts";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import type { PolicyReleaseFixture } from "./module-policy-release-fixture";
import { selectValue } from "../e2e/controls.helpers";

export async function moduleReleaseRecoveryJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  first: PolicyReleaseFixture,
  second: PolicyReleaseFixture,
  native = false,
) {
  const params = { workspaceId };
  const folder = "docs/verification/module-release-recovery";
  const prefix = native ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  const state = async () => {
    const reply = await send({ operation: "platformState", params });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return reply.body as PlatformState;
  };
  for (const fixture of [first, second]) {
    await fixture.publish("1.0.0", {}, [`${fixture.id}.read`]);
    await fixture.publish("1.1.0", {}, [`${fixture.id}.read`]);
    await fixture.entitle(workspaceId);
    const enabled = await send({
      operation: "moduleEdit",
      params: { ...params, moduleId: fixture.id },
      body: { state: "enabled", accessPolicy: "admin" },
    });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    const pinned = await send({
      operation: "platformCommand",
      params,
      idempotencyKey: crypto.randomUUID(),
      body: {
        action: "rollout",
        version: 0,
        value: {
          moduleId: fixture.id,
          version: "1.0.0",
          mandatory: true,
          acceptedVersions: [],
        },
      },
    });
    expect(pinned.status, JSON.stringify(pinned.body)).toBe(200);
  }
  await state();
  for (const fixture of [first, second]) await fixture.withdraw("1.0.0");
  await first.publish("1.2.0", { [second.id]: "^1.0.0" }, [`${first.id}.read`]);
  expect((await state()).unavailableModules).toHaveLength(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const recovery = page.getByRole("region", {
    name: "Modules needing attention",
    exact: true,
  });
  const card = (fixture: PolicyReleaseFixture) =>
    recovery.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: fixture.name, exact: true }),
    });
  await expect(card(first)).toContainText("Release unavailable");
  await expect(card(second)).toContainText("Release unavailable");
  const recoveryBounds = await recovery.boundingBox();
  const healthyBounds = await page
    .locator(".module-install-card")
    .filter({
      has: page.getByRole("heading", { name: "Contacts", exact: true }),
    })
    .boundingBox();
  expect(recoveryBounds).not.toBeNull();
  expect(healthyBounds).not.toBeNull();
  expect(healthyBounds!.y).toBeGreaterThan(
    recoveryBounds!.y + recoveryBounds!.height,
  );
  await recovery.scrollIntoViewIfNeeded();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[aria-label="Modules needing attention"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: `${folder}/${prefix}-unavailable.png` });
  await card(first)
    .getByRole("link", { name: "Permissions", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Module", exact: true }),
  ).toContainText(first.name);
  const matrix = page.getByRole("region", {
    name: "Permission matrix",
    exact: true,
  });
  const permission = matrix.getByRole("checkbox", {
    name: `Sales: ${first.id}.read`,
    exact: true,
  });
  await expect(permission).not.toBeChecked();
  await permission.press("Space");
  await expect(permission).toBeChecked();
  await expect
    .poll(
      async () =>
        (await state()).roles.find((r) => r.name === "Sales")?.permissions,
    )
    .toContain(`${first.id}.read`);
  await expect(permission.locator("xpath=ancestor::tr")).toContainText(
    "Other releases:",
  );
  await permission.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-permissions.png` });

  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await card(first)
    .getByRole("button", { name: "Configure access", exact: true })
    .click();
  await selectValue(page, "Module state", "suspended");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const bootstrap = (await send({ operation: "bootstrap", params }))
    .body as Bootstrap;
  expect(bootstrap.modules.find((m) => m.moduleId === first.id)?.state).toBe(
    "suspended",
  );
  await card(first)
    .getByRole("button", { name: "Review update policy", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: `Review ${first.name} release`,
    exact: true,
  });
  await expect(
    review.getByRole("combobox", { name: "Pinned release", exact: true }),
  ).toContainText("1.0.0 (unavailable)");
  await selectValue(page, "Pinned release", "1.2.0");
  await review
    .getByRole("button", { name: "Save update policy", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText(
    "No compatible official release set",
  );
  expect(
    (await state()).settings.find((s) => s.key === `pin:${first.id}`)?.value
      .version,
  ).toBe("1.0.0");
  await selectValue(page, "Pinned release", "1.1.0");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: `${folder}/${prefix}-review-narrow.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await review
    .getByRole("button", { name: "Save update policy", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  await expect(card(first)).toHaveCount(0);
  await expect(card(second)).toContainText("Release unavailable");
  expect((await state()).unavailableModules?.map((m) => m.moduleId)).toEqual([
    second.id,
  ]);
  await card(second)
    .getByRole("button", { name: "Review update policy", exact: true })
    .click();
  await selectValue(page, "Pinned release", "1.1.0");
  await page
    .getByRole("button", { name: "Save update policy", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(recovery).toHaveCount(0);
  expect((await state()).unavailableModules).toEqual([]);
  await page.reload();
  await expect(recovery).toHaveCount(0);
  const healthy = page.locator(".module-install-card").filter({
    has: page.getByRole("heading", { name: first.name, exact: true }),
  });
  await expect(healthy).toBeVisible();
  await healthy.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${folder}/${prefix}-repaired.png` });
}
