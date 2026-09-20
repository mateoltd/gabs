import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { controlledNativeProtection } from "../support/native-protection";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

for (const interruption of ["none", "committed"] as const) {
  test(`maintenance backup and additive restore preserve work after ${interruption} interruption`, async () => {
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
      await page
        .getByRole("button", { name: "New record", exact: true })
        .click();
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
      await page.evaluate(async (id) => {
        const vaults = window.suiteDesktop!.localVaults;
        await vaults.request(crypto.randomUUID(), "configure", {
          id,
          password: "original vault passphrase",
          pin: "12345678",
          biometric: false,
        });
        const opened = await vaults.request(crypto.randomUUID(), "unlock", {
          id,
          password: "original vault passphrase",
        });
        await vaults.request(crypto.randomUUID(), "commit", {
          handle: opened.handle,
          revision: opened.revision,
          value: {
            ...(opened.data as Record<string, unknown>),
            capabilityGrants: [{ id: "old-device-consent" }],
            deviceRequests: {
              original: {
                id: "original",
                state: "pending",
                attemptId: "original-device-attempt",
                createdAt: 1,
                grantId: "old-device",
                call: {
                  moduleId: "contacts",
                  moduleVersion: "1.0.0",
                  capability: "export",
                  input: { filename: "contact.txt", content: "Captured work" },
                },
              },
            },
          },
        });
        await vaults.request(crypto.randomUUID(), "close", {
          handle: opened.handle,
        });
      }, local.id);
      await app.close();

      // Playwright launches Electron with closed stdin. A real CLI child supplies a pipe and installs
      // only the controlled OS provider; the production main/utility/maintenance code runs unchanged.
      const bootstrap = resolve(directory, "maintenance.cjs");
      const runMaintenance = async (
        profile: string,
        operation: "backup" | "restore" = "backup",
        providerKey = provider,
        passphrase = "independent backup passphrase",
        extra: string[] = [],
        interrupt = false,
      ) => {
        await writeFile(
          bootstrap,
          `
const {app,safeStorage,utilityProcess}=require('electron');
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const key=Buffer.from(${JSON.stringify(providerKey)},'hex');
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
if (${JSON.stringify(interrupt)}) {
 const fork=utilityProcess.fork.bind(utilityProcess);
 utilityProcess.fork=(...args)=>{
  const worker=fork(...args),post=worker.postMessage.bind(worker);
  let mergeId;
  worker.postMessage=(message,...rest)=>{
   if(message?.action==='merge-restoration') mergeId=message.id;
   return post(message,...rest);
  };
  // The SQLite commit is real; kill main before it can acknowledge or clean staging.
  worker.prependListener('message',(reply)=>{
   if(mergeId!==undefined && reply.id===mergeId && !reply.error) process.kill(process.pid,'SIGKILL');
  });
  return worker;
 };
}
app.on('browser-window-created',()=>app.exit(2));
require(${JSON.stringify(process.env.SUITE_ACCEPT_BACKUP_ENTRY ?? resolve("apps/desktop/dist/main.cjs"))});
`,
        );
        const child = spawn(
          require("electron"),
          [
            bootstrap,
            `--user-data-dir=${profile}`,
            `--${operation}-local-profiles=${destination}`,
            ...extra,
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
          child.stdin.end(`${passphrase}\n`);
          const [code, signal] = await exited;
          return { code, signal, output, errors };
        } finally {
          clearTimeout(deadline);
        }
      };
      const backup = await runMaintenance(original);
      expect(backup.code, backup.errors).toBe(0);
      expect(backup.output).toContain("Encrypted local profile backup saved.");
      expect(await readdir(directory)).toContain("device.commonbackup");

      const invalid = await runMaintenance(
        restored,
        "restore",
        replacement,
        "incorrect archive passphrase",
      );
      expect(invalid.code).toBe(1);
      expect(
        (await readdir(restored)).filter(
          (name) =>
            name === "secure-cache" || name.startsWith(".local-restore-"),
        ),
      ).toEqual([]);
      const conflicting = await runMaintenance(
        restored,
        "restore",
        replacement,
        "independent backup passphrase",
        [`--backup-local-profiles=${destination}`],
      );
      expect(conflicting.code).toBe(1);
      const imported = await runMaintenance(
        restored,
        "restore",
        replacement,
        "independent backup passphrase",
        [],
        interruption === "committed",
      );
      if (interruption === "committed") expect(imported.signal).toBe("SIGKILL");
      else {
        expect(imported.code, imported.errors).toBe(0);
        expect(imported.output).toContain("Local profiles restored.");
      }
      const replay = await runMaintenance(restored, "restore", replacement);
      expect(replay.code, replay.errors).toBe(0);
      expect(replay.output).toContain("Archive already restored.");
      expect(
        (await readdir(restored)).filter(
          (name) =>
            name.startsWith(".local-restore-") ||
            name === "secure-cache.import.json",
        ),
      ).toEqual([]);
      // Restoring onto an independently existing copy of the profile must fail, never replace it.
      const collision = await runMaintenance(original, "restore");
      expect(collision.code).toBe(1);
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
      const guards = await page.evaluate(async (id) => {
        const vaults = window.suiteDesktop!.localVaults;
        const status = await vaults.request(crypto.randomUUID(), "status", {
          id,
        });
        const opened = await vaults.request(crypto.randomUUID(), "unlock", {
          id,
          password: "original vault passphrase",
        });
        const data = opened.data as {
          capabilityGrants: unknown[];
          deviceRequests: Record<string, unknown>;
        };
        await vaults.request(crypto.randomUUID(), "close", {
          handle: opened.handle,
        });
        return {
          quickUnlock: status.enabled,
          grants: data.capabilityGrants,
          requests: data.deviceRequests,
        };
      }, local.id);
      expect(guards).toMatchObject({
        quickUnlock: false,
        grants: [],
        requests: {
          original: {
            state: "uncertain",
            attemptId: "original-device-attempt",
          },
        },
      });
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Edited after restoration");
      await page
        .getByRole("button", { name: "Save locally", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Edited after restoration",
          exact: true,
        }),
      ).toBeVisible();
      await app.close();
      const repeated = await runMaintenance(restored, "restore", replacement);
      expect(repeated.code, repeated.errors).toBe(0);
      expect(repeated.output).toContain("Archive already restored.");
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
          name: "Edited after restoration",
          exact: true,
        }),
      ).toBeVisible();
      const refused = await runMaintenance(restored, "restore", replacement);
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
}
