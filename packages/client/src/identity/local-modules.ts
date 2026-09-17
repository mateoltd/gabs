import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import type { LocalData } from "./local-profiles";

export function installedLocalModules(data: LocalData): ModuleDefinition[] {
  return Object.values(data.modules ?? {})
    .filter((m) => m.active)
    .map((m) =>
      hydrateModule(moduleContract(m.releases[m.version].package.artifact)),
    );
}

/** Bundled defaults and installed releases, excluding explicit removals. */
export function availableLocalModules(
  data: LocalData,
  catalog: ModuleCatalog,
): ModuleDefinition[] {
  const available = new Map(catalog.bundled.map((m) => [m.id, m]));
  for (const [id, installation] of Object.entries(data.modules ?? {}))
    if (!installation.active) available.delete(id);
  for (const module of installedLocalModules(data))
    available.set(module.id, module);
  return [...available.values()];
}
