import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

/** Exercise the same saved work outside its module, then return to its real editor. */
export async function hostReviewRecovery(options: {
  page: Page;
  kind: "web" | "native";
  scope: { userId: string; workspaceId: string };
  moduleId: string;
  moduleName: string;
  scenario: string;
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  reconnect(page: Page): Promise<Page>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
  inspect(dialog: Locator): Promise<void>;
}) {
  let page = options.page;
  const { scope, moduleId, moduleName } = options;
  const state = () => options.storage(page, scope);
  const before = await state();
  const retained = (stored: ModuleStorage) => ({
    journal: stored.journal,
    drafts: stored.drafts,
    targets: stored.draftTargets,
    reviews: stored.draftReviews,
    versions: stored.draftVersions,
  });
  const navigate = (name: string) =>
    page
      .getByRole("navigation", {
        name: name === "Settings" ? "Preferences" : "Main navigation",
        exact: true,
      })
      .getByRole("link", { name, exact: true })
      .click();
  const modules = () => navigate("Modules");
  const card = () =>
    page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: moduleName, exact: true }),
    });
  await modules();
  // The official Projects module depends on Contacts; respect the lifecycle guard.
  if (moduleId === "contacts" && before.installed.projects) {
    const projects = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: "Projects", exact: true }),
    });
    await projects
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect(projects).toContainText("Not installed on this device");
  }
  await card().getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(card()).toContainText("Not installed on this device");
  expect((await state()).installed[moduleId]).toBeUndefined();
  await navigate("Settings");
  await options.offline(true);
  page = await options.restartOffline();
  await navigate("Settings");
  const module = page.getByRole("region", {
    name: `${moduleName} saved work`,
    exact: true,
  });
  const launcher = module.getByRole("button", {
    name: /^Saved records and drafts/,
  });
  await launcher.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Records and drafts",
    exact: true,
  });
  await expect(dialog).toHaveClass(/is-open/);
  // Expose the stored values without resuming or dispatching an editor.
  for (const summary of await dialog
    .locator("li > details.module-saved-change > summary")
    .all())
    await summary.click();
  for (const summary of await dialog
    .getByText("View saved comparison", { exact: true })
    .all()) {
    await summary.click();
    for (const nested of await summary
      .locator("..")
      .locator("details.resource-value > summary")
      .all())
      await nested.click();
  }
  for (const summary of await dialog
    .getByText("View original draft before record reassignment", {
      exact: true,
    })
    .all()) {
    await summary.click();
    await summary
      .locator("..")
      .getByText("View saved draft", { exact: true })
      .click();
  }
  await options.inspect(dialog);
  for (const button of await dialog
    .getByRole("button", { name: "Resolve record outcome", exact: true })
    .all())
    await expect(button).toBeDisabled();
  expect(retained(await state())).toEqual(retained(before));
  expect((await state()).installed[moduleId]).toBeUndefined();
  const review = dialog
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: /saved review$/ }) })
    .first();
  const showReview = () =>
    review.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await showReview();
  await mkdir("docs/verification/host-review-recovery", { recursive: true });
  await page.screenshot({
    path: `docs/verification/host-review-recovery/${options.kind}-${options.scenario}.png`,
  });
  await options.narrow();
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(390);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await showReview();
  await page.screenshot({
    path: `docs/verification/host-review-recovery/${options.kind}-${options.scenario}-narrow.png`,
  });
  const localChoice = dialog.getByText("local", { exact: true });
  if (await localChoice.count()) {
    await localChoice.first().scrollIntoViewIfNeeded();
    await expect(localChoice.first()).toBeInViewport();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.screenshot({
      path: `docs/verification/host-review-recovery/${options.kind}-${options.scenario}-comparison.png`,
    });
  }
  await options.wide();
  await page.keyboard.press("Escape");
  await options.offline(false);
  page = await options.reconnect(page);
  await selectValue(page, "Workspace", scope.workspaceId);
  await modules();
  await card().getByRole("button", { name: "Install", exact: true }).click();
  await expect(card()).toContainText(
    `Installed ${before.installed[moduleId].version}`,
  );
  expect(retained(await state())).toEqual(retained(before));
  if (moduleId === "contacts" && before.installed.projects) {
    const projects = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name: "Projects", exact: true }),
    });
    await projects
      .getByRole("button", { name: "Install", exact: true })
      .click();
    await expect(projects).toContainText(
      `Installed ${before.installed.projects.version}`,
    );
  }
  return page;
}
