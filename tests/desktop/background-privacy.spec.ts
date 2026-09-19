import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/desktop/package.json"));

test("the hidden native renderer covers background input and restores it without focusing the desktop", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "suite-background-privacy-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
      SUITE_DESKTOP_TEST_MINIMIZED: "1",
    },
  });
  const hidden = async () =>
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  try {
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await hidden();
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Unsubmitted private profile");
    // Deliver the renderer lifecycle signal without bringing an OS window to
    // the foreground. Actual OS focus/occlusion acceptance remains separate.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator("html[data-background-privacy]")).toHaveCount(1);
    expect(await page.evaluate(() => document.body.inert)).toBe(true);
    await expect(
      page.getByRole("textbox", { name: "Profile name", exact: true }),
    ).toHaveCount(0);
    await mkdir("docs/verification/background-privacy", { recursive: true });
    await page.screenshot({
      path: "docs/verification/background-privacy/native-covered.png",
      animations: "disabled",
    });
    await hidden();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByLabel("Profile name", { exact: true })).toHaveValue(
      "Unsubmitted private profile",
    );
    await expect(
      page.getByLabel("Profile name", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.body.inert)).toBe(false);
    await hidden();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
