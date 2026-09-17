import type { ModuleDefinition } from "../index";

export interface ModuleCatalog {
  readonly bundled: readonly ModuleDefinition[];
  readonly modules: readonly ModuleDefinition[];
  definition(id: string): ModuleDefinition | undefined;
  dependencies(id: string): string[];
}

export interface MutableModuleCatalog extends ModuleCatalog {
  register(module: ModuleDefinition): void;
}

export function createModuleCatalog(
  bundled: readonly ModuleDefinition[],
): MutableModuleCatalog {
  const modules = [...bundled];
  const definition = (id: string) => modules.find((module) => module.id === id);
  const dependencies = (id: string, path: string[] = []): string[] => {
    if (path.includes(id))
      throw Error("Circular module dependency: " + [...path, id].join(" -> "));
    const module = definition(id);
    if (!module) throw Error("Unknown module: " + id);
    return [
      ...new Set([
        ...Object.keys(module.dependencies).flatMap((dependency) =>
          dependencies(dependency, [...path, id]),
        ),
        id,
      ]),
    ];
  };
  return {
    bundled: Object.freeze([...bundled]),
    modules,
    definition,
    dependencies,
    register(module) {
      const index = modules.findIndex(
        (candidate) => candidate.id === module.id,
      );
      if (index < 0) modules.push(module);
      else modules[index] = module;
    },
  };
}
