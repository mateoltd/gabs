import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// The production checker is an executable ESM script with named test exports.
// @ts-expect-error JavaScript tooling intentionally has no declaration package.
import { analyzeArchitecture } from "../../tooling/verification/check-boundaries.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture(files: Record<string, string | object>) {
  const root = await mkdtemp(join(tmpdir(), "suite-architecture-"));
  roots.push(root);
  for (const [name, value] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      name.endsWith("package.json")
        ? JSON.stringify(value, null, 2)
        : String(value),
    );
  }
  return root;
}

const manifest = (
  name: string,
  exports: string | Record<string, unknown> | undefined,
  dependencies: Record<string, string> = {},
) => ({
  name,
  private: true,
  type: "module",
  exports,
  dependencies,
});

describe("architecture boundaries", () => {
  it("rejects a transitive browser to Node dependency", async () => {
    const root = await fixture({
      "apps/web/package.json": manifest("@fixture/web", undefined, {
        "@fixture/shared": "workspace:*",
      }),
      "apps/web/src/main.ts": 'import "@fixture/shared";',
      "packages/shared/package.json": manifest(
        "@fixture/shared",
        "./src/index.ts",
      ),
      "packages/shared/src/index.ts": 'export { read } from "./bridge";',
      "packages/shared/src/bridge.ts":
        'import { readFileSync } from "node:fs";\nexport const read = readFileSync;',
    });

    expect(analyzeArchitecture(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("browser runtime reaches Node/server code"),
      ]),
    );
  });

  it("rejects undeclared cross-module implementation imports", async () => {
    const root = await fixture({
      "modules/contacts/package.json": manifest(
        "@fixture/contacts",
        "./module.ts",
      ),
      "modules/contacts/module.ts":
        'import { privateProject } from "@fixture/projects/server";\nexport default privateProject;',
      "modules/projects/package.json": manifest("@fixture/projects", {
        ".": "./module.ts",
        "./server": "./server/index.ts",
      }),
      "modules/projects/module.ts": "export default {};",
      "modules/projects/server/index.ts": "export const privateProject = {};",
    });

    const issues = analyzeArchitecture(root);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("undeclared workspace dependency"),
        expect.stringContaining("cross-module implementation dependency"),
      ]),
    );
  });

  it("rejects product composition imported by shared contracts", async () => {
    const root = await fixture({
      "packages/contracts/package.json": manifest(
        "@fixture/contracts",
        "./src/index.ts",
        { "@fixture/composition": "workspace:*" },
      ),
      "packages/contracts/src/index.ts":
        'export type Catalog = import("@fixture/composition").Catalog;',
      "composition/package.json": manifest(
        "@fixture/composition",
        "./src/index.ts",
      ),
      "composition/src/index.ts": "export interface Catalog { size: number }",
    });

    expect(analyzeArchitecture(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "contracts package cannot depend on composition package",
        ),
      ]),
    );
  });

  it("does not skip unresolved internal imports", async () => {
    const root = await fixture({
      "packages/shared/package.json": manifest(
        "@fixture/shared",
        "./src/index.ts",
      ),
      "packages/shared/src/index.ts": 'export { missing } from "./missing";',
    });

    expect(analyzeArchitecture(root)).toEqual([
      "packages/shared/src/index.ts: unresolved internal import ./missing",
    ]);
  });

  it("allows public type-only module and environment edges", async () => {
    const root = await fixture({
      "apps/web/package.json": manifest("@fixture/web", undefined, {
        "@fixture/shared": "workspace:*",
        "@fixture/node-runtime": "workspace:*",
      }),
      "apps/web/src/main.ts":
        'import { value } from "@fixture/shared";\nimport type { NodeConfig } from "@fixture/node-runtime";\nexport const output: NodeConfig = { value };',
      "apps/web/vite.config.ts":
        'import { resolve } from "node:path";\nexport default { root: resolve("src") };',
      "packages/shared/package.json": manifest(
        "@fixture/shared",
        "./src/index.ts",
      ),
      "packages/shared/src/index.ts": "export const value = 1;",
      "packages/node-runtime/package.json": manifest(
        "@fixture/node-runtime",
        "./src/index.ts",
      ),
      "packages/node-runtime/src/index.ts":
        'import { readFileSync } from "node:fs";\nexport interface NodeConfig { value: number }\nexport const read = readFileSync;',
      "modules/contacts/package.json": manifest(
        "@fixture/contacts",
        "./module.ts",
        { "@fixture/projects": "workspace:*" },
      ),
      "modules/contacts/module.ts":
        'import type { Project } from "@fixture/projects/contracts";\nexport const project: Project | undefined = undefined;',
      "modules/projects/package.json": manifest("@fixture/projects", {
        ".": "./module.ts",
        "./contracts": "./contracts/index.ts",
      }),
      "modules/projects/module.ts": "export default {};",
      "modules/projects/contracts/index.ts":
        "export interface Project { id: string }",
    });

    expect(analyzeArchitecture(root)).toEqual([]);
  });

  it("rejects DOM dependencies reached by a local worker", async () => {
    const root = await fixture({
      "composition/package.json": manifest(
        "@fixture/composition",
        "./src/index.ts",
        { "@fixture/ui": "workspace:*" },
      ),
      "composition/src/index.ts": "export {};",
      "composition/src/local/worker-entry.ts": 'import "@fixture/ui";',
      "packages/ui/web/package.json": manifest(
        "@fixture/ui",
        "./src/index.tsx",
        { react: "*" },
      ),
      "packages/ui/web/src/index.tsx":
        'import React from "react";\nexport const View = () => React.createElement("div");',
    });

    expect(analyzeArchitecture(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("worker runtime reaches DOM/UI code"),
      ]),
    );
  });

  it("checks dormant portable SDK and contract files without rejecting type-only UI contracts", async () => {
    const root = await fixture({
      "packages/sdk/package.json": manifest(
        "@fixture/sdk",
        {
          ".": "./src/index.ts",
          "./ui": "./src/contracts/ui.ts",
        },
        { react: "*" },
      ),
      "packages/sdk/src/index.ts": "export {};",
      "packages/sdk/src/contracts/ui.ts":
        'import type { ComponentType } from "react";\nexport type View = ComponentType<{}>;',
      "packages/sdk/src/dormant-node.ts":
        'import { readFileSync } from "node:fs";\nexport const read = readFileSync;',
      "packages/contracts/package.json": manifest(
        "@fixture/contracts",
        "./src/index.ts",
        { react: "*" },
      ),
      "packages/contracts/src/index.ts": "export {};",
      "packages/contracts/src/dormant-view.ts":
        'import React from "react";\nexport const view = React.createElement("div");',
    });

    const issues = analyzeArchitecture(root);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "packages/sdk/src/dormant-node.ts: portable runtime reaches Node/server code",
        ),
        expect.stringContaining(
          "packages/contracts/src/dormant-view.ts: portable runtime reaches DOM/UI code",
        ),
      ]),
    );
    expect(issues).toHaveLength(2);
  });

  it("resolves conditional wildcard exports before enforcing module boundaries", async () => {
    const root = await fixture({
      "modules/contacts/package.json": manifest(
        "@fixture/contacts",
        "./module.ts",
        { "@fixture/projects": "workspace:*" },
      ),
      "modules/contacts/module.ts":
        'import project from "@fixture/projects/releases/1.0.0/module";\nexport default project;',
      "modules/projects/package.json": manifest("@fixture/projects", {
        ".": "./module.ts",
        "./releases/*/module": {
          types: "./releases/*/module.ts",
          import: "./releases/*/module.ts",
        },
      }),
      "modules/projects/module.ts": "export default {};",
      "modules/projects/releases/1.0.0/module.ts": "export default {};",
    });

    expect(analyzeArchitecture(root)).toEqual([
      expect.stringContaining("module package cannot depend on module package"),
      expect.stringContaining("cross-module implementation dependency"),
    ]);
  });

  it("accepts a declared conditional wildcard export from an application", async () => {
    const root = await fixture({
      "apps/api/package.json": manifest("@fixture/api", undefined, {
        "@fixture/projects": "workspace:*",
      }),
      "apps/api/src/main.ts":
        'import project from "@fixture/projects/releases/1.0.0/module";\nexport default project;',
      "modules/projects/package.json": manifest("@fixture/projects", {
        ".": "./module.ts",
        "./releases/*/module": {
          types: "./releases/*/module.ts",
          import: "./releases/*/module.ts",
        },
      }),
      "modules/projects/module.ts": "export default {};",
      "modules/projects/releases/1.0.0/module.ts": "export default {};",
    });

    expect(analyzeArchitecture(root)).toEqual([]);
  });
});
