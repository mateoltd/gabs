import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/desktop/package.json"));

test("reconciled screens render in native Electron and retain working controls", async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(resolve(tmpdir(), "common-ui-review-"));
  const output = resolve("docs/verification/ui-reconciliation/after");
  await mkdir(output, { recursive: true });
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
    },
  });
  try {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(
      page.getByRole("button", { name: "Open local workspace", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.login-artwork[data-ready="true"]'),
    ).toBeVisible();
    await page.screenshot({ path: `${output}/electron-signin.png` });
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(390, 844),
    );
    await expect(
      page.getByRole("heading", { name: "Local profiles", exact: true }),
    ).toBeVisible();
    expect(
      (await page.locator(".local-profile-header").boundingBox())!.y,
    ).toBeGreaterThanOrEqual(68);
    const profileSurfaces = await page.evaluate(() => ({
      canvas: getComputedStyle(document.body).backgroundColor,
      field: getComputedStyle(
        document.querySelector(".local-profile-form .input")!,
      ).backgroundColor,
      card: getComputedStyle(document.querySelector(".local-profile-form")!)
        .backgroundColor,
    }));
    expect(profileSurfaces.canvas).not.toBe("rgba(0, 0, 0, 0)");
    expect(profileSurfaces.field).not.toBe(profileSurfaces.card);
    await page.screenshot({
      path: `${output}/electron-local-profile-narrow.png`,
    });
    await page
      .getByRole("button", { name: "Online workspaces", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 960),
    );
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Orders", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Northline Supply", exact: true })
      .click();
    const headings: Record<string, string> = {
      overview: "Overview",
      orders: "Orders",
      inventory: "Inventory",
      modules: "Modules",
      organization: "Organization and permissions",
      people: "People & access",
      notifications: "Notifications",
      settings: "Settings",
    };
    for (const route of [
      "overview",
      "orders",
      "inventory",
      "modules",
      "organization",
      "people",
      "notifications",
      "settings",
    ]) {
      await page.evaluate((route) => {
        location.hash = `#/${route}`;
      }, route);
      await expect(
        page.getByRole("heading", {
          name: headings[route],
          level: 1,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".content-skeleton")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute(
        "data-archetype",
        "modern-dark",
      );
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${output}/electron-${route}.png` });
      expect(
        await page
          .locator("main")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    // Exercise the same actual generated UI with an isolated, authorized workspace.
    const id = randomUUID();
    const result = await page.evaluate(
      (id) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: { id, name: "Native UI review", currency: "EUR" },
        }),
      id,
    );
    expect(result.status).toBe(200);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${id}"]`))
      .click();
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "New record",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Native review contact");
    await page.getByRole("combobox", { name: "Kind", exact: true }).click();
    await page.getByRole("option", { name: "Person", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Relationship", exact: true })
      .click();
    await page.getByRole("option", { name: "Customer", exact: true }).click();
    await page.screenshot({ path: `${output}/electron-contact-dialog.png` });
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "Native review contact", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `${output}/electron-contacts.png` });
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("tablist", { name: "Projects resources" }),
    ).toBeVisible();
    await page.screenshot({ path: `${output}/electron-projects.png` });
    await page.evaluate(() => {
      location.hash = "#/settings";
    });
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: "Light", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: `${output}/electron-settings-light.png` });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
