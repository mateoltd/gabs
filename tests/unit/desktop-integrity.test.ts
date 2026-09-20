import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { inspectAssets } from "../../apps/desktop/src/main/integrity/assets";
import { checkApplicationIntegrity } from "../../apps/desktop/src/main/integrity/startup";
import { IntegrityJournal } from "../../apps/desktop/src/main/integrity/journal";
// @ts-expect-error Build tooling intentionally remains executable JavaScript.
import { desktopIntegrityManifest } from "../../tooling/build/desktop-integrity.mjs";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "suite-integrity-"));
  directories.push(directory);
  const assets = resolve(directory, "dist"),
    profile = resolve(directory, "profile");
  for (const [name, value] of Object.entries({
    "main.cjs": "signed main anchors the manifest",
    "preload.cjs": "bridge",
    "cache-worker.cjs": "storage",
    "renderer/index.html": "<html></html>",
    "renderer/assets/app.js": "renderer",
    "vendor/sqlite/prebuilds/darwin-arm64.node": "native",
  })) {
    await mkdir(dirname(resolve(assets, name)), { recursive: true });
    await writeFile(resolve(assets, name), value);
  }
  await mkdir(resolve(profile, "secure-cache"), { recursive: true });
  await writeFile(
    resolve(profile, "secure-cache", "pending"),
    "retained encrypted data",
  );
  const manifest = await desktopIntegrityManifest(assets);
  return { directory, assets, profile, manifest };
}

