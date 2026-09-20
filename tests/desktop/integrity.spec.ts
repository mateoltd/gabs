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

function launchIntegrityProbe(entry: string, profile: string) {
  return new Promise<{ code: number | null; output: string }>(
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
}

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
    const launch = () => launchIntegrityProbe(entry, profile);
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

test("a runtime asset fault gates every native feature and a held real reply before shutdown", async () => {
  test.setTimeout(90000);
  const directory = await mkdtemp(
    resolve(tmpdir(), "suite-integrity-runtime-"),
  );
  try {
    const dist = resolve(directory, "dist"),
      profile = resolve(directory, "profile");
    await cp(resolve("apps/desktop/dist"), dist, { recursive: true });
    await mkdir(resolve(profile, "secure-cache"), { recursive: true });
    const pending = Buffer.from(
      "retained work captured before runtime lockdown",
    );
    await writeFile(resolve(profile, "secure-cache/pending.bin"), pending);
    const entry = resolve(directory, "entry.cjs");
    await writeFile(
      entry,
      `
      const {app,ipcMain,powerMonitor,safeStorage}=require('electron');
      const fs=require('node:fs'), promises=require('node:fs/promises');
      safeStorage.isEncryptionAvailable=()=>false;
      safeStorage.isAsyncEncryptionAvailable=async()=>false;
      const handlers=new Map(), handle=ipcMain.handle.bind(ipcMain);
      ipcMain.handle=(channel,listener)=>{handlers.set(channel,listener); return handle(channel,listener);};
      let event, armed=false, changed=false, late, replies=[];
      const originalFetch=globalThis.fetch;
      globalThis.fetch=async(...args)=>{
        const response=await originalFetch(...args);
        if(armed && String(args[0]).endsWith('/api/v1/connection')) {
          const copy=new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});
          return new Promise(resolve=>{
            replies.push(()=>resolve(copy));
            if(!changed){changed=true;setImmediate(()=>{
              fs.appendFileSync(${JSON.stringify(resolve(dist, "preload.cjs"))},'\\n// runtime modification\\n');
              powerMonitor.emit('resume');
            });}
          });
        }
        return response;
      };
      const rename=promises.rename;
      promises.rename=async(...args)=>{
        const result=await rename(...args);
        if(String(args[1]).endsWith('/integrity/lockdown.json')){
          for(const channel of ['suite:execute','suite:cache-read','suite:local-vault','suite:online-profiles','suite:local-device-open','suite:lan-receipts','suite:security-status']){
            try { await handlers.get(channel)(event); throw Error('Unexpected admission: '+channel); }
            catch(error){if(!error.message.includes('Application integrity failed'))throw error;}
          }
          replies.splice(0).forEach(release=>release());
          await late;
          process.stdout.write('ALL_FEATURES_GATED_AND_LATE_REPLY_REJECTED\\n');
        }
        return result;
      };
      app.on('browser-window-created',(_event,window)=>{
        window.webContents.once('did-finish-load',()=>{
          event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
          armed=true;
          late=handlers.get('suite:execute')(event,{operation:'connection'}).then(
            ()=>{throw Error('Late reply incorrectly succeeded');},
            error=>{if(!error.message.includes('Application integrity failed'))throw error;}
          );
          late.catch(()=>{});
        });
      });
      require(${JSON.stringify(resolve(dist, "main.cjs"))});
    `,
    );
    const result = await launchIntegrityProbe(entry, profile);
    expect(result.code, result.output.slice(-1800)).toBe(1);
    expect(result.output).toContain(
      "ALL_FEATURES_GATED_AND_LATE_REPLY_REJECTED",
    );
    expect(result.output).toContain("Application integrity failed during use.");
    expect(result.output).not.toContain("Integrity recording needs attention");
    const audit = resolve(profile, "integrity");
    const state = JSON.parse(
      await readFile(resolve(audit, "lockdown.json"), "utf8"),
    );
    expect(state.failure).toEqual({
      code: "changed-asset",
      asset: "preload.cjs",
    });
    expect(
      (await readdir(audit)).filter((name) => name.endsWith(".locked.json")),
    ).toHaveLength(1);
    expect(
      (await readdir(audit)).filter((name) => name.endsWith(".recovered.json")),
    ).toHaveLength(0);
    expect(
      await readFile(resolve(profile, "secure-cache/pending.bin")),
    ).toEqual(pending);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
