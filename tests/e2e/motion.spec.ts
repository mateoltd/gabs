import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";

test.use({ serviceWorkers: "block" });

async function login(page: Page) {
  await page.goto("/");
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", "11111111-1111-4111-8111-111111111111");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}

test("page navigation preserves the shell and query-only changes preserve focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page
    .locator(".topbar")
    .evaluate((node) => node.setAttribute("data-motion-test", "retained"));
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Draft/ }).click();
  await expect(page.getByRole("tab", { name: /^Draft/ })).toBeFocused();
  await expect(page.locator(".topbar")).toHaveAttribute(
    "data-motion-test",
    "retained",
  );
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Inventory", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Roles", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "View permissions" }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("first load shows its heading and a stable placeholder before delayed data", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/workspaces/*/overview", async (route) => {
    await gate;
    await route.continue();
  });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading workspace overview" }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "Overview", exact: true })
    .evaluate((node) =>
      Promise.all(
        node
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  const heading = await page
    .getByRole("heading", { name: "Overview", exact: true })
    .boundingBox();
  release();
  await expect(page.locator(".overview-insights .metric")).toHaveCount(4);
  await expect(page.locator(".content-skeleton")).toHaveCount(0);
  expect(
    (
      await page
        .getByRole("heading", { name: "Overview", exact: true })
        .boundingBox()
    )?.y,
  ).toBe(heading?.y);
});

test("inspector keeps the heading and pagination fixed, and becomes a dialog on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await page
    .getByRole("button", { name: /^Open order / })
    .first()
    .click();
  await expect(page.locator('.detail-panel[data-open="true"]')).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".orders-list")
      .evaluate((node) => node.scrollHeight <= node.clientHeight),
  ).toBe(true);
  await page.getByRole("button", { name: "Close order details" }).click();
  await expect(page.locator(".detail-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await expect(page.locator(".dialog.is-open")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog")).toHaveCount(0);
});

test("pagination retains rows during a slow request and returns to the previous page", async ({
  page,
}) => {
  await login(page);
  let release: () => void = () => {};
  let firstPage: { items: Record<string, unknown>[] } | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/workspaces/*/products?**", async (route) => {
    const next = new URL(route.request().url()).searchParams.has("cursor");
    if (next) await gate;
    if (!next) firstPage = await (await route.fetch()).json();
    const body = firstPage!;
    const item = body.items[0]!;
    await route.fulfill({
      json: {
        ...body,
        items: [
          {
            ...item,
            id: next ? "motion-second" : "motion-first",
            name: next ? "Second page product" : "First page product",
          },
        ],
        nextCursor: next ? null : String(item!.id),
      },
    });
  });
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByText("First page product", { exact: true }),
  ).toBeVisible();
  const table = page.locator("#inventory-results table");
  const before = await table.boundingBox();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator("#inventory-results")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(
    page.getByText("First page product", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  expect(before).not.toBeNull();
  // Rendering may round an unchanged box by a fraction of a CSS pixel.
  expect((await table.boundingBox())!.height).toBeCloseTo(before!.height, 2);
  await expect(
    page.locator("#inventory-results > .results-motion-content"),
  ).toHaveCSS("opacity", "1");
  expect(
    (
      await new AxeBuilder({ page })
        .include("#inventory-results")
        .withRules(["color-contrast"])
        .analyze()
    ).violations,
  ).toEqual([]);
  release();
  await expect(
    page.getByText("Second page product", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#inventory-results")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    page.getByText("First page product", { exact: true }),
  ).toBeVisible();
  // Cached previous pages remain immediately usable.
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
});

test("modal exit remains mounted long enough to fade and restores focus", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Add product",
    exact: true,
  });
  await trigger.click();
  await expect(page.locator(".dialog.is-open")).toBeVisible();
  // Observe the real unmount interval, including minified CSS time units.
  await page.evaluate(() => {
    const dialog = document.querySelector(".dialog")!;
    const start = performance.now();
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected) {
        document.documentElement.dataset.modalExitMs = String(
          performance.now() - start,
        );
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    (
      dialog.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement
    ).click();
  });
  await expect(page.locator(".dialog")).toHaveCount(0);
  const elapsed = await page.locator("html").getAttribute("data-modal-exit-ms");
  expect(Number(elapsed)).toBeGreaterThanOrEqual(120);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.locator(".dialog.is-open")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog-overlay")).toHaveCount(0);
});

test("reduced motion leaves every surface visible and removes animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await page.getByRole("link", { name: "Orders", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Orders", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New order", exact: true }).click();
  await expect(page.locator(".dialog.is-open")).toBeVisible();
  expect(
    await page
      .locator(".dialog")
      .evaluate((node) => getComputedStyle(node).transitionDuration),
  ).toBe("0s");
  expect(
    await page
      .locator(".page-heading h1")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New order", exact: true }),
  ).toBeFocused();
});

test("a late catalog redirect cannot replace navigation from a retained unknown route", async ({
  page,
}) => {
  await login(page);
  let releaseCatalog!: () => void;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route("**/api/v1/workspaces/*/platform", async (route) => {
    await catalogGate;
    await route.continue();
  });
  await page.addInitScript(() => {
    const original = document.startViewTransition.bind(document);
    const gate = new Promise<void>((resolve) => {
      (
        window as unknown as { releaseTransition: () => void }
      ).releaseTransition = resolve;
    });
    document.startViewTransition = (update) =>
      original(async () => {
        await gate;
        if (typeof update === "function") await update();
        else await update?.update?.();
      });
  });
  await page.goto("/not-an-installed-module");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/platform") && r.status() === 200,
  );
  releaseCatalog();
  await response;
  // The retained wildcard route has finished loading; its obsolete redirect renders nothing.
  await expect(page.locator(".route-stage")).toBeEmpty();
  await expect(page).toHaveURL(/\/settings$/);
  await page.evaluate(() =>
    (
      window as unknown as { releaseTransition: () => void }
    ).releaseTransition(),
  );
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/v1/workspaces/*/platform");
  await page.goto("/another-missing-module");
  await expect(page).toHaveURL(/\/overview$/);
  await page.evaluate(() =>
    (
      window as unknown as { releaseTransition: () => void }
    ).releaseTransition(),
  );
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
});
