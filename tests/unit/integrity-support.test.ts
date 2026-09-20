import { IntegritySupport } from "../../apps/desktop/src/main/integrity/support";
// @ts-expect-error Build tooling intentionally remains executable JavaScript.
import { desktopIntegrityManifest } from "../../tooling/build/desktop-integrity.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  exportIntegrityReport,
  inspectIntegrity,
  integrityRepairPending,
} from "../../apps/desktop/src/main/integrity/report";
import { repairIntegrity } from "../../apps/desktop/src/main/integrity/repair";
import { IntegrityJournal } from "../../apps/desktop/src/main/integrity/journal";
import { parseIntegrityRepair } from "../../apps/desktop/src/main/integrity/format";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "suite-integrity-support-"));
  roots.push(root);
  const profile = resolve(root, "profile");
  await mkdir(resolve(profile, "integrity"), { recursive: true });
  await mkdir(resolve(profile, "secure-cache"));
  await writeFile(
    resolve(profile, "secure-cache/pending"),
    "original encrypted business data",
  );
  await writeFile(
    resolve(profile, "secure-cache/credentials.bin"),
    "stale credential",
  );
  await writeFile(
    resolve(profile, "integrity/lockdown.json"),
    "broken audit with private text",
  );
  const options = {
    profile,
    release: "1.0.0+support.1",
    inspect: async () => undefined,
    clearSession: () =>
      rm(resolve(profile, "secure-cache/credentials.bin"), { force: true }),
  };
  return { root, profile, options };
}
async function saved(profile: string) {
  expect(await readFile(resolve(profile, "secure-cache/pending"), "utf8")).toBe(
    "original encrypted business data",
  );
}

