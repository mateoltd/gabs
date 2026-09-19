import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { selectValue } from "../e2e/controls.helpers";

const require = createRequire(resolve("apps/desktop/package.json"));

test("removed standalone profile restores its encrypted records after a hidden native restart", async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-profile-removal-"));
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
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  const hidden = async () =>
    expect(
      await app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await hidden();
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Native recovery");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await selectValue(page, "Module and resource", "contacts/contacts");
    await page.getByRole("button", { name: "New record", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "Local record",
      exact: true,
    });
    await editor
      .getByLabel("Name", { exact: true })
      .fill("Retained native contact");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "customer");
    await editor
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Retained native contact", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Lock profile", exact: true })
      .click();
    const picker = page.getByRole("combobox", { name: "Profile", exact: true });
    await picker.click();
    await page
      .getByRole("option", { name: "Native recovery", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove profile", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Remove from this device’s profile list",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await hidden();
    await app.close();
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await hidden();
    await page
      .getByRole("button", {
        name: /^(Use a local profile|Open local profiles)$/,
      })
      .click();
    await page
      .getByRole("button", { name: "Removed profiles", exact: true })
      .click();
    const recovery = page.getByRole("dialog", {
      name: "Removed profiles",
      exact: true,
    });
    await expect(
      recovery.getByRole("combobox", { name: "Removed profile", exact: true }),
    ).toContainText("Native recovery");
    await recovery
      .getByLabel("Original passphrase", { exact: true })
      .fill("correct horse battery staple");
    await recovery
      .getByRole("button", { name: "Restore and unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Native recovery", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Module and resource", exact: true }),
    ).toContainText("Contacts: Contacts");
    await expect(
      page.getByRole("cell", { name: "Retained native contact", exact: true }),
    ).toHaveCount(1);
    await mkdir("docs/verification/profile-removal", { recursive: true });
    await page.screenshot({
      path: "docs/verification/profile-removal/native-restored.png",
      animations: "disabled",
    });
    await hidden();
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
