import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ScopedModuleServer } from "@suite/module-sdk/server";
import { assertSchema } from "@suite/module-sdk";
import type { SimulationModule } from "@suite/module-sdk/simulator";
import { canonical, resolveReleases } from "@suite/module-sdk/registry";
import { moduleDefinitions } from "@suite/module-catalog";
import { loadModuleWorkspace } from "./module-workspace";

export function dependencyDirectories(args: string[]) {
  const directories: string[] = [];
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== "--dependency" || !args[index + 1])
      throw Error(
        "Use --dependency <provider-directory> for each development dependency.",
      );
    directories.push(resolve(args[index + 1]));
  }
  return [...new Set(directories)];
}
async function optionalImport(path: string): Promise<unknown> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return (await import(pathToFileURL(path).href)).default;
}
/** Development code only. No provider is granted access merely by being loaded. */
export async function loadSimulationWorkspace(
  directory: string,
): Promise<SimulationModule> {
  const { module, fixtures } = await loadModuleWorkspace(directory);
  let configuration: unknown;
  try {
    configuration = JSON.parse(
      await readFile(resolve(directory, "configuration.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (configuration !== undefined)
    assertSchema(module.configuration, configuration);
  const server = (await optionalImport(
    resolve(directory, "module-server.ts"),
  )) as ScopedModuleServer | undefined;
  const simulation = (await optionalImport(
    resolve(directory, "module.simulation.ts"),
  )) as SimulationModule | undefined;
  if (simulation && canonical(simulation.module) !== canonical(module))
    throw Error(
      `Simulation contract differs from ${module.id}@${module.version}. Import this directory's module.ts.`,
    );
  return {
    module,
    fixtures,
    ...(configuration === undefined
      ? {}
      : { configuration: configuration as Record<string, unknown> }),
    server,
    ...simulation,
  };
}
export async function loadSimulationGraph(
  directory: string,
  dependencies: string[],
) {
  const root = await loadSimulationWorkspace(directory),
    providers: SimulationModule[] = [];
  for (const path of dependencies)
    providers.push(await loadSimulationWorkspace(path));
  const ids = [root, ...providers].map((fixture) => fixture.module.id);
  if (new Set(ids).size !== ids.length)
    throw Error(
      "Development dependency directories must have distinct module IDs.",
    );
  resolveReleases(
    root.module.id,
    [
      ...moduleDefinitions.filter((module) => !ids.includes(module.id)),
      ...[root, ...providers].map((fixture) => fixture.module),
    ],
    "1.0.0",
    "1.0.0",
  );
  return { ...root, providers };
}