describe("integrity support and retained audit recovery", () => {
  it("connects the native recovery choices to report export and retained repair", async () => {
    const { root, profile, options } = await fixture();
    const assets = resolve(root, "dist");
    for (const name of [
      "main.cjs",
      "preload.cjs",
      "cache-worker.cjs",
      "renderer/index.html",
      "vendor/sqlite/prebuilds/darwin-arm64.node",
    ]) {
      await mkdir(dirname(resolve(assets, name)), { recursive: true });
      await writeFile(resolve(assets, name), name);
    }
    const manifest = await desktopIntegrityManifest(assets);
    const support = new IntegritySupport(
      () => ({
        assets,
        profile,
        manifest,
        release: options.release,
        packaged: false,
        platform: process.platform,
        appPath: root,
      }),
      options.clearSession,
    );
    const choices = [1, 2, 0];
    const messages: string[] = [];
    const dialog = {
      showMessageBox: vi.fn(async (input: { message: string }) => {
        messages.push(input.message);
        return { response: choices.shift() ?? 0, checkboxChecked: false };
      }),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: resolve(root, "native-report.json"),
      })),
    };
    await support.showFailure(dialog, "audit-unavailable");
    expect(
      JSON.parse(await readFile(resolve(root, "native-report.json"), "utf8"))
        .active.state,
    ).toBe("unreadable");
    expect(messages.at(-1)).toContain("sign in again");
    expect((await inspectIntegrity(profile, undefined)).retained).toHaveLength(
      1,
    );
    await saved(profile);
  });

  it("inspects without modifying evidence and exports only validated records to a new external file", async () => {
    const { root, profile } = await fixture();
    await writeFile(
      resolve(profile, "integrity/private-person-name"),
      "private business text",
    );
    const report = await inspectIntegrity(profile, {
      code: "missing-asset",
      asset: "preload.cjs",
    });
    expect(report.active).toMatchObject({
      state: "unreadable",
      unrecognizedEntries: 1,
      records: [{ name: "lockdown.json", state: "unreadable" }],
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private|stale credential|encrypted business/,
    );
    const destination = resolve(root, "report.json");
    await exportIntegrityReport(profile, destination, report);
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(report);
    await expect(
      exportIntegrityReport(profile, destination, report),
    ).rejects.toThrow();
    await expect(
      exportIntegrityReport(profile, resolve(profile, "report.json"), report),
    ).rejects.toThrow("outside application data");
    await symlink(
      profile,
      resolve(root, "profile-alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      exportIntegrityReport(
        profile,
        resolve(root, "profile-alias/report.json"),
        report,
      ),
    ).rejects.toThrow("outside application data");
    expect(
      await readFile(resolve(profile, "integrity/lockdown.json"), "utf8"),
    ).toBe("broken audit with private text");
    expect(await integrityRepairPending(profile)).toBe(false);
    await saved(profile);
  });
  it("does not create missing audit directories or follow linked evidence", async () => {
    const { root, profile } = await fixture();
    const missing = resolve(root, "missing");
    expect((await inspectIntegrity(missing, undefined)).active.state).toBe(
      "missing",
    );
    expect(await readdir(root)).not.toContain("missing");
    await rm(resolve(profile, "integrity"), { recursive: true });
    await symlink(
      resolve(profile, "secure-cache"),
      resolve(profile, "integrity"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await inspectIntegrity(profile, undefined)).active.state).toBe(
      "unreadable",
    );
    await saved(profile);
  });
  it("refuses a linked recovery marker without reading or changing its target", async () => {
    const { root, profile, options } = await fixture();
    const source = resolve(root, "external-marker.json");
    const content = JSON.stringify({
      version: 1,
      kind: "audit-repair",
      id: randomUUID(),
      at: new Date().toISOString(),
      release: options.release,
    });
    await writeFile(source, content);
    await symlink(source, resolve(profile, "integrity-repair.json"), "file");
    expect((await inspectIntegrity(profile, undefined)).pending.state).toBe(
      "unreadable",
    );
    await expect(repairIntegrity(options)).rejects.toThrow();
    expect(await readFile(source, "utf8")).toBe(content);
    expect(await readdir(profile)).toEqual([
      "integrity",
      "integrity-repair.json",
      "secure-cache",
    ]);
    await saved(profile);
  });
  it("retains corrupt originals, invalidates the old session and makes a linked duplicate-safe recovery", async () => {
    const { profile, options } = await fixture();
    const result = await repairIntegrity(options);
    expect(result.changed).toBe(true);
    if (!result.changed) throw Error("Expected recovery");
    expect(
      await readFile(
        resolve(profile, result.retained, "lockdown.json"),
        "utf8",
      ),
    ).toBe("broken audit with private text");
    expect(await readdir(resolve(profile, "secure-cache"))).toEqual([
      "pending",
    ]);
    const report = await inspectIntegrity(profile, undefined);
    expect(report.active.state).toBe("readable");
    expect(report.active.records).toHaveLength(3);
    expect(report.retained).toHaveLength(1);
    expect(report.retained[0].audit.state).toBe("unreadable");
    expect(report.pending.state).toBe("none");
    expect(await repairIntegrity(options)).toEqual({ changed: false });
    expect((await inspectIntegrity(profile, undefined)).retained).toHaveLength(
      1,
    );
    await saved(profile);
  });
  it("refuses an invalid installation before creating or moving recovery records", async () => {
    const { profile, options } = await fixture();
    await expect(
      repairIntegrity({
        ...options,
        inspect: async () => ({ code: "changed-asset", asset: "preload.cjs" }),
      }),
    ).rejects.toThrow("installation");
    expect(await readdir(profile)).toEqual(["integrity", "secure-cache"]);
    expect(
      await readFile(resolve(profile, "secure-cache/credentials.bin"), "utf8"),
    ).toBe("stale credential");
    await saved(profile);
  });
  it("keeps recovery pending and the original audit active when session cleanup fails", async () => {
    const { profile, options } = await fixture();
    await expect(
      repairIntegrity({
        ...options,
        clearSession: async () => {
          throw Error("Disk unavailable");
        },
      }),
    ).rejects.toThrow("Disk unavailable");
    expect(await integrityRepairPending(profile)).toBe(true);
    expect(
      await readFile(resolve(profile, "integrity/lockdown.json"), "utf8"),
    ).toBe("broken audit with private text");
    await repairIntegrity(options);
    expect(await integrityRepairPending(profile)).toBe(false);
    expect(
      (await inspectIntegrity(profile, undefined)).active.records,
    ).toHaveLength(3);
    await saved(profile);
  });
  for (const boundary of ["retained", "promoted"] as const)
    it(`resumes a persisted ${boundary} boundary without replacing retained evidence`, async () => {
      const { profile, options } = await fixture();
      const repair = parseIntegrityRepair({
        version: 1,
        kind: "audit-repair",
        id: randomUUID(),
        at: new Date().toISOString(),
        release: options.release,
      });
      await writeFile(
        resolve(profile, "integrity-repair.json"),
        JSON.stringify(repair),
      );
      const staged = resolve(profile, `integrity-staged-${repair.id}`);
      await mkdir(staged);
      await writeFile(resolve(staged, "repair.json"), JSON.stringify(repair));
      await writeFile(
        resolve(staged, "lockdown.json"),
        JSON.stringify({
          id: repair.id,
          at: repair.at,
          release: repair.release,
          failure: { code: "unreadable-audit" },
        }),
      );
      await new IntegrityJournal(staged, repair.release).record(
        undefined,
        options.clearSession,
      );
      await rename(
        resolve(profile, "integrity"),
        resolve(profile, `integrity-retained-${repair.id}`),
      );
      if (boundary === "promoted")
        await rename(staged, resolve(profile, "integrity"));
      const result = await repairIntegrity(options);
      expect(result).toEqual({
        changed: true,
        retained: `integrity-retained-${repair.id}`,
      });
      expect(
        (await inspectIntegrity(profile, undefined)).active.records,
      ).toHaveLength(3);
      expect(
        await readFile(
          resolve(profile, `integrity-retained-${repair.id}/lockdown.json`),
          "utf8",
        ),
      ).toBe("broken audit with private text");
      await saved(profile);
    });
  it("retains unreadable repair markers and refuses ambiguous staged content", async () => {
    const { profile, options } = await fixture();
    await writeFile(
      resolve(profile, "integrity-repair.json"),
      "partial marker",
    );
    await expect(repairIntegrity(options)).rejects.toThrow();
    expect((await inspectIntegrity(profile, undefined)).pending.state).toBe(
      "unreadable",
    );
    expect(
      await readFile(resolve(profile, "integrity-repair.json"), "utf8"),
    ).toBe("partial marker");
    const repair = {
      version: 1,
      kind: "audit-repair",
      id: randomUUID(),
      at: new Date().toISOString(),
      release: options.release,
    };
    await writeFile(
      resolve(profile, "integrity-repair.json"),
      JSON.stringify(repair),
    );
    await mkdir(resolve(profile, `integrity-staged-${repair.id}`));
    await writeFile(
      resolve(profile, `integrity-staged-${repair.id}/unrelated`),
      "retained",
    );
    await expect(repairIntegrity(options)).rejects.toThrow(
      "Unrecognized integrity staging",
    );
    expect(
      await readFile(
        resolve(profile, `integrity-staged-${repair.id}/unrelated`),
        "utf8",
      ),
    ).toBe("retained");
    await saved(profile);
  });
});
