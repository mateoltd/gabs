import type { ModuleCall, ModuleDefinition } from "@suite/module-sdk";
import type { ClientBundles } from "@suite/module-sdk/client-artifact";
import type { HostCapabilityCall } from "@suite/module-sdk/host-capabilities";
import type {
  SimulatorSnapshot,
  SimulationGrant,
  SimulationReadGrant,
} from "@suite/module-sdk/simulator";

export type DevAction =
  | { action: "host"; call: HostCapabilityCall }
  | { action: "hostResult"; capability: string; result: unknown }
  | { action: "network"; online: boolean }
  | { action: "permissions"; moduleId?: string; permissions: string[] }
  | { action: "grants"; grants: SimulationGrant[] }
  | { action: "readGrants"; grants: SimulationReadGrant[] }
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
