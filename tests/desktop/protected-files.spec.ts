import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { controlledNativeProtection } from "../support/native-protection";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

for (const method of ["passphrase", "pin", "biometric"] as const) {
  test(`desktop ${method} unlock retains work after controlled provider-key renewal and retirement`, async () => {
    test.skip(
      method === "biometric" && process.platform !== "darwin",
      "Native biometric UI currently targets Touch ID.",
    );
    test.setTimeout(60000);
    const profile = await mkdtemp(resolve(tmpdir(), "suite-key-renewal-"));
    const original = randomBytes(32).toString("hex"),
      replacement = randomBytes(32).toString("hex");
    const launch = async (key: string, previousKey?: string) => {
      const app = await electron.launch({
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
      try {
        await app.firstWindow();
        await controlledNativeProtection(
          app,
          key,
          previousKey,
          method !== "passphrase",
        );
        return app;
      } catch (error) {
        await app.close();
        throw error;
      }
    };
    let app = await launch(original);
    try {
      let page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      await page
        .getByLabel("Profile name", { exact: true })
        .fill("Renewed protection");
      await page
        .getByLabel("Passphrase", { exact: true })
        .fill("retained original passphrase");
      await page
        .getByRole("button", { name: "Create profile", exact: true })
        .click();
      await page
        .getByRole("button", { name: "New record", exact: true })
        .click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Work survives key renewal");
      await selectValue(page, "Kind", "person");
      await selectValue(page, "Relationship", "other");
      await page
        .getByRole("button", { name: "Save locally", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Work survives key renewal",
          exact: true,
        }),
      ).toBeVisible();
      const [local] = await page.evaluate(() =>
        window.suiteDesktop!.localVaults.request(crypto.randomUUID(), "list", {
          removed: false,
        }),
      );
      if (method !== "passphrase") {
        await page
          .getByRole("button", { name: "Profile unlock", exact: true })
          .click();
        await page
          .getByLabel("Current passphrase", { exact: true })
          .fill("retained original passphrase");
        await page.getByLabel("New PIN", { exact: true }).fill("12345678");
        await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
        if (process.platform === "darwin")
          await page.getByRole("checkbox", { name: "Allow Touch ID" }).check();
        await page
          .getByRole("button", { name: "Save and lock", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Local profiles", exact: true }),
        ).toBeVisible();
      }
      const keyPath = resolve(profile, "secure-cache/cache-secret.bin");
      const before = await readFile(keyPath);
      await app.close();
      for (const previous of [original, undefined]) {
        app = await launch(replacement, previous);
        page = await app.firstWindow();
        await page
          .getByRole("button", { name: "Use a local profile", exact: true })
          .click();
        await selectValue(page, "Profile", local.id);
        const unlock = async (selected: typeof method) => {
          if (selected === "biometric") {
            await page
              .getByRole("button", { name: "Use Touch ID", exact: true })
              .click();
          } else {
            if (selected === "pin")
              await page
                .getByRole("button", { name: "Use PIN instead", exact: true })
                .click();
            await page
              .getByLabel(selected === "pin" ? "Profile PIN" : "Passphrase", {
                exact: true,
              })
              .fill(
                selected === "pin"
                  ? "12345678"
                  : "retained original passphrase",
              );
            await page
              .getByRole("button", { name: "Unlock profile", exact: true })
              .click();
          }
        };
        await unlock(method);
        await expect(
          page.getByRole("cell", {
            name: "Work survives key renewal",
            exact: true,
          }),
        ).toBeVisible();
        if (
          previous === undefined &&
          method !== "passphrase" &&
          process.platform === "darwin"
        ) {
          await page
            .getByRole("button", { name: "Lock profile", exact: true })
            .click();
          await selectValue(page, "Profile", local.id);
          await unlock(method === "pin" ? "biometric" : "pin");
          await expect(
            page.getByRole("cell", {
              name: "Work survives key renewal",
              exact: true,
            }),
          ).toBeVisible();
        }
        expect(await readFile(keyPath)).not.toEqual(before);
        expect(
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every(
              (window) =>
                !window.isFocused() &&
                (!window.isVisible() || window.isMinimized()),
            ),
          ),
        ).toBe(true);
        await app.close();
      }
    } finally {
      await app.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
  });
}
