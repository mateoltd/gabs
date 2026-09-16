import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";

async function reviewWorkspace(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const id = randomUUID();
  const response = await page.request.post("/api/v1/workspaces", {
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: { id, name: "UI reconciliation", currency: "EUR" },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await selectValue(page, "Workspace", id);
  return id;
}

test("unconfigured workspaces preserve the established geometry and explicit choices stay scoped", async ({
  page,
}) => {
  const id = await reviewWorkspace(page);
  // An old visit to Settings cached the unchosen executive default. It must not restyle the app.
  await page.evaluate(
    (id) => localStorage.setItem(`suite-archetype:${id}`, "executive-serious"),
    id,
  );
  await page.goto("/modules");
  await expect(page.locator("html")).toHaveAttribute(
    "data-archetype",
    "modern-dark",
  );
  const configure = page
    .getByRole("button", { name: "Configure", exact: true })
    .first();
  await expect(configure).toHaveCSS("border-radius", "999px");
  await expect(page.locator(".module-install-card").first()).toHaveCSS(
    "box-shadow",
    "none",
  );
  expect(
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link")
      .evaluateAll((links) =>
        links.slice(0, 3).map((link) => link.getAttribute("href")),
      ),
  ).toEqual(["/overview", "/orders", "/inventory"]);
  await expect(
    page
      .getByRole("navigation", { name: "Administration" })
      .getByRole("link", { name: "Organization", exact: true }),
  ).toBeVisible();
  const icons = await page
    .locator(
      '.sidebar nav a[href="/orders"] svg, .sidebar nav a[href="/inventory"] svg, .sidebar nav a[href="/contacts"] svg, .sidebar nav a[href="/projects"] svg',
    )
    .evaluateAll((nodes) => nodes.map((node) => node.innerHTML));
  expect(icons).toHaveLength(4);
  expect(new Set(icons).size).toBe(4);
  await page.goto("/settings");
  await selectValue(page, "Design archetype", "editorial-paper");
  await expect(page.locator("html")).toHaveAttribute(
    "data-archetype",
    "editorial-paper",
  );
  await selectValue(page, "Workspace", "11111111-1111-4111-8111-111111111111");
  await expect(page.locator("html")).toHaveAttribute(
    "data-archetype",
    "modern-dark",
  );
  await selectValue(page, "Workspace", id);
  await expect(page.locator("html")).toHaveAttribute(
    "data-archetype",
    "editorial-paper",
  );
});

test("generated module controls support keyboard navigation and readable narrow dialogs", async ({
  page,
}) => {
  await reviewWorkspace(page);
  await page.goto("/projects");
  const tabs = page.getByRole("tablist", { name: "Projects resources" });
  await tabs.getByRole("tab", { name: "Projects", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "Time entries" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(
    tabs.getByRole("tab", { name: "Projects", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto("/contacts");
  await page.setViewportSize({ width: 390, height: 844 });
  const create = page.getByRole("button", {
    name: "New contacts",
    exact: true,
  });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "New record", exact: true });
  await expect(dialog).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Design review contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  const fields = await dialog.locator(".field").evaluateAll((nodes) =>
    nodes.map((el) => ({
      top: el.getBoundingClientRect().top,
      bottom: el.getBoundingClientRect().bottom,
    })),
  );
  for (let i = 1; i < fields.length; i++)
    expect(fields[i].top - fields[i - 1].bottom).toBeGreaterThanOrEqual(12);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
  await expect(
    page.getByRole("cell", { name: "Design review contact", exact: true }),
  ).toBeVisible();
});

for (const theme of ["dark", "light", "high-contrast"]) {
  test(`reconciled pages fit desktop and phone layouts in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await reviewWorkspace(page);
    await page.goto("/settings");
    await selectValue(page, "Theme", theme);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      for (const route of [
        "contacts",
        "projects",
        "modules",
        "organization",
        "people",
        "settings",
        "notifications",
      ]) {
        await page.goto(`/${route}`);
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("main .loading")).toHaveCount(0);
        await expect
          .poll(() =>
            page
              .locator("main")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          )
          .toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    for (const route of ["modules", "organization", "settings", "contacts"]) {
      await page.goto(`/${route}`);
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
    }
  });
}
