import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "@suite/module-sdk/registry";
import {
  runModuleScenarios,
  type ModuleScenarios,
} from "@suite/module-sdk/scenarios";
import type { ModuleDefinition } from "@suite/module-sdk";
import { loadSimulationGraph } from "./simulation";

const directory = resolve(process.argv[2]);
const simulation = await loadSimulationGraph(directory, process.argv.slice(3));
const { module } = simulation;
const entry = resolve(directory, "module.scenarios.ts");
try {
  await access(entry);
} catch {
  throw Error(
    `No module-owned scenarios at ${entry}. Export defineModuleScenarios(module, { scenarios: { ... } }) as default.`,
  );
}
const suite = (await import(pathToFileURL(entry).href))
  .default as ModuleScenarios<ModuleDefinition>;
if (!suite?.module || canonical(suite.module) !== canonical(module))
  throw Error(
    `Scenario contract differs from ${module.id}@${module.version}. Import this directory's module.ts.`,
  );
const results = await runModuleScenarios(suite, {
  simulation,
  start(name) {
    console.log(`RUN ${module.id}: ${name}`);
  },
  report(result) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${module.id}: ${result.name}`,
    );
    if (result.error) console.error(result.error);
  },
});
console.log(
  `${results.filter((result) => result.passed).length}/${results.length} module-owned scenarios passed.`,
);
// Terminate detached author timers too; scenario files are trusted developer code.
process.exit(results.every((result) => result.passed) ? 0 : 1);
