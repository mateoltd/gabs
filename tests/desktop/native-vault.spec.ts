import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readdir, readFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { controlledNativeProtection } from "../support/native-protection";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

test("standalone vault uses the utility bridge and encrypted SQLite through PIN and process restart with a controlled OS adapter", async () => {
  test.setTimeout(60000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-native-vault-ui-"));
  const key = randomBytes(32).toString("hex");
  const launch = async () => {
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
      await controlledNativeProtection(app, key);
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
      .fill("Native encrypted vault");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Native encrypted vault",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New record", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Native retained contact");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "other");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Native retained contact", exact: true }),
    ).toBeVisible();
    const profiles = await page.evaluate(() =>
      window.suiteDesktop!.localVaults.request(crypto.randomUUID(), "list", {
        removed: false,
      }),
    );
    expect(profiles).toHaveLength(1);
    const id = profiles[0].id;
    expect(
      await page.evaluate(() => "localUnlock" in window.suiteDesktop!),
    ).toBe(false);
    expect(
      await page.evaluate(async () => {
        const request = indexedDB.open("suite-local-profiles", 1);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const count = db.transaction("vaults").objectStore("vaults").count();
        const result = await new Promise<number>((resolve) => {
          count.onsuccess = () => resolve(count.result);
        });
        db.close();
        return result;
      }),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Profile unlock", exact: true })
      .click();
    await mkdir("docs/verification/native-vaults", { recursive: true });
    await page.screenshot({
      path: "docs/verification/native-vaults/settings.png",
      animations: "disabled",
    });
    await page
      .getByLabel("Current passphrase", { exact: true })
      .fill("correct horse battery staple");
    await page.getByLabel("New PIN", { exact: true }).fill("12345678");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("12345678");
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
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await selectValue(page, "Profile", id);
    await page
      .getByRole("button", { name: "Use PIN instead", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("12345678");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Native retained contact", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));
    await expect(
      page.getByRole("heading", { name: "Local profiles", exact: true }),
    ).toBeVisible();
    await selectValue(page, "Profile", id);
    await page
      .getByRole("button", { name: "Use PIN instead", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("12345678");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Native retained contact", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ app }) => {
      const storage = app
        .getAppMetrics()
        .find((process) => process.name === "Common protected storage");
      if (!storage) throw Error("Protected storage process was not found");
      process.kill(storage.pid, "SIGKILL");
    });
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
    const files = (await readdir(resolve(profile, "secure-cache"))).filter(
      (file) => file.startsWith("workspace.sqlite"),
    );
    expect(files).toContain("workspace.sqlite.protected");
    for (const file of files) {
      const bytes = await readFile(resolve(profile, "secure-cache", file));
      for (const text of [
        id,
        "Native encrypted vault",
        "Native retained contact",
        "local_vaults",
      ])
        expect(bytes.includes(Buffer.from(text))).toBe(false);
    }
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("legacy IndexedDB migration survives a replay and cancelled native PIN enrollment cannot change the profile", async () => {
  test.setTimeout(60000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-vault-migration-"));
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
    await controlledNativeProtection(app, randomBytes(32).toString("hex"));
    const id = await page.evaluate(async () => {
      const id = crypto.randomUUID(),
        salt = crypto.getRandomValues(new Uint8Array(16)),
        iv = crypto.getRandomValues(new Uint8Array(12));
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("correct horse battery staple"),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"],
      );
      const data = {
        records: {
          "contacts/contacts": [
            {
              id: crypto.randomUUID(),
              version: 1,
              archived: false,
              updatedAt: new Date().toISOString(),
              data: {
                name: "Migrated contact",
                kind: "person",
                relationship: "other",
              },
            },
          ],
        },
      };
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
        key,
        new TextEncoder().encode(JSON.stringify(data)),
      );
      const vault = {
        id,
        name: "Legacy vault",
        salt,
        iv,
        ciphertext,
        updatedAt: Date.now(),
        revision: 2,
      };
      const open = indexedDB.open("suite-local-profiles", 1);
      open.onupgradeneeded = () =>
        open.result.createObjectStore("vaults", { keyPath: "id" });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction("vaults", "readwrite");
      tx.objectStore("vaults").put(vault);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      (
        window as typeof window & { migrationSource?: unknown }
      ).migrationSource = vault;
      return id;
    });
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
      page.getByRole("cell", { name: "Migrated contact", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Updated after migration");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Updated after migration", exact: true }),
    ).toBeVisible();
    await page.evaluate(async () => {
      const open = indexedDB.open("suite-local-profiles", 1);
      const db = await new Promise<IDBDatabase>((resolve) => {
        open.onsuccess = () => resolve(open.result);
      });
      const tx = db.transaction("vaults", "readwrite");
      tx.objectStore("vaults").put(
        (window as typeof window & { migrationSource?: unknown })
          .migrationSource,
      );
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    await page.reload();
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
      page.getByRole("cell", { name: "Updated after migration", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ safeStorage }) => {
      const encrypt = safeStorage.encryptStringAsync;
      safeStorage.encryptStringAsync = async (value) => {
        await new Promise<void>((resolve) => {
          (
            globalThis as typeof globalThis & {
              releaseVaultProtection?: () => void;
            }
          ).releaseVaultProtection = resolve;
        });
        return encrypt(value);
      };
    });
    const requestId = await page.evaluate((id) => {
      const requestId = crypto.randomUUID();
      (window as typeof window & { pinAttempt?: Promise<string> }).pinAttempt =
        window
          .suiteDesktop!.localVaults.request(requestId, "configure", {
            id,
            password: "correct horse battery staple",
            pin: "12345678",
            biometric: false,
          })
          .then(
            () => "unexpected success",
            (error) => String(error),
          );
      return requestId;
    }, id);
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            !!(
              globalThis as typeof globalThis & {
                releaseVaultProtection?: () => void;
              }
            ).releaseVaultProtection,
        ),
      )
      .toBe(true);
    await page.evaluate(
      (id) => window.suiteDesktop!.localVaults.cancel(id),
      requestId,
    );
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { pinAttempt?: Promise<string> })
            .pinAttempt,
      ),
    ).not.toBe("unexpected success");
    expect(
      await page.evaluate(
        (id) =>
          window.suiteDesktop!.localVaults.request(
            crypto.randomUUID(),
            "status",
            { id },
          ),
        id,
      ),
    ).toMatchObject({ enabled: false });
    await app.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          releaseVaultProtection?: () => void;
        }
      ).releaseVaultProtection?.(),
    );
    expect(
      await page.evaluate(
        (id) =>
          window.suiteDesktop!.localVaults.request(
            crypto.randomUUID(),
            "status",
            { id },
          ),
        id,
      ),
    ).toMatchObject({ enabled: false });
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
