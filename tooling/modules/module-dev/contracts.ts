import type {
  ModuleCall,
  ModuleDefinition,
  QueuedOperationIdentity,
  QueuedResourceIdentity,
} from "@suite/module-sdk";
import type { ClientBundles } from "@suite/module-sdk/client-artifact";
import type { HostCapabilityCall } from "@suite/module-sdk/host-capabilities";
import type {
  SimulatorSnapshot,
  SimulationGrant,
  SimulationReadGrant,
} from "@suite/module-sdk/simulator";

export type DevAction =
  | {
      action: "hostLease";
      capability: string;
      task: "renew" | "revoke";
      remainingMs?: number;
    }
  | { action: "hostClock"; milliseconds: number }
  | { action: "host"; call: HostCapabilityCall }
  | {
      action: "hostResult";
      moduleId?: string;
      capability: string;
      result: unknown;
    }
  | {
      action: "localAccess";
      moduleId: string;
      capability: string;
      allowed: boolean;
    }
  | { action: "localProfile"; locked: boolean }
  | {
      action: "localDevice";
      id: string;
      task: "process" | "interrupt" | "retry" | "clear";
      confirmUncertain?: boolean;
    }
  | { action: "network"; online: boolean }
  | { action: "permissions"; moduleId?: string; permissions: string[] }
  | { action: "grants"; grants: SimulationGrant[] }
  | { action: "readGrants"; grants: SimulationReadGrant[] }
  | {
      action: "queue" | "queueResource";
      call: ModuleCall;
      dependencies: string[];
    }
  | { action: "queued"; identity: QueuedOperationIdentity }
  | { action: "queuedResource"; identity: QueuedResourceIdentity }
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
