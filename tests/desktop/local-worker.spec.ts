import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));
test("minimized desktop saves through a local worker and recovers the encrypted profile after restart", async () => {
  test.setTimeout(60000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-local-worker-"));
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
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Native worker profile");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await page.getByRole("button", { name: "New record", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Native private contact");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "other");
    const worker = page.waitForEvent("worker");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    expect((await worker).url()).toMatch(
      /^suite:\/\/app\/assets\/worker-entry-[^/]+\.js$/,
    );
    await expect(
      page.getByRole("cell", { name: "Native private contact", exact: true }),
    ).toBeVisible();
    const id = await page.evaluate(async () => {
      const bridge = window.suiteDesktop!.localVaults;
      const profiles = await bridge.request(crypto.randomUUID(), "list", {
        removed: false,
      });
      const opened = await bridge.request(crypto.randomUUID(), "unlock", {
        id: profiles[0].id,
        password: "correct horse battery staple",
      });
      if (opened.revision !== 1 || "key" in opened)
        throw Error("Local utility vault commit failed");
      await bridge.request(crypto.randomUUID(), "close", {
        handle: opened.handle,
      });
      return profiles[0].id;
    });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => w.isMinimized() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await selectValue(page, "Profile", id);
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Native private contact", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Native edited contact");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Native edited contact", exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/local-worker", { recursive: true });
    await page.screenshot({
      path: "docs/verification/local-worker/desktop.png",
    });
    await page
      .getByRole("button", { name: "Lock profile", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Native edited contact", exact: true }),
    ).toHaveCount(0);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => w.isMinimized() && !w.isFocused(),
        ),
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
