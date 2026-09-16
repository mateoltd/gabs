import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { identifier, type ModuleDefinition } from "@suite/module-sdk";
import { validateFixtures } from "@suite/module-sdk/simulator";

export function moduleDirectory(name: string) {
  return identifier.test(name) ? resolve("modules", name) : resolve(name);
}

/** Check the module's own graph, including custom views and scenarios outside the catalog. */
export async function checkModuleSources(directory: string) {
  const roots: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git", ".local"].includes(entry.name))
        continue;
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (/\.[cm]?tsx?$/.test(entry.name)) roots.push(child);
    }
  }
  await walk(directory);
  if (!roots.includes(resolve(directory, "module.ts")))
    throw Error(`Missing module entry: ${resolve(directory, "module.ts")}`);
  const configPath =
    ts.findConfigFile(directory, ts.sys.fileExists) ??
    fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config ?? {},
    ts.sys,
    dirname(configPath),
  );
  const program = ts.createProgram(roots, {
    ...parsed.options,
    strict: true,
    noEmit: true,
    incremental: false,
    composite: false,
  });
  const diagnostics = [
    ...(config.error ? [config.error] : []),
    ...parsed.errors.filter((error) => error.code !== 18003),
    ...ts.getPreEmitDiagnostics(program),
  ];
  if (diagnostics.length)
    throw Error(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
      }),
    );
}

export async function loadModuleWorkspace(directory: string) {
  const module = (
    await import(pathToFileURL(resolve(directory, "module.ts")).href)
  ).default as ModuleDefinition;
  let fixtures = {};
  try {
    fixtures = JSON.parse(
      await readFile(resolve(directory, "fixtures.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  validateFixtures(module, fixtures);
  return { module, fixtures, directory };
}