describe("desktop installation integrity", () => {
  it("accepts its built inventory and rejects same-size changes to native code", async () => {
    const { assets, manifest } = await fixture();
    expect(manifest["main.cjs"]).toBeUndefined();
    expect(await inspectAssets(assets, manifest)).toBeUndefined();
    await writeFile(
      resolve(assets, "vendor/sqlite/prebuilds/darwin-arm64.node"),
      "edited",
    );
    expect(await inspectAssets(assets, manifest)).toEqual({
      code: "changed-asset",
      asset: "vendor/sqlite/prebuilds/darwin-arm64.node",
    });
  });
  it("rejects missing assets, injected files, symlinks and manifest traversal", async () => {
    const { assets, manifest, directory } = await fixture();
    await rm(resolve(assets, "preload.cjs"));
    expect(await inspectAssets(assets, manifest)).toEqual({
      code: "missing-asset",
      asset: "preload.cjs",
    });
    await writeFile(resolve(directory, "outside"), "bridge");
    await symlink(
      resolve(directory, "outside"),
      resolve(assets, "preload.cjs"),
    );
    expect(await inspectAssets(assets, manifest)).toEqual({
      code: "unexpected-asset",
    });
    await rm(resolve(assets, "preload.cjs"));
    await writeFile(resolve(assets, "preload.cjs"), "bridge");
    await writeFile(resolve(assets, "renderer/extra.js"), "injected");
    expect(await inspectAssets(assets, manifest)).toEqual({
      code: "unexpected-asset",
    });
    expect(
      await inspectAssets(assets, {
        ...manifest,
        "../outside": manifest["preload.cjs"],
      }),
    ).toEqual({ code: "invalid-manifest" });
    expect(
      await inspectAssets(assets, {
        ...manifest,
        ["a".repeat(513)]: manifest["preload.cjs"],
      }),
    ).toEqual({ code: "invalid-manifest" });
  });
  it("allows post-sign native bytes only with verified macOS coverage, without exempting preload", async () => {
    const { assets, manifest } = await fixture();
    await writeFile(
      resolve(assets, "vendor/sqlite/prebuilds/darwin-arm64.node"),
      "post-sign native bytes",
    );
    expect(await inspectAssets(assets, manifest, true)).toBeUndefined();
    await writeFile(resolve(assets, "preload.cjs"), "edited");
    expect(await inspectAssets(assets, manifest, true)).toEqual({
      code: "changed-asset",
      asset: "preload.cjs",
    });
  });
  it("requires a valid bundle signature before exempting post-sign native bytes", async () => {
    const options = await fixture();
    const result = await checkApplicationIntegrity({
      ...options,
      appPath: resolve(
        options.directory,
        "Unsigned.app/Contents/Resources/app.asar",
      ),
      packaged: true,
      platform: "darwin",
      release: "1.0.0",
    });
    expect(result).toEqual({ allowed: false, reason: "invalid-signature" });
  });
  it("records one incident across retries and recovery only after repair, retaining saved data", async () => {
    const options = await fixture();
    const check = () =>
      checkApplicationIntegrity({
        ...options,
        appPath: options.directory,
        packaged: false,
        platform: process.platform,
        release: "1.0.0",
      });
    await writeFile(resolve(options.assets, "cache-worker.cjs"), "broken!");
    expect(await check()).toEqual({ allowed: false, reason: "changed-asset" });
    expect(await check()).toEqual({ allowed: false, reason: "changed-asset" });
    const root = resolve(options.profile, "integrity");
    const blocked = JSON.parse(
      await readFile(resolve(root, "lockdown.json"), "utf8"),
    );
    expect(
      (await readdir(root)).filter((name) => name.endsWith(".locked.json")),
    ).toHaveLength(1);
    expect(
      (await readdir(root)).filter((name) => name.endsWith(".recovered.json")),
    ).toHaveLength(0);
    await writeFile(resolve(options.assets, "cache-worker.cjs"), "storage");
    expect(await check()).toEqual({ allowed: true });
    expect(await check()).toEqual({ allowed: true });
    expect(await readdir(root)).toEqual(
      expect.arrayContaining([
        `${blocked.id}.locked.json`,
        `${blocked.id}.recovered.json`,
      ]),
    );
    expect(await readdir(root)).toHaveLength(2);
    expect(
      await readFile(resolve(options.profile, "secure-cache/pending"), "utf8"),
    ).toBe("retained encrypted data");
  });
  it("finishes interrupted audit publication before clearing the persisted incident", async () => {
    const { profile } = await fixture();
    const root = resolve(profile, "integrity");
    const journal = new IntegrityJournal(root, "1.0.0-beta.1+build.2");
    await Promise.all([
      journal.record({ code: "changed-asset", asset: "preload.cjs" }),
      journal.record({ code: "changed-asset", asset: "preload.cjs" }),
    ]);
    const blocked = JSON.parse(
      await readFile(resolve(root, "lockdown.json"), "utf8"),
    );
    await rm(resolve(root, `${blocked.id}.locked.json`));
    expect(blocked.release).toBe("1.0.0-beta.1+build.2");
    await new IntegrityJournal(root, "1.0.1-rc.1+build.3").record();
    const recovery = JSON.parse(
      await readFile(resolve(root, `${blocked.id}.recovered.json`), "utf8"),
    );
    expect(recovery).toMatchObject({
      event: "recovered",
      release: "1.0.1-rc.1+build.3",
      incident: blocked,
    });
    expect(await readdir(root)).toHaveLength(2);
  });
  it("refuses failures it could not read back before writing audit state", async () => {
    const { profile } = await fixture();
    const root = resolve(profile, "integrity");
    const journal = new IntegrityJournal(root, "1.0.0");
    await expect(
      journal.record({ code: "future-failure" } as never),
    ).rejects.toThrow("Invalid integrity record");
    await expect(
      journal.record({
        code: "changed-asset",
        asset: "a".repeat(513),
      }),
    ).rejects.toThrow("Invalid integrity record");
    await expect(readFile(resolve(root, "lockdown.json"))).rejects.toThrow();
  });
  it("refuses a symlinked journal directory without changing retained files", async () => {
    const { directory, profile } = await fixture();
    const target = resolve(directory, "outside-integrity");
    await mkdir(target);
    await writeFile(resolve(target, "existing.json"), "retained audit bytes");
    await symlink(
      target,
      resolve(profile, "integrity"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      new IntegrityJournal(resolve(profile, "integrity"), "1.0.0").record({
        code: "changed-asset",
        asset: "preload.cjs",
      }),
    ).rejects.toThrow("ordinary directory");
    expect(await readdir(target)).toEqual(["existing.json"]);
    expect(await readFile(resolve(target, "existing.json"), "utf8")).toBe(
      "retained audit bytes",
    );
    expect(
      await readFile(resolve(profile, "secure-cache/pending"), "utf8"),
    ).toBe("retained encrypted data");
  });
  it("fails closed when audit state is corrupt and preserves the original bytes", async () => {
    const options = await fixture();
    await mkdir(resolve(options.profile, "integrity"));
    const path = resolve(options.profile, "integrity/lockdown.json");
    await writeFile(path, "partial original");
    expect(
      await checkApplicationIntegrity({
        ...options,
        appPath: options.directory,
        packaged: false,
        platform: process.platform,
        release: "1.0.0",
      }),
    ).toEqual({ allowed: false, reason: "audit-unavailable" });
    expect(await readFile(path, "utf8")).toBe("partial original");
  });
  it("keeps recovery pending until old-session invalidation succeeds", async () => {
    const { profile } = await fixture();
    const root = resolve(profile, "integrity");
    const journal = new IntegrityJournal(root, "1.0.0");
    await journal.record({ code: "changed-asset", asset: "preload.cjs" });
    await expect(
      journal.record(undefined, async () => {
        throw Error("Session cleanup unavailable");
      }),
    ).rejects.toThrow("Session cleanup unavailable");
    expect(await readdir(root)).toContain("lockdown.json");
    expect(
      (await readdir(root)).filter((name) => name.endsWith(".recovered.json")),
    ).toHaveLength(0);
    let cleared = false;
    await journal.record(undefined, async () => {
      cleared = true;
    });
    expect(cleared).toBe(true);
    expect(await readdir(root)).not.toContain("lockdown.json");
  });
});
