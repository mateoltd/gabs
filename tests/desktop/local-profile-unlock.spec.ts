import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/desktop/package.json"));

test("standalone vault refuses unavailable protection and exposes no raw key methods", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "suite-local-unlock-"));
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
  try {
    const page = await app.firstWindow();
    expect(
      await page.evaluate(() => "localUnlock" in window.suiteDesktop!),
    ).toBe(false);
    const rejected = await page.evaluate(async () => {
      try {
        await window.suiteDesktop!.localVaults.request(
          crypto.randomUUID(),
          "unlock",
          { id: "invalid", password: "test" },
        );
        return false;
      } catch {
        return true;
      }
    });
    expect(rejected).toBe(true);
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => false;
    });
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Native PIN settings");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Protected storage is unavailable",
    );
    await expect(
      page.getByRole("heading", { name: "Local profiles", exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

// Opt in only in an acceptance session where OS-protected storage is already unlocked.
// No biometric prompt is exercised by this automated journey.
test("protected standalone PIN unlock survives a native restart and retains the passphrase fallback", async () => {
  test.skip(
    process.env.SUITE_ACCEPT_PROTECTED_STORAGE !== "1",
    "Requires an explicitly prepared OS-protected-storage acceptance session.",
  );
  const profile = await mkdtemp(resolve(tmpdir(), "suite-local-pin-restart-"));
  const launch = () =>
    electron.launch({
      executablePath: require("electron"),
      args: [
        resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    test.skip(
      !(await page.evaluate(() => window.suiteDesktop!.securityStatus()))
        .persistentStorage,
      "OS-protected storage is unavailable.",
    );
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Native PIN restart");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Profile unlock", exact: true })
      .click();
    await page
      .getByLabel("Current passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page.getByLabel("New PIN", { exact: true }).fill("12567890");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("12567890");
    await page
      .getByRole("button", { name: "Save and lock", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Local profiles", exact: true }),
    ).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", {
        name: /^(Use a local profile|Open local profiles)$/,
      })
      .click();
    await page.getByRole("combobox", { name: "Profile", exact: true }).click();
    await page
      .getByRole("option", { name: "Native PIN restart", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use PIN instead", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("12567890");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Native PIN restart", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Lock profile", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Native PIN restart", exact: true }),
    ).toBeVisible();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
