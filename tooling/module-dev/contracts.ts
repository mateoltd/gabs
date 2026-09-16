import type { ModuleCall, ModuleDefinition } from "@suite/module-sdk";
import type { ClientBundles } from "@suite/module-sdk/client-artifact";
import type { SimulatorSnapshot } from "@suite/module-sdk/simulator";

export type DevAction =
  | { action: "network"; online: boolean }
  | { action: "permissions"; permissions: string[] }
  | { action: "sync" }
  | { action: "submit" | "execute"; call: ModuleCall };
export type DevState = SimulatorSnapshot & {
  status: "ready";
  revision: string;
  module: ModuleDefinition;
  views: Record<string, { css: string }>;
};
export type WorkerResponse =
  | {
      type: "ready";
      module: ModuleDefinition;
      bundles: ClientBundles;
      snapshot: SimulatorSnapshot;
    }
  | { type: "error"; message: string }
  | {
      type: "response";
      id: number;
      snapshot: SimulatorSnapshot;
      result?: unknown;
      error?: {
        status: number;
        code: string;
        message: string;
        detail?: unknown;
      };
    };
