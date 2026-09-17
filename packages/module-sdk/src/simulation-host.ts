import { assertSchema, type ModuleDefinition } from "./index";
import {
  createModuleHost,
  resolveHostCapability,
  hostCapabilitySchemas,
  type HostCapabilityCall,
  type HostCapabilityName,
  type HostCapabilityResult,
  type HostCapabilityResults,
} from "./host-capabilities";
import { simulationError } from "./simulation-fixtures";

export interface SimulatedHostAction {
  moduleId: string;
  capability: string;
  state: "simulated" | "rejected";
  result?: unknown;
  error?: string;
}

/** Development result fixtures only. This module never invokes a device adapter. */
export function createHostSimulator<M extends ModuleDefinition>(
  module: M,
  environment: () => {
    online: boolean;
    personal: boolean;
    permissions: string[];
  },
  initial: HostCapabilityResults<M> = {},
) {
  const results: Record<string, unknown> = {};
  const actions: SimulatedHostAction[] = [];
  const defaults: Record<string, unknown> = {
    "files.export": { status: "offered" },
    "notifications.show": { requested: false },
    "lan.status": { enabled: false, configured: false, peers: [] },
  };
  function setResult(name: string, result: unknown) {
    if (!module.capabilities || !Object.hasOwn(module.capabilities, name))
      throw Error(`Undeclared host capability: ${name}`);
    if (result === undefined) {
      delete results[name];
      return;
    }
    assertSchema(
      hostCapabilitySchemas[module.capabilities[name].kind].output,
      result,
    );
    results[name] = structuredClone(result);
  }
  for (const [name, result] of Object.entries(initial)) setResult(name, result);
  function configured() {
    return Object.fromEntries(
      Object.entries(module.capabilities ?? {}).map(([name, declaration]) => [
        name,
        Object.hasOwn(results, name)
          ? results[name]
          : (defaults[declaration.kind] ?? null),
      ]),
    );
  }
  const send = async (call: HostCapabilityCall) => {
    const action: SimulatedHostAction = {
      moduleId: call.moduleId,
      capability: call.capability,
      state: "rejected",
    };
    try {
      if (call.moduleId !== module.id || call.moduleVersion !== module.version)
        throw simulationError(
          409,
          "HOST_SCOPE_MISMATCH",
          "Host request does not match the simulated module release.",
        );
      const declaration = resolveHostCapability(
        module,
        call.capability,
        call.input,
      );
      const current = environment();
      if (current.personal)
        throw simulationError(
          403,
          "LOCAL_HOST_UNAVAILABLE",
          "Standalone host grants are not available in this simulator yet.",
        );
      if (!current.permissions.includes(declaration.permission))
        throw simulationError(
          403,
          "FORBIDDEN",
          `Missing permission: ${declaration.permission}`,
        );
      if (!current.online)
        throw simulationError(
          503,
          "OFFLINE",
          "Reconnect before using this host action.",
        );
      const result = configured()[call.capability];
      if (result === null)
        throw simulationError(
          409,
          "CAPABILITY_UNAVAILABLE",
          "Configure a simulated result for this host capability before calling it.",
        );
      assertSchema(hostCapabilitySchemas[declaration.kind].output, result);
      action.state = "simulated";
      action.result = structuredClone(result);
      return structuredClone(result);
    } catch (error) {
      action.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      actions.push(action);
      if (actions.length > 100) actions.shift();
    }
  };
  return {
    host: createModuleHost(module, send),
    send,
    setResult<N extends HostCapabilityName<M>>(
      name: N,
      result: HostCapabilityResult<M, N> | undefined,
    ) {
      setResult(name, result);
    },
    snapshot() {
      return structuredClone({
        hostResults: configured(),
        hostActions: actions,
      });
    },
  };
}
