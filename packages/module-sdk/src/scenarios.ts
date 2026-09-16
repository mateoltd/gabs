import { assertSchema, type ModuleDefinition } from "./index";
import { canonical } from "./registry";
import {
  createModuleSimulator,
  type ModuleFixtures,
  type SimulatorOptions,
} from "./simulator";

export type ModuleSimulation<M extends ModuleDefinition> = ReturnType<
  typeof createModuleSimulator<M>
>;

export type ModuleScenarios<M extends ModuleDefinition> =
  SimulatorOptions<M> & {
    module: M;
    scenarios: Record<
      string,
      (simulation: ModuleSimulation<M>) => Promise<void>
    >;
  };

/** Each named scenario receives a fresh simulator and an inferred module client. */
export function defineModuleScenarios<const M extends ModuleDefinition>(
  module: M,
  options: Omit<ModuleScenarios<M>, "module">,
): ModuleScenarios<M> {
  if (!Object.keys(options.scenarios).length)
    throw Error("Declare at least one module scenario.");
  for (const [name, scenario] of Object.entries(options.scenarios))
    if (!name.trim() || typeof scenario !== "function")
      throw Error("Every module scenario needs a name and an async function.");
  if (options.configuration !== undefined)
    assertSchema(module.configuration, options.configuration);
  if (options.server && canonical(options.server.module) !== canonical(module))
    throw Error("The scenario server must match the module contract exactly.");
  return { ...options, module };
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  error?: string;
}

/** Run module-owned development examples; these are not authoritative server acceptance. */
export async function runModuleScenarios<M extends ModuleDefinition>(
  suite: ModuleScenarios<M>,
  options: {
    fixtures?: ModuleFixtures<M>;
    simulation?: SimulatorOptions<M>;
    start?: (name: string) => void;
    report?: (result: ScenarioResult) => void;
  } = {},
): Promise<ScenarioResult[]> {
  // Revalidate imported definitions, including plain JavaScript scenario files.
  const effective = { ...options.simulation, ...suite };
  defineModuleScenarios(suite.module, effective);
  const results: ScenarioResult[] = [];
  for (const [name, scenario] of Object.entries(suite.scenarios)) {
    options.start?.(name);
    let result: ScenarioResult;
    try {
      const simulation = createModuleSimulator(suite.module, {
        ...effective,
        fixtures: effective.fixtures ?? options.fixtures,
      });
      await scenario(simulation);
      result = { name, passed: true };
    } catch (error) {
      result = {
        name,
        passed: false,
        error:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      };
    }
    results.push(result);
    options.report?.(result);
  }
  return results;
}
