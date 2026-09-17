import type { ModuleDefinition } from "../authoring/module";

export interface SignedPackage {
  module_id: string;
  version: string;
  manifest: Record<string, unknown>;
  artifact: Record<string, unknown>;
  digest: string;
  signature: string;
  key_id: string;
}

export interface ServerPackage {
  payload: {
    format: "suite-server-v1";
    module: ModuleDefinition;
    javascript: string;
  };
  digest: string;
  key_id: string;
  signature: string;
}
