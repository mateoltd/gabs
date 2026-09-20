import { test, expect, request } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { corporatePortability } from "../support/corporate-portability/journey";
import { selectValue } from "../e2e/controls.helpers";
import {
  nativePortabilityDevice,
  portabilityStorage,
} from "../support/corporate-portability/devices";
const require = createRequire(resolve("apps/desktop/package.json"));

async function snapshot(root: string) {
  const result = new Map<string, Buffer>();
  async function walk(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = join(prefix, entry.name);
      expect(entry.isSymbolicLink()).toBe(false);
      if (entry.isDirectory())
        await walk(join(directory, entry.name), relative);
      else result.set(relative, await readFile(join(directory, entry.name)));
    }
  }
  await walk(root);
  return result;
}

for (const interruption of [
  "none",
  "preparing",
  "retained",
  "activated",
  "damaged-database",
] as const) {
  test(`corporate archive recovery retains the old keyed store through ${interruption}`, async () => {
    test.setTimeout(240000);
    const directory = await mkdtemp(
      resolve(tmpdir(), "suite-corporate-device-recovery-"),
    );
    const profile = resolve(directory, "device"),
      root = resolve(profile, "secure-cache");
    const originalKey = randomBytes(32).toString("hex");
    const replacement =
      interruption === "damaged-database"
        ? originalKey
        : randomBytes(32).toString("hex");
    let device: Awaited<ReturnType<typeof nativePortabilityDevice>> | undefined;
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let original: Map<string, Buffer>, retained: string;
    let scope: { userId: string; workspaceId: string };
    const command = async (operation: string, fault = "none") => {
      const entry = resolve(directory, "maintenance.cjs");
      const bootstrap = await readFile(resolve(profile, "entry.cjs"), "utf8");
      await writeFile(
        entry,
        `
require('electron').app.on('browser-window-created',()=>process.exit(2));
const fs=require('node:fs/promises'),rename=fs.rename,mkdir=fs.mkdir;
fs.mkdir=async(...args)=>{
 const value=await mkdir(...args);
 if(${JSON.stringify(fault)}==='preparing' && String(args[0]).includes('.recovery-')) process.kill(process.pid,'SIGKILL');
 return value;
};
fs.rename=async(from,to)=>{
 await rename(from,to);
 if((${JSON.stringify(fault)}==='retained' && String(to).includes('.retained-')) ||
 (${JSON.stringify(fault)}==='activated' && String(from).includes('.recovery-') && String(to).endsWith('secure-cache')))
 process.kill(process.pid,'SIGKILL');
};
${bootstrap}`,
      );
      const child = spawn(
        require("electron"),
        [entry, `--user-data-dir=${profile}`, operation],
        {
          env: {
            ...process.env,
            NODE_ENV: "development",
            SUITE_DESKTOP_DEV_AUTH: "1",
            SUITE_DESKTOP_TEST_MINIMIZED: "1",
            SUITE_TEST_ARCHIVE_OS_KEY: replacement,
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
      child.stdin.on("error", () => {});
      const exited = once(child, "exit"),
        deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.stdin.end("unused backup passphrase\n");
      try {
        const [code, signal] = await exited;
        return { code, signal, output, errors };
      } finally {
        clearTimeout(deadline);
      }
    };
    try {
      expect(
        (
          await api.post("/auth/development", {
            headers: { origin: "http://localhost:4300" },
            data: { email: "owner@demo.local" },
          })
        ).ok(),
      ).toBe(true);
      device = await nativePortabilityDevice(profile, {
        protectionKey: originalKey,
      });
      const running = await command("--prepare-device-recovery");
      expect(running.code).toBe(1);
      expect(running.errors).toContain("Quit the running application");
      await corporatePortability({
        archive: true,
        evidenceName: `native-key-recovery-${interruption}`,
        archiveExportCheck: async (context) => {
          scope = context.scope;
        },
        source: device.page,
        api,
        directory,
        offline: (value) => device!.offline(value),
        exportFile: (button, path) => device!.exportFile(button, path),
        replaceDevice: async () => {
          await device!.close();
          original = await snapshot(root);
          if (interruption === "damaged-database") {
            const databases = [...original.keys()].filter((name) =>
              /^workspace.*\.sqlite\.protected$/.test(name),
            );
            expect(databases).toHaveLength(1);
            const path = join(root, databases[0]);
            const bytes = await readFile(path);
            bytes[0] ^= 255;
            await writeFile(path, bytes);
            original = await snapshot(root);
          }
          const invalid = await command("--new-device-recovery");
          expect(invalid.code).toBe(1);
          expect(invalid.errors).toContain("Choose one maintenance operation");
          expect(await snapshot(root)).toEqual(original);
          // Real maintenance refuses either the lost OS wrapper or the corrupted encrypted database.
          const refused = await command(
            `--backup-local-profiles=${resolve(directory, "must-not-exist.commonbackup")}`,
          );
          expect(refused.code, refused.errors).toBe(1);
          const refusedStore = await snapshot(root);
          // A readable wrapper may renew before database verification fails. The damaged database stays exact.
          if (interruption === "damaged-database") {
            for (const [name, bytes] of original)
              if (name.endsWith(".sqlite.protected"))
                expect(refusedStore.get(name)).toEqual(bytes);
            original = refusedStore;
          } else expect(refusedStore).toEqual(original);
          const prepared = await command(
            "--prepare-device-recovery",
            interruption,
          );
          if (interruption === "none" || interruption === "damaged-database") {
            expect(prepared.code, prepared.errors).toBe(0);
            expect(prepared.output).toContain(
              "No saved work or access was restored",
            );
          } else expect(prepared.signal).toBe("SIGKILL");
          if (interruption === "preparing") {
            expect(await snapshot(root)).toEqual(original);
            const retry = await command("--prepare-device-recovery");
            expect(retry.code, retry.errors).toBe(0);
          }
          device = await nativePortabilityDevice(profile, {
            reuse: true,
            protectionKey: replacement,
            beforeSignIn: async (app, page) => {
              // Automatic resumption completes before the normal sign-in UI is admitted.
              const retainedNames = (await readdir(profile)).filter((name) =>
                name.startsWith("secure-cache.retained-"),
              );
              expect(retainedNames).toHaveLength(1);
              retained = resolve(profile, retainedNames[0]);
              expect(await snapshot(retained)).toEqual(original);
              expect(
                (await readdir(profile)).filter((name) =>
                  name.startsWith("secure-cache.recovery"),
                ),
              ).toEqual([]);
              const files = [...(await snapshot(root)).keys()];
              expect(
                files.some((name) => /identity|credentials|lease/.test(name)),
              ).toBe(false);
              await expect(
                page.getByRole("button", {
                  name: "Open local workspace",
                  exact: true,
                }),
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
            },
          });
          return device.page;
        },
      });
      const recovered = await portabilityStorage(device.page, scope!);
      await device.close();
      // A repeated maintenance invocation must not reset the now recovered imports and work.
      const retry = await command("--prepare-device-recovery");
      expect(retry.code, retry.errors).toBe(0);
      expect(retry.output).toContain(
        "already prepared. Newer work was preserved",
      );
      expect(await snapshot(retained!)).toEqual(original!);
      device = await nativePortabilityDevice(profile, {
        reuse: true,
        protectionKey: replacement,
      });
      await selectValue(device.page, "Workspace", scope!.workspaceId);
      const afterRetry = await portabilityStorage(device.page, scope!);
      expect(afterRetry.journal).toEqual(recovered.journal);
      expect(afterRetry.drafts).toEqual(recovered.drafts);
      expect(afterRetry.recoveryImports).toEqual(recovered.recoveryImports);
      expect(
        (await readdir(profile)).filter((name) =>
          name.startsWith("secure-cache.retained-"),
        ),
      ).toHaveLength(1);
    } finally {
      try {
        await device?.close();
      } finally {
        await api.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
}
