import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { controlledNativeProtection } from "../support/native-protection";
import { selectValue } from "../e2e/controls.helpers";
import { readStorageArchive } from "../../apps/desktop/src/main/storage/archive";
import { ProtectedFiles } from "../../apps/desktop/src/main/identity/protected-files";
const require = createRequire(resolve("apps/desktop/package.json"));

test("maintenance backup runs without windows and its portable encrypted database survives loss of the original OS provider", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(resolve(tmpdir(), "suite-native-backup-"));
  const original = resolve(directory, "original"),
    restored = resolve(directory, "recovered");
  const destination = resolve(directory, "device.commonbackup");
  const provider = randomBytes(32).toString("hex"),
    replacement = randomBytes(32).toString("hex");
  const launch = async (profile: string) =>
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
  let app = await launch(original);
  try {
    await app.firstWindow();
    await controlledNativeProtection(app, provider);
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Portable local profile");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("original vault passphrase");
    await page
      .getByRole("button", { name: "Create profile", exact: true })
      .click();
    await page.getByRole("button", { name: "New record", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Restored portable contact");
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "other");
    await page
      .getByRole("button", { name: "Save locally", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Restored portable contact",
        exact: true,
      }),
    ).toBeVisible();
    const [local] = await page.evaluate(() =>
      window.suiteDesktop!.localVaults.request(crypto.randomUUID(), "list", {
        removed: false,
      }),
    );
    await app.close();

    // Playwright launches Electron with closed stdin. A real CLI child supplies a pipe and installs
    // only the controlled OS provider; the production main/utility/maintenance code runs unchanged.
    const bootstrap = resolve(directory, "maintenance.cjs");
    await writeFile(
      bootstrap,
      `
const {app,safeStorage}=require('electron');
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const key=Buffer.from(${JSON.stringify(provider)},'hex');
safeStorage.isEncryptionAvailable=()=>true;
safeStorage.isAsyncEncryptionAvailable=async()=>true;
safeStorage.encryptStringAsync=async(text)=>{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([cipher.update(text),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),body]);
};
safeStorage.decryptStringAsync=async(bytes)=>{
 const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
 cipher.setAuthTag(bytes.subarray(12,28));
 return {result:Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString(),shouldReEncrypt:false};
};
app.on('browser-window-created',()=>app.exit(2));
require(${JSON.stringify(process.env.SUITE_ACCEPT_BACKUP_ENTRY ?? resolve("apps/desktop/dist/main.cjs"))});
`,
    );
    const runBackup = async (profile: string) => {
      const child = spawn(
        require("electron"),
        [
          bootstrap,
          `--user-data-dir=${profile}`,
          `--backup-local-profiles=${destination}`,
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: "development",
            SUITE_DESKTOP_DEV_AUTH: "1",
            SUITE_DESKTOP_TEST_MINIMIZED: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "",
        errors = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk.toString();
      });
      const exited = once(child, "exit");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
      try {
        child.stdin.on("error", () => {}); // An existing instance can reject before reading stdin.
        child.stdin.end("independent backup passphrase\n");
        const [code] = await exited;
        return { code, output, errors };
      } finally {
        clearTimeout(deadline);
      }
    };
    const backup = await runBackup(original);
    expect(backup.code, backup.errors).toBe(0);
    expect(backup.output).toContain("Encrypted local profile backup saved.");
    expect(await readdir(directory)).toContain("device.commonbackup");

    // Acceptance harness stages the decoded archive under a new provider. Product restore activation
    // and its authorization/device-effect fences are separate unfinished work, not simulated here.
    const root = resolve(restored, "secure-cache");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const secret = await readStorageArchive({
      archive: destination,
      destination: resolve(root, "workspace.sqlite.protected"),
      passphrase: "independent backup passphrase",
    });
    // The controlled OS adapter uses AES-GCM without AAD; seal equivalently for the new provider.
    const { createCipheriv } = await import("node:crypto");
    const newFiles = new ProtectedFiles(() => root, {
      available: () => true,
      encrypt: async (text) => {
        const iv = randomBytes(12),
          cipher = createCipheriv(
            "aes-256-gcm",
            Buffer.from(replacement, "hex"),
            iv,
          );
        const body = Buffer.concat([cipher.update(text), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), body]);
      },
      decrypt: async () => {
        throw Error("Fixture only seals a new provider record");
      },
    });
    await newFiles.write("cache-secret", {
      version: 2,
      initialized: true,
      active: {
        generation: "legacy",
        secret: secret.toString("base64"),
        createdAt: Date.now(),
      },
    });
    secret.fill(0);
    app = await launch(restored);
    await app.firstWindow();
    await controlledNativeProtection(app, replacement);
    page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Use a local profile", exact: true })
      .click();
    await selectValue(page, "Profile", local.id);
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("original vault passphrase");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await expect(
      page.getByRole("cell", {
        name: "Restored portable contact",
        exact: true,
      }),
    ).toBeVisible();
    const refused = await runBackup(restored);
    expect(refused.code).toBe(1);
    expect(refused.errors).toContain("Quit the running application");
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
    await app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
