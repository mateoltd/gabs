import { expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { modulePackageManifest } from "../../tooling/modules/workspace";

it("reconciles generated module dependencies without changing hand-owned dependencies", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "suite-discovery-"));
  const moduleDirectory = resolve(root, "modules", "equipment");
  const manifestPath = resolve(root, "composition", "package.json");
  const discover = () => {
    const result = spawnSync(
      process.execPath,
      ["tooling/modules/discover-modules.mjs", "--root", root],
      { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  };
  try {
    await mkdir(resolve(root, "composition", "src", "catalog"), {
      recursive: true,
    });
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        name: "@fixture/composition",
        dependencies: {
          "@suite/client": "workspace:*",
          "@suite/removed": "workspace:*",
        },
        suite: { generatedModuleDependencies: ["@suite/removed"] },
      }),
    );
    const scaffold = modulePackageManifest("equipment");
    expect(scaffold.exports).toEqual({
      ".": "./module.ts",
      "./module-server": "./module-server.ts",
      "./module-local": "./module-local.ts",
    });
    await writeFile(
      resolve(moduleDirectory, "package.json"),
      JSON.stringify(scaffold),
    );
    await writeFile(
      resolve(moduleDirectory, "module.ts"),
      "export default {};",
    );

    discover();
    const added = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(added.dependencies).toEqual({
      "@suite/client": "workspace:*",
      "@suite/equipment": "workspace:*",
    });
    expect(added.suite.generatedModuleDependencies).toEqual([
      "@suite/equipment",
    ]);

    await rm(moduleDirectory, { recursive: true });
    discover();
    const removed = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(removed.dependencies).toEqual({ "@suite/client": "workspace:*" });
    expect(removed.suite.generatedModuleDependencies).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
