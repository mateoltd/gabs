import { createHash } from "node:crypto";
import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(resolve("apps/desktop/package.json"));
const launch = (profile: string) =>
  electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
      SUITE_DESKTOP_TEST_MINIMIZED: "1",
    },
  });
async function openSettings(app: Awaited<ReturnType<typeof launch>>) {
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Open local workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Device unlock", exact: true }),
  ).toBeVisible();
  return page;
}
async function hidden(app: Awaited<ReturnType<typeof launch>>) {
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (window) =>
          !window.isFocused() && (!window.isVisible() || window.isMinimized()),
      ),
    ),
  ).toBe(true);
}
test("native device unlock reports protected-storage readiness without enabling a volatile PIN", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "suite-unlock-readiness-"));
  const app = await launch(profile);
  try {
    const page = await openSettings(app);
    const status = await page.evaluate(() =>
      window.suiteDesktop!.profileLockStatus(),
    );
    expect(status.enabled).toBe(false);
    if (!status.available) {
      await expect(
        page.getByRole("button", { name: "Enable device unlock", exact: true }),
      ).toBeDisabled();
      const refused = await page.evaluate(async () => {
        try {
          await window.suiteDesktop!.configureProfileLock("12567890", false);
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      });
      expect(refused).toContain("protected storage");
      expect(
        (await page.evaluate(() => window.suiteDesktop!.profileLockStatus()))
          .enabled,
      ).toBe(false);
    } else
      await expect(
        page.getByRole("button", { name: "Enable device unlock", exact: true }),
      ).toBeEnabled();
    await mkdir("docs/verification/profile-unlock", { recursive: true });
    for (const dismiss of await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .all())
      await dismiss.click();
    await expect(page.locator(".toast:visible")).toHaveCount(0);
    const unlockSettings = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Device unlock", exact: true }),
    });
    await unlockSettings.scrollIntoViewIfNeeded();
    await unlockSettings.screenshot({
      path: "docs/verification/profile-unlock/native-settings.png",
      animations: "disabled",
    });
    await page.screenshot({
      path: "docs/verification/profile-unlock/native-readiness.png",
      animations: "disabled",
    });
    await hidden(app);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("native PIN gates API and cache access, preserves an editor, and survives restart", async () => {
  test.setTimeout(90000);
  // Never trigger a protected-storage prompt on the user's locked desktop.
  const locked =
    process.platform === "darwin" &&
    /CGSSessionScreenIsLocked"?\s*=\s*Yes/.test(
      execFileSync("ioreg", ["-n", "Root", "-d1"], { encoding: "utf8" }),
    );
  test.skip(
    locked,
    "Unlock macOS to run the real protected-storage PIN/restart acceptance.",
  );
  const profile = await mkdtemp(resolve(tmpdir(), "suite-profile-pin-"));
  let app = await launch(profile);
  try {
    let page = await openSettings(app);
    const status = await page.evaluate(() =>
      window.suiteDesktop!.profileLockStatus(),
    );
    test.skip(
      !status.available,
      "Real OS-protected storage is required for PIN acceptance.",
    );
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.suiteDesktop!.identity()))?.userId,
      )
      .toBe(status.userId);
    await page.getByLabel("Device PIN", { exact: true }).fill("12567890");
    await page
      .getByLabel("Confirm device PIN", { exact: true })
      .fill("12567890");
    await page
      .getByRole("button", { name: "Enable device unlock", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Update device unlock", exact: true }),
    ).toBeVisible();
    await page.getByLabel("New device PIN", { exact: true }).fill("87654321");
    await page
      .getByRole("button", { name: "Lock profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Unlock your profile", exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.evaluate(() =>
          window.suiteDesktop!.execute({ operation: "me" }),
        )
      ).status,
    ).toBe(423);
    const denied = await page.evaluate(async (userId) => {
      try {
        await window.suiteDesktop!.cacheRead(
          {
            userId: userId!,
            workspaceId: "00000000-0000-4000-8000-000000000001",
          },
          "snapshot",
        );
        return "unexpected success";
      } catch (error) {
        return String(error);
      }
    }, status.userId);
    expect(denied).toContain("Unlock");
    await page.getByLabel("Device PIN", { exact: true }).fill("00000000");
    await page
      .getByRole("button", { name: "Unlock with PIN", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("incorrect");
    await page.getByLabel("Device PIN", { exact: true }).fill("12567890");
    await page
      .getByRole("button", { name: "Unlock with PIN", exact: true })
      .click();
    await expect(
      page.getByLabel("New device PIN", { exact: true }),
    ).toHaveValue("87654321");
    await hidden(app);
    await app.close();
    app = await launch(profile);
    page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Unlock your profile", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.suiteDesktop!.profileLockStatus()),
    ).toMatchObject({ userId: status.userId, locked: true, enabled: true });
    expect(
      (
        await page.evaluate(() =>
          window.suiteDesktop!.execute({ operation: "me" }),
        )
      ).status,
    ).toBe(423);
    await page.getByLabel("Device PIN", { exact: true }).fill("12567890");
    await page
      .getByRole("button", { name: "Unlock with PIN", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.suiteDesktop!.profileLockStatus()))
      .toMatchObject({ locked: false });
    await hidden(app);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("unreadable native lock policy blocks privileged access and offers real online recovery", async () => {
  const profile = await mkdtemp(resolve(tmpdir(), "suite-unlock-corrupt-"));
  const app = await launch(profile);
  try {
    const page = await openSettings(app);
    const initial = await page.evaluate(() =>
      window.suiteDesktop!.profileLockStatus(),
    );
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          process.env.API_ORIGIN ?? "http://localhost:4310",
          initial.userId,
        ]),
      )
      .digest("hex");
    await mkdir(resolve(profile, "secure-cache"), {
      recursive: true,
      mode: 0o700,
    });
    // Deliberately corrupt only this disposable profile's policy file. The real
    // native storage reader must fail closed; no encryption service is mocked.
    await writeFile(
      resolve(profile, "secure-cache", `profile-lock-${key}.bin`),
      "invalid protected policy",
      { mode: 0o600 },
    );
    await page.evaluate(async () => {
      await window.suiteDesktop!.logout();
      await window.suiteDesktop!.login();
    });
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Lock profile", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Workspace name", { exact: true })
      .fill("Retained unlock input");
    await page
      .getByRole("button", { name: "Lock profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Unlock your profile", exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.evaluate(() =>
          window.suiteDesktop!.execute({ operation: "me" }),
        )
      ).status,
    ).toBe(423);
    const refusal = await page.evaluate(async (userId) => {
      try {
        await window.suiteDesktop!.cacheRead(
          {
            userId: userId!,
            workspaceId: "00000000-0000-4000-8000-000000000001",
          },
          "snapshot",
        );
        return "unexpected success";
      } catch (error) {
        return String(error);
      }
    }, initial.userId);
    expect(refusal).toContain("Unlock");
    await expect(page.locator(".toast-viewport:visible")).toHaveCount(0);
    await mkdir("docs/verification/profile-unlock", { recursive: true });
    await page.screenshot({
      path: "docs/verification/profile-unlock/native-locked.png",
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Sign in online", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Workspace name", { exact: true }),
    ).toHaveValue("Retained unlock input");
    expect(
      await page.evaluate(() => window.suiteDesktop!.profileLockStatus()),
    ).toMatchObject({
      userId: initial.userId,
      locked: false,
      enabled: true,
      canRecover: true,
    });
    // Exercise the production main-process listener without suspending the OS
    // or taking focus. Physical suspend/lock acceptance remains separate.
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
    await expect(
      page.getByRole("heading", { name: "Unlock your profile", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Independent personal work");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Independent personal work",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await page.evaluate(() =>
          window.suiteDesktop!.execute({ operation: "me" }),
        )
      ).status,
    ).toBe(423);
    expect(
      await page.evaluate(() => window.suiteDesktop!.profileLockStatus()),
    ).toMatchObject({ userId: initial.userId, locked: true });
    await hidden(app);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
