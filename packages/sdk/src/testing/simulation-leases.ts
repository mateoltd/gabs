import { assertSchema, Type, type ModuleDefinition } from "../index";
import type { HostCapabilityName } from "../contracts/host-capabilities";
import { simulationError } from "./simulation-error";

export type LeasedHostCapabilityName<M extends ModuleDefinition> =
  string extends HostCapabilityName<M>
    ? string
    : {
        [N in HostCapabilityName<M>]: NonNullable<
          M["capabilities"]
        >[N] extends { offline: "lease" }
          ? N
          : never;
      }[HostCapabilityName<M>];
export type SimulatedHostLeases<M extends ModuleDefinition> = [
  HostCapabilityName<M>,
] extends [never]
  ? Record<string, never>
  : {
      [N in HostCapabilityName<M>]?: N extends LeasedHostCapabilityName<M>
        ? { remainingMs: number }
        : never;
    };
const lifetime = Type.Integer({ minimum: 0, maximum: 86400000 });
export function validateHostLeases(module: ModuleDefinition, leases: unknown) {
  assertSchema(
    Type.Record(
      Type.String(),
      Type.Object({ remainingMs: lifetime }, { additionalProperties: false }),
    ),
    leases,
  );
  for (const name of Object.keys(leases)) assertLeased(module, name);
}
function assertLeased(module: ModuleDefinition, name: string) {
  if (
    !Object.hasOwn(module.capabilities ?? {}, name) ||
    module.capabilities?.[name].offline !== "lease"
  )
    throw simulationError(
      400,
      "LEASE_UNDECLARED",
      `Declare offline: lease before simulating a lease for ${name}.`,
    );
}
export interface SimulatedHostLease {
  state: "missing" | "valid" | "expired" | "revoked";
  remainingMs: number;
}

/** A deterministic development clock and allowances, never signed credentials or device authority. */
export function createLeaseSimulator<M extends ModuleDefinition>(
  module: M,
  initial: SimulatedHostLeases<M> = {},
) {
  validateHostLeases(module, initial);
  let elapsedMs = 0;
  const leases = new Map<string, { expiresAt: number; revoked: boolean }>();
  for (const [name, value] of Object.entries(initial) as [
    string,
    { remainingMs: number },
  ][]) {
    leases.set(name, { expiresAt: value.remainingMs, revoked: false });
  }
  function inspect(name: string): SimulatedHostLease {
    const lease = leases.get(name);
    return {
      state: !lease
        ? "missing"
        : lease.revoked
          ? "revoked"
          : lease.expiresAt <= elapsedMs
            ? "expired"
            : "valid",
      remainingMs: lease ? Math.max(0, lease.expiresAt - elapsedMs) : 0,
    };
  }
  function requireLease(name: string) {
    const state = inspect(name).state;
    if (state !== "valid")
      throw simulationError(
        403,
        `LEASE_${state.toUpperCase()}`,
        `The simulated offline lease is ${state}. Reconnect and renew it.`,
      );
    return leases.get(name)!;
  }
  return {
    grant(name: string, remainingMs: number) {
      assertLeased(module, name);
      assertSchema(lifetime, remainingMs);
      leases.set(name, { expiresAt: elapsedMs + remainingMs, revoked: false });
    },
    revoke(name: string) {
      assertLeased(module, name);
      leases.set(name, { expiresAt: elapsedMs, revoked: true });
    },
    invalidate() {
      for (const lease of leases.values()) lease.revoked = true;
    },
    advance(milliseconds: number) {
      if (
        !Number.isSafeInteger(milliseconds) ||
        milliseconds < 0 ||
        !Number.isSafeInteger(elapsedMs + milliseconds)
      )
        throw Error(
          "Advance simulated time by a nonnegative safe integer of milliseconds.",
        );
      elapsedMs += milliseconds;
    },
    prepare(name: string) {
      const lease = requireLease(name);
      return () => {
        requireLease(name);
        if (leases.get(name) !== lease)
          throw simulationError(
            409,
            "LEASE_CHANGED",
            "The simulated lease changed while this action was open. Retry the action.",
          );
      };
    },
    snapshot() {
      return {
        hostElapsedMs: elapsedMs,
        hostLeases: Object.fromEntries(
          Object.entries(module.capabilities ?? {})
            .filter(([, declaration]) => declaration.offline === "lease")
            .map(([name]) => [name, inspect(name)]),
        ),
      };
    },
  };
}
