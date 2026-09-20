import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { selectValue } from "../e2e/controls.helpers";
const require = createRequire(resolve("apps/desktop/package.json"));

for (const interruption of [
  "none",
  "preparing",
  "retained",
  "activated",
] as const) {
  test(`in-place recovery retains an unreadable original and resumes ${interruption} interruption before UI admission`, async () => {
    test.setTimeout(90000);
    const dir = await mkdtemp(resolve(tmpdir(), "suite-native-root-recovery-"));
    const profile = resolve(dir, "profile"),
      root = resolve(profile, "secure-cache");
    const archive = resolve(dir, "local.commonbackup");
    const original = randomBytes(32).toString("hex"),
      replacement = randomBytes(32).toString("hex");
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    const bootstrap = async (
      key: string,
      maintenance: boolean,
      fault = "none",
    ) => {
      const path = resolve(
        dir,
        `${maintenance ? "maintenance" : "application"}.cjs`,
      );
      await writeFile(
        path,
        `
const {app,safeStorage}=require('electron');
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const key=Buffer.from(${JSON.stringify(key)},'hex');
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
if (${maintenance}) app.on('browser-window-created',()=>app.exit(2));
if (${JSON.stringify(fault)}!=='none') {
 const fs=require('node:fs/promises'),rename=fs.rename,link=fs.link;
 fs.link=async(from,to)=>{
  await link(from,to);
  if(${JSON.stringify(fault)}==='preparing' && String(to).includes('.recovery-') && String(to).endsWith('archive.sqlite.protected')) process.kill(process.pid,'SIGKILL');
 };
 fs.rename=async(from,to)=>{
  await rename(from,to);
  if((${JSON.stringify(fault)}==='retained' && String(to).includes('.retained-')) ||
     (${JSON.stringify(fault)}==='activated' && String(from).includes('.recovery-') && String(to).endsWith('secure-cache')))
   process.kill(process.pid,'SIGKILL');
 };
}
require(${JSON.stringify(process.env.SUITE_ACCEPT_RECOVERY_ENTRY ?? resolve("apps/desktop/dist/main.cjs"))});
`,
      );
      return path;
    };
    const env = {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
      SUITE_DESKTOP_TEST_MINIMIZED: "1",
    };
    const launch = async (key: string) =>
      electron.launch({
        executablePath: require("electron"),
        args: [await bootstrap(key, false), `--user-data-dir=${profile}`],
        env,
      });
    const command = async (
      operation: "backup" | "recover" | "restore",
      key: string,
      fault = "none",
      forceNewRecovery = false,
    ) => {
      const child = spawn(
        require("electron"),
        [
          await bootstrap(key, true, fault),
          `--user-data-dir=${profile}`,
          `--${operation}-local-profiles=${archive}`,
          ...(forceNewRecovery ? ["--new-local-recovery"] : []),
        ],
        { env, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "",
        errors = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
      });
      child.stderr.on("data", (data) => {
        errors += data.toString();
      });
      child.stdin.on("error", () => {});
      const exited = once(child, "exit");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.stdin.end("independent archive passphrase\n");
      try {
        const [code, signal] = await exited;
        return { code, signal, output, errors };
      } finally {
        clearTimeout(deadline);
      }
    };
    try {
      app = await launch(original);
      let page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      await page
        .getByLabel("Profile name", { exact: true })
        .fill("Original local owner");
      await page
        .getByLabel("Passphrase", { exact: true })
        .fill("original profile passphrase");
      await page
        .getByRole("button", { name: "Create profile", exact: true })
        .click();
      await page
        .getByRole("button", { name: "New record", exact: true })
        .click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Contact from recovered archive");
      await selectValue(page, "Kind", "person");
      await selectValue(page, "Relationship", "other");
      await page
        .getByRole("button", { name: "Save locally", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Contact from recovered archive",
          exact: true,
        }),
      ).toBeVisible();
      const [local] = await page.evaluate(() =>
        window.suiteDesktop!.localVaults.request(crypto.randomUUID(), "list", {
          removed: false,
        }),
      );
      await app.close();
      app = undefined;
      const backedUp = await command("backup", original);
      expect(backedUp.code, backedUp.errors).toBe(0);
      const before = new Map(
        await Promise.all(
          (await readdir(root)).map(
            async (name) =>
              [name, await readFile(resolve(root, name))] as const,
          ),
        ),
      );
      const refused = await command("restore", replacement);
      expect(refused.code).toBe(1);
      const recovered = await command("recover", replacement, interruption);
      if (interruption === "none")
        expect(recovered.code, recovered.errors).toBe(0);
      else expect(recovered.signal).toBe("SIGKILL");
      if (interruption === "preparing") {
        for (const [name, bytes] of before)
          expect(await readFile(resolve(root, name))).toEqual(bytes);
        const restarted = await command("recover", replacement);
        expect(restarted.code, restarted.errors).toBe(0);
      }
      // Normal startup must finish pending recovery with the new provider before opening its window.
      app = await launch(replacement);
      page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      await selectValue(page, "Profile", local.id);
      await page
        .getByLabel("Passphrase", { exact: true })
        .fill("original profile passphrase");
      await page
        .getByRole("button", { name: "Unlock profile", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Contact from recovered archive",
          exact: true,
        }),
      ).toBeVisible();
      const retained = (await readdir(profile)).filter((name) =>
        name.startsWith("secure-cache.retained-"),
      );
      expect(retained).toHaveLength(1);
      for (const [name, bytes] of before)
        expect(await readFile(resolve(profile, retained[0], name))).toEqual(
          bytes,
        );
      expect(
        (await readdir(profile)).filter((name) =>
          name.startsWith("secure-cache.recovery"),
        ),
      ).toEqual([]);
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every(
            (window) =>
              !window.isFocused() &&
              (!window.isVisible() || window.isMinimized()),
          ),
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page
        .getByLabel("Name", { exact: true })
        .fill("Newer work after recovery");
      await page
        .getByRole("button", { name: "Save locally", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Newer work after recovery",
          exact: true,
        }),
      ).toBeVisible();
      await app.close();
      app = undefined;
      const repeated = await command("recover", replacement);
      expect(repeated.code, repeated.errors).toBe(0);
      expect(repeated.output).toContain("already recovered");
      app = await launch(replacement);
      page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
      await selectValue(page, "Profile", local.id);
      await page
        .getByLabel("Passphrase", { exact: true })
        .fill("original profile passphrase");
      await page
        .getByRole("button", { name: "Unlock profile", exact: true })
        .click();
      await expect(
        page.getByRole("cell", {
          name: "Newer work after recovery",
          exact: true,
        }),
      ).toBeVisible();
      if (interruption === "none") {
        await app.close();
        app = undefined;
        const secondReplacement = randomBytes(32).toString("hex");
        const guarded = await command("recover", secondReplacement);
        expect(guarded.code).toBe(1);
        const explicit = await command(
          "recover",
          secondReplacement,
          "none",
          true,
        );
        expect(explicit.code, explicit.errors).toBe(0);
        expect(
          (await readdir(profile)).filter((name) =>
            name.startsWith("secure-cache.retained-"),
          ),
        ).toHaveLength(2);
        app = await launch(secondReplacement);
        page = await app.firstWindow();
        await page
          .getByRole("button", { name: "Use a local profile", exact: true })
          .click();
        await selectValue(page, "Profile", local.id);
        await page
          .getByLabel("Passphrase", { exact: true })
          .fill("original profile passphrase");
        await page
          .getByRole("button", { name: "Unlock profile", exact: true })
          .click();
        await expect(
          page.getByRole("cell", {
            name: "Contact from recovered archive",
            exact: true,
          }),
        ).toBeVisible();
      }
    } finally {
      await app?.close().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });
}
