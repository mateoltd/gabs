import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { localDeviceJourney } from "../support/local-device-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
test("hidden native device consent and revocation survive encrypted profile unlock", async () => {
  test.setTimeout(150000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-device-consent-"));
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
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    await localDeviceJourney(page, true);
    await mkdir("docs/verification/local-device-consent", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/local-device-consent/native.png",
      animations: "disabled",
    });
    await hidden();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
