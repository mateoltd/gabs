import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(resolve("apps/desktop/package.json"));

test("the real compiled desktop refuses modified assets before storage or a window and reopens after repair", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(resolve(tmpdir(), "suite-integrity-main-"));
  try {
    const dist = resolve(directory, "dist"),
      profile = resolve(directory, "profile");
    await cp(resolve("apps/desktop/dist"), dist, { recursive: true });
    await mkdir(resolve(profile, "secure-cache"), { recursive: true });
    const pending = Buffer.from("opaque pre-existing saved-work bytes");
    await writeFile(resolve(profile, "secure-cache/pending.bin"), pending);
    await writeFile(
      resolve(profile, "secure-cache/credentials.bin"),
      "old protected refresh credential",
    );
    await writeFile(
      resolve(profile, "secure-cache/identity.bin"),
      "old remembered identity",
    );
    const entry = resolve(directory, "entry.cjs");
    await writeFile(
      entry,
      `
      const {app, safeStorage, utilityProcess}=require('electron');
      safeStorage.isEncryptionAvailable=()=>false;
      safeStorage.isAsyncEncryptionAvailable=async()=>false;
      utilityProcess.fork=()=>{process.stdout.write('UNEXPECTED_STORAGE_OPEN\\n'); throw Error('Storage must not open in this fixture');};
      app.on('browser-window-created',()=>{process.stdout.write('INTEGRITY_WINDOW_CREATED\\n'); setImmediate(()=>app.exit(0));});
      require(${JSON.stringify(resolve(dist, "main.cjs"))});
    `,
    );
    const launch = () =>
      new Promise<{ code: number | null; output: string }>(
        (resolveRun, reject) => {
          const env: NodeJS.ProcessEnv = {
            ...process.env,
            SUITE_DESKTOP_TEST_MINIMIZED: "1",
          };
          delete env.ELECTRON_RUN_AS_NODE;
          const child = spawn(
            require("electron"),
            [entry, `--user-data-dir=${profile}`],
            { env, stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "";
          child.stdout.on("data", (bytes) => {
            output += bytes;
          });
          child.stderr.on("data", (bytes) => {
            output += bytes;
          });
          const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("exit", (code, signal) => {
            clearTimeout(timer);
            if (signal)
              reject(
                Error(`Desktop exited with ${signal}: ${output.slice(-1500)}`),
              );
            else resolveRun({ code, output });
          });
        },
      );
    const asset = resolve(dist, "cache-worker.cjs"),
      original = await readFile(asset);
    await writeFile(
      asset,
      Buffer.concat([original, Buffer.from("\n// corrupt installation\n")]),
    );
    for (let retry = 0; retry < 2; retry++) {
      const result = await launch();
      expect(result.code, result.output.slice(-1500)).toBe(1);
      expect(result.output).toContain(
        "Common could not verify this installation. changed-asset",
      );
      expect(result.output).not.toContain("INTEGRITY_WINDOW_CREATED");
      expect(result.output).not.toContain("UNEXPECTED_STORAGE_OPEN");
    }
    const audit = resolve(profile, "integrity");
    expect(
      await readFile(resolve(profile, "secure-cache/credentials.bin"), "utf8"),
    ).toBe("old protected refresh credential");
    expect(
      (await readdir(audit)).filter((name) => name.endsWith(".locked.json")),
    ).toHaveLength(1);
    await writeFile(asset, original);
    const repaired = await launch();
    expect(repaired.code, repaired.output.slice(-1500)).toBe(0);
    expect(repaired.output).toContain("INTEGRITY_WINDOW_CREATED");
    expect(repaired.output).not.toContain("UNEXPECTED_STORAGE_OPEN");
    const events = await readdir(audit);
    expect(events).toHaveLength(2);
    expect(
      events.filter((name) => name.endsWith(".recovered.json")),
    ).toHaveLength(1);
    expect(
      await readFile(resolve(profile, "secure-cache/pending.bin")),
    ).toEqual(pending);
    expect(await readdir(resolve(profile, "secure-cache"))).toEqual([
      "pending.bin",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
