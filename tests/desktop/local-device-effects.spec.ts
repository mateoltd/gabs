import "dotenv/config";
import { test, expect, _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile, access, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { localDeviceEffectsJourney } from "../support/local-device-effects-journey";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

test.use({ actionTimeout: 10000 });
test("hidden native device effects recheck delayed saves and recover cancellation without repeating business writes", async () => {
  test.setTimeout(150000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-device-effects-"));
  const helper = await build({
    stdin: {
      contents:
        "export {listLocalProfiles,unlockLocalProfile} from './composition/src/local/product';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
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
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  const absent = async (path: string) =>
    expect(
      await access(path).then(
        () => false,
        () => true,
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
    const { id, capture, button } = await localDeviceEffectsJourney(page, true);
    const saved = resolve(profile, "saved.txt"),
      cancelled = resolve(profile, "cancelled.txt"),
      retried = resolve(profile, "retried.txt"),
      revoked = resolve(profile, "revoked.txt");
    await app.evaluate(({ dialog }, path) => {
      const state = {
        path,
        hold: false,
        waiting: false,
        release: undefined as undefined | (() => void),
      };
      (globalThis as unknown as { deviceDialog: typeof state }).deviceDialog =
        state;
      dialog.showSaveDialog = async () => {
        state.waiting = true;
        if (state.hold)
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
        state.waiting = false;
        return { canceled: false, filePath: state.path };
      };
    }, saved);
    await capture("Native saved export");
    await button("Run device request").click();
    await expect(page.getByText("File saved", { exact: true })).toBeVisible();
    expect(await readFile(saved, "utf8")).toBe("Native saved export");
    expect((await stat(saved)).mode & 0o077).toBe(0);
    await button("Clear request").click();
    await button("Close dialog").click();
    await capture("Cancelled and retried");
    const configure = (path: string, hold: boolean) =>
      app.evaluate(
        (_, value) => {
          Object.assign(
            (
              globalThis as unknown as {
                deviceDialog: { path: string; hold: boolean };
              }
            ).deviceDialog,
            value,
          );
        },
        { path, hold },
      );
    const waiting = async () =>
      expect
        .poll(() =>
          app.evaluate(
            () =>
              (globalThis as unknown as { deviceDialog: { waiting: boolean } })
                .deviceDialog.waiting,
          ),
        )
        .toBe(true);
    const release = () =>
      app.evaluate(() =>
        (
          globalThis as unknown as { deviceDialog: { release?: () => void } }
        ).deviceDialog.release?.(),
      );
    await configure(cancelled, true);
    await button("Run device request").click();
    await waiting();
    await hidden();
    await button("Cancel device request").click();
    await expect(
      page.getByText("Outcome needs review", { exact: true }),
    ).toBeVisible();
    await release();
    await absent(cancelled);
    await button("Review before retry").click();
    const consent = page.getByRole("checkbox", {
      name: "I checked the outcome and want to run this device action again.",
      exact: true,
    });
    await expect(consent).toBeFocused();
    await expect(button("Retry device action")).toBeDisabled();
    await consent.press("Space");
    await expect(button("Retry device action")).toBeEnabled();
    await configure(retried, false);
    await button("Retry device action").click();
    await expect(page.getByText("File saved", { exact: true })).toBeVisible();
    expect(await readFile(retried, "utf8")).toBe("Cancelled and retried");
    await absent(cancelled);
    await expect(
      page.getByText("Retry created", { exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/local-device-effects", { recursive: true });
    await page.screenshot({
      path: "docs/verification/local-device-effects/native.png",
    });
    while (await button("Clear request").count()) {
      const count = await button("Clear request").count();
      await button("Clear request").first().click();
      await expect(button("Clear request")).toHaveCount(count - 1);
    }
    await button("Close dialog").click();
    await expect(
      page.getByRole("cell", { name: "Cancelled and retried", exact: true }),
    ).toHaveCount(1);
    await capture("Revoked in another profile session");
    await configure(revoked, true);
    await button("Run device request").click();
    await waiting();
    await page.evaluate(
      async ({ javascript, moduleId }) => {
        const url = URL.createObjectURL(
          new Blob([javascript], { type: "text/javascript" }),
        );
        const sdk = (await import(
          url
        )) as typeof import("../../composition/src/local/product");
        URL.revokeObjectURL(url);
        const profile = (await sdk.listLocalProfiles()).find(
          (p) => p.name === "Device actions",
        )!;
        const other = await sdk.unlockLocalProfile(
          profile.id,
          "correct horse battery staple",
        );
        await other.setCapabilityAccess(moduleId, "export", false);
        other.lock();
      },
      { javascript: helper.outputFiles[0].text, moduleId: id },
    );
    await release();
    await expect(page.getByRole("alert")).toContainText(
      "changed in another window",
    );
    await expect(
      page.getByText("Awaiting recovery", { exact: true }),
    ).toBeVisible();
    await absent(revoked);
    await button("Close dialog").click();
    await button("Lock profile").click();
    await page.getByRole("combobox", { name: "Profile", exact: true }).click();
    await page
      .getByRole("option", { name: "Device actions", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Unlock profile").click();
    await page.getByRole("button", { name: /^Device requests/ }).click();
    await expect(
      page.getByText("Outcome needs review", { exact: true }),
    ).toBeVisible();
    await button("Clear request").click();
    await expect(
      page.getByText("No device requests", { exact: true }),
    ).toBeVisible();
    await button("Close dialog").click();
    await selectValue(page, "Module and resource", id + "/items");
    await expect(
      page.getByRole("cell", {
        name: "Revoked in another profile session",
        exact: true,
      }),
    ).toHaveCount(1);
    await hidden();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
