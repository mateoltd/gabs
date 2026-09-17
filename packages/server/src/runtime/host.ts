import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import type { ModuleDefinition } from "@suite/module-sdk";
import type { Permission } from "@suite/contracts";

export interface WorkspacePreset {
  moduleIds: readonly string[];
  rolePresets: Readonly<Record<string, readonly Permission[]>>;
  serviceGrants: readonly {
    source: string;
    target: string;
    services: readonly string[];
  }[];
}

export interface ServerRuntime {
  catalog: ModuleCatalog;
  preset: WorkspacePreset;
  moduleDefaults?: readonly ModuleDefinition[];
}
