import { test, expect } from "@playwright/test";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { launchIntegrityProbe } from "../support/integrity-process";

async function fixture() {
  const directory = await mkdtemp(
    resolve(tmpdir(), "suite-native-integrity-support-"),
  );
  const profile = resolve(directory, "profile"),
    dist = resolve(directory, "dist"),
    entry = resolve(directory, "entry.cjs");
  try {
    await cp(resolve("apps/desktop/dist"), dist, { recursive: true });
    await mkdir(resolve(profile, "integrity"), { recursive: true });
    await mkdir(resolve(profile, "secure-cache"));
    await writeFile(
      resolve(profile, "integrity/lockdown.json"),
      "private broken audit bytes",
    );
    await writeFile(
      resolve(profile, "secure-cache/pending.bin"),
      "original saved work",
    );
    for (const name of ["credentials", "identity"])
      await writeFile(
        resolve(profile, `secure-cache/${name}.bin`),
        "old session",
      );
    const bootstrap = async (boundary = "") =>
      writeFile(
        entry,
        `
      const {app,safeStorage,utilityProcess}=require('electron');
      const fs=require('node:fs/promises');
      safeStorage.isEncryptionAvailable=()=>false;
      safeStorage.isAsyncEncryptionAvailable=async()=>false;
      utilityProcess.fork=()=>{process.stdout.write('UNEXPECTED_STORAGE_OPEN\\n');throw Error('No storage during support');};
      app.on('browser-window-created',()=>{process.stdout.write('WINDOW_CREATED\\n');setImmediate(()=>app.exit(0));});
      const rename=fs.rename;
      fs.rename=async(from,to)=>{
        if(${JSON.stringify(boundary)}==='staged-marker' && String(to).includes('integrity-staged-') && String(to).endsWith('/repair.json')) process.exit(74);
        const result=await rename(from,to);
        if(${JSON.stringify(boundary)}==='retained' && String(to).includes('integrity-retained-')) process.exit(74);
        if(${JSON.stringify(boundary)}==='promoted' && String(from).includes('integrity-staged-') && String(to).endsWith('/integrity')) process.exit(74);
        return result;
      };
      require(${JSON.stringify(resolve(dist, "main.cjs"))});
    `,
      );
    await bootstrap();
    return { directory, profile, dist, entry, bootstrap };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

test("compiled support commands inspect, export and repair without opening business storage", async () => {
  const f = await fixture();
  try {
    const launch = (...args: string[]) =>
      launchIntegrityProbe(f.entry, f.profile, args);
    const initial = await launch();
    expect(initial.code).toBe(1);
    expect(initial.output).toContain("audit-unavailable");
    expect(initial.output).not.toContain("WINDOW_CREATED");
    const inspected = await launch("--inspect-integrity");
    expect(inspected.code, inspected.output).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      kind: "integrity-report",
      active: { state: "unreadable" },
    });
    expect(inspected.output).not.toContain("private broken audit bytes");
    const destination = resolve(f.directory, "report.json");
    expect((await launch(`--export-integrity=${destination}`)).code).toBe(0);
    const report = JSON.parse(await readFile(destination, "utf8"));
    expect(report.active.state).toBe("unreadable");
    expect(report.installation.state).toBe("verified");
    expect((await launch(`--export-integrity=${destination}`)).code).toBe(1);
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(report);
    expect(
      (await launch("--repair-integrity", "--inspect-integrity")).code,
    ).toBe(1);
    const preload = resolve(f.dist, "preload.cjs"),
      original = await readFile(preload);
    await writeFile(preload, "corrupt");
    expect((await launch("--repair-integrity")).code).toBe(1);
    expect(await readdir(f.profile)).not.toContain("integrity-repair.json");
    await writeFile(preload, original);
    const repaired = await launch("--repair-integrity");
    expect(repaired.code, repaired.output).toBe(0);
    expect(repaired.output).toContain("sign in again");
    expect(repaired.output).not.toContain("WINDOW_CREATED");
    expect(repaired.output).not.toContain("UNEXPECTED_STORAGE_OPEN");
    expect(await readdir(resolve(f.profile, "secure-cache"))).toEqual([
      "pending.bin",
    ]);
    const retained = (await readdir(f.profile)).filter((name) =>
      name.startsWith("integrity-retained-"),
    );
    expect(retained).toHaveLength(1);
    expect(
      await readFile(resolve(f.profile, retained[0], "lockdown.json"), "utf8"),
    ).toBe("private broken audit bytes");
    const repeated = await launch("--repair-integrity");
    expect(repeated.code).toBe(0);
    expect(repeated.output).toContain("No unreadable integrity records");
    const opened = await launch();
    expect(opened.code, opened.output).toBe(0);
    expect(opened.output).toContain("WINDOW_CREATED");
    expect(opened.output).not.toContain("UNEXPECTED_STORAGE_OPEN");
    expect(
      await readFile(resolve(f.profile, "secure-cache/pending.bin"), "utf8"),
    ).toBe("original saved work");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
for (const boundary of ["staged-marker", "retained", "promoted"])
  test(`compiled audit repair resumes after process exit at ${boundary}`, async () => {
    const f = await fixture();
    try {
      await f.bootstrap(boundary);
      const interrupted = await launchIntegrityProbe(f.entry, f.profile, [
        "--repair-integrity",
      ]);
      expect(interrupted.code, interrupted.output).toBe(74);
      await f.bootstrap();
      const locked = await launchIntegrityProbe(f.entry, f.profile);
      expect(locked.code).toBe(1);
      expect(locked.output).toContain("audit-repair-pending");
      expect(locked.output).not.toContain("WINDOW_CREATED");
      const resumed = await launchIntegrityProbe(f.entry, f.profile, [
        "--repair-integrity",
      ]);
      expect(resumed.code, resumed.output).toBe(0);
      const records = await readdir(resolve(f.profile, "integrity"));
      expect(
        records.filter((name) => name.endsWith(".locked.json")),
      ).toHaveLength(1);
      expect(
        records.filter((name) => name.endsWith(".recovered.json")),
      ).toHaveLength(1);
      expect(records).not.toContain("lockdown.json");
      const retained = (await readdir(f.profile)).filter((name) =>
        name.startsWith("integrity-retained-"),
      );
      expect(retained).toHaveLength(1);
      expect(
        await readFile(
          resolve(f.profile, retained[0], "lockdown.json"),
          "utf8",
        ),
      ).toBe("private broken audit bytes");
      expect(
        await readFile(resolve(f.profile, "secure-cache/pending.bin"), "utf8"),
      ).toBe("original saved work");
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
