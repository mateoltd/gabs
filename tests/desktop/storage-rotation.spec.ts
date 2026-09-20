import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { controlledNativeProtection } from "../support/native-protection";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

for (const interruption of ["none", "prepared", "activated"] as const) {
  test(`database rotation preserves native standalone work after ${interruption} interruption`, async () => {
    test.setTimeout(90000);
    const profile = await mkdtemp(resolve(tmpdir(), "suite-native-rotation-"));
    const providerKey = randomBytes(32).toString("hex");
    const launch = async (rotate = false) => {
      const app = await electron.launch({
        executablePath: require("electron"),
        args: [
          resolve("apps/desktop/dist/main.cjs"),
          `--user-data-dir=${profile}`,
          ...(rotate ? ["--rotate-storage-key"] : []),
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
        await controlledNativeProtection(app, providerKey);
        return app;
      } catch (error) {
        await app.close();
        throw error;
      }
    };
    let app = await launch();
    try {
      let page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      await page
        .getByLabel("Profile name", { exact: true })
        .fill("Rotated profile");
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
        .fill("Work survives database rotation");
      await selectValue(page, "Kind", "person");
      await selectValue(page, "Relationship", "other");
      await page
        .getByRole("button", { name: "Save locally", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Work survives database rotation",
          exact: true,
        }),
      ).toBeVisible();
      const [local] = await page.evaluate(() =>
        window.suiteDesktop!.localVaults.request(crypto.randomUUID(), "list", {
          removed: false,
        }),
      );
      const keyFile = resolve(profile, "secure-cache/cache-secret.bin");
      const before = await readFile(keyFile);
      await app.close();
      app = await launch(true);
      if (interruption !== "none") {
        // Hold an actual key publication, then kill the real main process. No production fault hooks.
        await app.evaluate(({ safeStorage }, checkpoint) => {
          const encrypt = safeStorage.encryptStringAsync.bind(safeStorage);
          safeStorage.encryptStringAsync = async (text) => {
            const value = JSON.parse(text);
            const activation =
              value?.version === 2 && value.rotation?.phase === "activated";
            const retirement =
              value?.version === 2 &&
              value.initialized &&
              !value.rotation &&
              value.active.generation !== "legacy";
            if (
              (checkpoint === "prepared" && activation) ||
              (checkpoint === "activated" && retirement)
            ) {
              Object.assign(globalThis, { rotationCheckpoint: checkpoint });
              return new Promise<Buffer>(() => {});
            }
            return encrypt(text);
          };
        }, interruption);
      }
      page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      if (interruption !== "none") {
        await expect
          .poll(() =>
            app.evaluate(() => Reflect.get(globalThis, "rotationCheckpoint")),
          )
          .toBe(interruption);
        const process = app.process();
        const exited = once(process, "exit");
        process.kill("SIGKILL");
        await exited;
        app = await launch();
        page = await app.firstWindow();
        await page
          .getByRole("button", { name: "Use a local profile", exact: true })
          .click();
      }
      const unlock = async () => {
        await selectValue(page, "Profile", local.id);
        await page
          .getByLabel("Passphrase", { exact: true })
          .fill("retained original passphrase");
        await page
          .getByRole("button", { name: "Unlock profile", exact: true })
          .click();
        await expect(
          page.getByRole("cell", {
            name: "Work survives database rotation",
            exact: true,
          }),
        ).toBeVisible();
      };
      await unlock();
      expect(await readFile(keyFile)).not.toEqual(before);
      const files = await readdir(resolve(profile, "secure-cache"));
      expect(files).not.toContain("workspace.sqlite.protected");
      expect(
        files.filter((name) =>
          /^workspace-[\da-f-]+\.sqlite\.protected$/.test(name),
        ),
      ).toHaveLength(1);
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
      app = await launch();
      page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      await unlock();
    } finally {
      await app.close().catch(() => {});
      await rm(profile, { recursive: true, force: true });
    }
  });
}
