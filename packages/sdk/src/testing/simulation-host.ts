import { assertSchema, type ModuleDefinition } from "../index";
import {
  createModuleHost,
  resolveHostCapability,
  hostCapabilitySchemas,
  type HostCapabilityCall,
  type HostCapabilityName,
  type HostCapabilityResult,
  type HostCapabilityInput,
  type HostCapabilityResults,
} from "../contracts/host-capabilities";
import { simulationError } from "./simulation-fixtures";

import {
  createLeaseSimulator,
  type SimulatedHostLeases,
  type LeasedHostCapabilityName,
} from "./simulation-leases";

export interface SimulatedHostAction {
  moduleId: string;
  capability: string;
  state: "simulated" | "rejected";
  authority?: "online" | "lease";
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
    viewPermission?: string;
  },
  initial: HostCapabilityResults<M> = {},
  initialLeases: SimulatedHostLeases<M> = {},
) {
  const leases = createLeaseSimulator(module, initialLeases);
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
  function check(call: HostCapabilityCall) {
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
        "Standalone handlers queue ctx.device.request calls. Process them through the simulator's device request controls.",
      );
    for (const permission of [
      declaration.permission,
      ...(current.viewPermission ? [current.viewPermission] : []),
    ])
      if (!current.permissions.includes(permission))
        throw simulationError(
          403,
          "FORBIDDEN",
          `Missing permission: ${permission}`,
        );
    if (!current.online && declaration.offline !== "lease")
      throw simulationError(
        503,
        "OFFLINE",
        "Reconnect before using this host action.",
      );
    return { declaration, online: current.online };
  }
  function prepare(call: HostCapabilityCall) {
    const initial = check(call);
    const recheck = initial.online
      ? undefined
      : leases.prepare(call.capability);
    let finished = false;
    return async () => {
      if (finished)
        throw simulationError(
          409,
          "HOST_ACTION_FINISHED",
          "This simulated host action has already finished.",
        );
      finished = true;
      const action: SimulatedHostAction = {
        moduleId: call.moduleId,
        capability: call.capability,
        state: "rejected",
      };
      try {
        const current = check(call);
        if (!current.online) {
          if (recheck) recheck();
          else leases.prepare(call.capability)();
        }
        action.authority = current.online ? "online" : "lease";
        const declaration = current.declaration;
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
  }
  const send = async (call: HostCapabilityCall) => {
    let complete: () => Promise<unknown>;
    try {
      complete = prepare(call);
    } catch (error) {
      actions.push({
        moduleId: call.moduleId,
        capability: call.capability,
        state: "rejected",
        error: error instanceof Error ? error.message : String(error),
      });
      if (actions.length > 100) actions.shift();
      throw error;
    }
    return complete();
  };
  return {
    host: createModuleHost(module, send),
    send,
    prepare<N extends HostCapabilityName<M>>(
      name: N,
      input: HostCapabilityInput<M, N>,
    ) {
      const complete = prepare({
        moduleId: module.id,
        moduleVersion: module.version,
        capability: name,
        input: structuredClone(input),
      });
      return {
        complete: () => complete() as Promise<HostCapabilityResult<M, N>>,
      };
    },
    grant<N extends LeasedHostCapabilityName<M>>(
      name: N,
      remainingMs = 86400000,
    ) {
      const current = environment();
      if (current.personal || !current.online)
        throw simulationError(
          503,
          "LEASE_RENEWAL_UNAVAILABLE",
          "Reconnect in a company simulation before renewing a lease.",
        );
      const permission = module.capabilities?.[name]?.permission;
      if (
        !permission ||
        !current.permissions.includes(permission) ||
        (current.viewPermission &&
          !current.permissions.includes(current.viewPermission))
      )
        throw simulationError(
          403,
          "FORBIDDEN",
          "Current simulated permissions do not allow this lease.",
        );
      leases.grant(name, remainingMs);
    },
    revoke: leases.revoke as (name: LeasedHostCapabilityName<M>) => void,
    advance: leases.advance,
    invalidate: leases.invalidate,
    setResult<N extends HostCapabilityName<M>>(
      name: N,
      result: HostCapabilityResult<M, N> | undefined,
    ) {
      setResult(name, result);
    },
    snapshot() {
      return structuredClone({
        ...leases.snapshot(),
        hostResults: configured(),
        hostActions: actions,
      });
    },
  };
}
