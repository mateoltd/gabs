import type { ModuleCall, ModuleDefinition, ResourceRecord } from "../index";
import { canonical } from "../contracts/registry";
import {
  executeLocalTransaction,
  type LocalReceipt,
  type LocalReferenceProvider,
} from "../runtime/local";
import {
  deviceRequestBytes,
  localDeviceLimits,
  resolveLocalDeviceGrant,
  type LocalDeviceGrant,
  type LocalDeviceIntent,
} from "../contracts/local-devices";
import { createHostSimulator } from "./simulation-host";
import {
  simulationError,
  type SimulationModule,
  type SimulationGrant,
} from "./simulation-fixtures";

export interface SimulatedDeviceRequest extends LocalDeviceIntent {
  state: "pending" | "running" | "completed" | "rejected" | "uncertain";
  result?: unknown;
  error?: string;
  retryOf?: string;
}
export interface LocalSimulationSnapshot {
  locked: boolean;
  hostResults: Record<string, Record<string, unknown>>;
  deviceGrants: LocalDeviceGrant[];
  deviceRequests: SimulatedDeviceRequest[];
}

/** Development memory only: real local transactions, simulated device outcomes, no adapters. */
export function createLocalSimulator(
  root: ModuleDefinition,
  modules: Map<string, SimulationModule>,
  environment: {
    enabled: boolean;
    records(id: string): Record<string, ResourceRecord[]>;
    commit(id: string, records: Record<string, ResourceRecord[]>): void;
    permissions(id: string): string[];
    grants(): readonly SimulationGrant[];
    readGrants(): readonly { consumerId: string; providerId: string }[];
  },
) {
  let locked = false;
  let profileRevision = 0;
  const grants: LocalDeviceGrant[] = [];
  const requests = new Map<string, SimulatedDeviceRequest>();
  const receipts = new Map<string, Record<string, LocalReceipt>>();
  const hosts = new Map(
    [...modules].map(([id, fixture]) => [
      id,
      createHostSimulator(
        fixture.module,
        () => ({
          online: true,
          personal: false,
          permissions: environment.permissions(id),
        }),
        fixture.hostResults,
      ),
    ]),
  );
  function available() {
    if (!environment.enabled)
      throw simulationError(
        403,
        "LOCAL_ONLY",
        "Use personal: true to simulate standalone work.",
      );
    if (locked)
      throw simulationError(
        403,
        "PROFILE_LOCKED",
        "Unlock the simulated profile before continuing.",
      );
  }
  const authority = () =>
    canonical({
      profileRevision,
      grants,
      services: environment.grants(),
      reads: environment.readGrants(),
      permissions: [...modules.keys()].map((id) => [
        id,
        environment.permissions(id),
      ]),
    });
  function setAccess(id: string, name: string, allowed: boolean) {
    available();
    const module = modules.get(id)?.module;
    const declaration = module?.capabilities?.[name];
    if (
      !module ||
      !Object.hasOwn(module.capabilities ?? {}, name) ||
      !declaration
    )
      throw Error(`Undeclared local device capability: ${id}.${name}`);
    const index = grants.findIndex(
      (g) => g.moduleId === id && g.capability === name,
    );
    if (!allowed) {
      if (index >= 0) grants.splice(index, 1);
      return;
    }
    if (index >= 0) return;
    grants.push({
      ...declaration,
      id: crypto.randomUUID(),
      moduleId: id,
      moduleVersion: module.version,
      capability: name,
      releaseDigest: `simulation:unverified:${id}@${module.version}`,
    });
  }
  if (environment.enabled)
    for (const [id, fixture] of modules)
      for (const name of fixture.deviceAccess ?? []) setAccess(id, name, true);
  const snapshotFor = (id: string) => ({
    records: environment.records(id),
    receipts: receipts.get(id) ?? {},
  });
  function references(consumerId: string): LocalReferenceProvider[] {
    return environment
      .readGrants()
      .filter((g) => g.consumerId === consumerId)
      .map((g) => {
        const module = modules.get(g.providerId)!.module;
        const resources = Object.entries(module.resources)
          .filter(([, resource]) => resource.standalone)
          .map(([name]) => name);
        return {
          profileId: "simulation",
          module,
          resources,
          records: Object.fromEntries(
            resources.map((name) => [
              name,
              environment.records(module.id)[name] ?? [],
            ]),
          ),
        };
      });
  }
  function current(request: SimulatedDeviceRequest) {
    available();
    const module = modules.get(request.call.moduleId)?.module;
    if (!module) throw Error("The simulated request module is unavailable.");
    const grant = resolveLocalDeviceGrant(module, grants, request.call);
    if (grant.id !== request.grantId)
      throw Error(
        "The original device consent was revoked. Create a reviewed retry.",
      );
    if (!environment.permissions(module.id).includes(grant.permission))
      throw simulationError(
        403,
        "FORBIDDEN",
        `Missing permission: ${grant.permission}`,
      );
    return grant;
  }
  function entry(id: string) {
    available();
    const request = requests.get(id);
    if (!request) throw Error("Unknown simulated device request.");
    return request;
  }
  function assertCapacity(additions: SimulatedDeviceRequest[]) {
    const next = [...requests.values(), ...additions];
    if (
      next.length > localDeviceLimits.journalCount ||
      deviceRequestBytes(next) > localDeviceLimits.journalBytes
    )
      throw Error("Clear simulated device requests before adding more.");
  }
  return {
    async send(call: ModuleCall, signal?: AbortSignal) {
      available();
      const epoch = authority();
      const serviceGrants = environment.grants().flatMap((g) => {
        const consumer = modules.get(g.consumerId)!.module,
          provider = modules.get(g.providerId)!.module;
        if (
          !environment
            .permissions(provider.id)
            .includes(provider.operations[g.operation].permission)
        )
          return [];
        return Object.entries(consumer.services ?? {})
          .filter(
            ([, ref]) =>
              ref.moduleId === g.providerId && ref.operation === g.operation,
          )
          .map(([service]) => ({
            consumerId: consumer.id,
            consumerVersion: consumer.version,
            providerId: provider.id,
            providerVersion: provider.version,
            service,
          }));
      });
      const result = await executeLocalTransaction(
        root,
        {
          profileId: "simulation",
          call: { ...call, moduleVersion: call.moduleVersion ?? root.version },
          configuration: modules.get(root.id)!.configuration ?? {},
          snapshot: snapshotFor(root.id),
          referenceProviders: references(root.id),
          serviceGrants,
          serviceParticipants: [...modules]
            .filter(([id]) => id !== root.id)
            .map(([id, fixture]) => ({
              profileId: "simulation",
              module: fixture.module,
              configuration: fixture.configuration ?? {},
              snapshot: snapshotFor(id),
              referenceProviders: references(id),
            })),
          deviceGrants: structuredClone(
            grants.filter((g) =>
              environment.permissions(g.moduleId).includes(g.permission),
            ),
          ),
        },
        [...modules.values()].flatMap((fixture) =>
          fixture.local ? [fixture.local] : [],
        ),
      );
      available();
      signal?.throwIfAborted();
      if (epoch !== authority())
        throw Error(
          "Simulated consent changed during the transaction. Retry the operation.",
        );
      const additions = (result.deviceRequests ?? []).map((r) => ({
        ...r,
        state: "pending" as const,
      }));
      additions.forEach(current);
      assertCapacity(additions);
      for (const [id, state] of Object.entries({
        [root.id]: result.snapshot,
        ...result.participants,
      })) {
        environment.commit(id, state.records);
        receipts.set(id, state.receipts);
      }
      additions.forEach((r) => requests.set(r.id, r));
      return result.result;
    },
    setAccess,
    setResult(id: string, name: string, result: unknown) {
      const host = hosts.get(id);
      if (!host) throw Error(`Unknown simulated module: ${id}`);
      host.setResult(name, result as never);
    },
    async process(id: string, options: { interrupt?: boolean } = {}) {
      const request = entry(id);
      if (request.state === "completed") return structuredClone(request.result);
      if (request.state !== "pending")
        throw Error("Review this request before creating a retry.");
      try {
        current(request);
      } catch (error) {
        request.state = "rejected";
        request.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
      request.state = "running";
      if (options.interrupt) return undefined;
      const revision = profileRevision;
      try {
        const result = await hosts
          .get(request.call.moduleId)!
          .send(request.call);
        current(request);
        if (revision !== profileRevision || request.state !== "running")
          throw Error(
            "The simulated profile changed while processing this request.",
          );
        request.result = structuredClone(result);
        request.state = "completed";
        return result;
      } catch (error) {
        request.state = "uncertain";
        request.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
    retry(id: string, options: { confirmUncertain?: boolean } = {}) {
      const request = entry(id);
      if (!["rejected", "uncertain"].includes(request.state))
        throw Error(
          "Only rejected or uncertain device requests can be retried.",
        );
      if (request.state === "uncertain" && !options.confirmUncertain)
        throw Error("Review the possible device outcome before retrying.");
      const previous = [...requests.values()].find((r) => r.retryOf === id);
      if (previous) return previous.id;
      const module = modules.get(request.call.moduleId)!.module;
      const grant = resolveLocalDeviceGrant(module, grants, request.call);
      const next: SimulatedDeviceRequest = {
        id: crypto.randomUUID(),
        grantId: grant.id,
        call: structuredClone(request.call),
        retryOf: id,
        state: "pending",
      };
      current(next);
      assertCapacity([next]);
      requests.set(next.id, next);
      return next.id;
    },
    dismiss(id: string) {
      if (entry(id).state === "running")
        throw Error("Recover the running request before clearing it.");
      requests.delete(id);
    },
    lock() {
      available();
      locked = true;
      profileRevision++;
    },
    unlock() {
      if (!environment.enabled)
        throw Error("Use personal: true to simulate standalone work.");
      locked = false;
      profileRevision++;
      for (const request of requests.values())
        if (request.state === "running") {
          request.state = "uncertain";
          request.error =
            "The simulated profile stopped before saving the device outcome.";
        }
    },
    snapshot(): LocalSimulationSnapshot {
      return structuredClone({
        locked,
        hostResults: Object.fromEntries(
          [...hosts].map(([id, host]) => [id, host.snapshot().hostResults]),
        ),
        deviceGrants: grants,
        deviceRequests: [...requests.values()],
      });
    },
  };
}
