import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/desktop/package.json"));

test("shared lists render and retain read-only controls in Electron", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "common-list-review-"));
  const output = resolve("docs/verification/people-inventory");
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
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "Northline Supply", exact: true })
      .click();
    for (const [route, heading] of [
      ["people", "People & access"],
      ["inventory", "Inventory"],
      ["audit", "Audit history"],
      ["orders", "Orders"],
    ]) {
      await page.evaluate((route) => {
        location.hash = `#/${route}`;
      }, route);
      await expect(
        page.getByRole("heading", { name: heading, level: 1, exact: true }),
      ).toBeVisible();
      await expect(page.locator("tbody td").first()).toBeVisible();
      expect(await page.locator("table:not(.list-table)").count()).toBe(0);
      expect(
        await page
          .locator("tbody td")
          .evaluateAll((cells) =>
            cells.every(
              (cell) => getComputedStyle(cell).borderBottomWidth === "0px",
            ),
          ),
      ).toBe(true);
      expect(
        await page
          .locator("main")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: `${output}/electron-${route}.png` });
      if (route === "people") {
        await page.getByPlaceholder("Search members").fill("Jamie");
        await expect(page.locator("tbody tr")).toHaveCount(1);
        await page
          .getByRole("button", { name: "Manage Jamie Chen", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Manage Jamie Chen" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
      if (route === "inventory") {
        await page
          .getByRole("tab", { name: "Movement history", exact: true })
          .click();
        await expect(
          page.getByRole("table", { name: "Stock movements" }),
        ).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
