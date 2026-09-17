import type { ModuleDefinition } from "@suite/module-sdk";
import { hydrateModule } from "@suite/module-sdk";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import {
  resolveHostCapability,
  type HostCapability,
  type HostCapabilityCall,
} from "@suite/module-sdk/host-capabilities";
import { LocalExecutionError } from "@suite/module-sdk/local";
import { canonical } from "@suite/module-sdk/registry";
import { verifyArtifact } from "@suite/module-sdk/verification";
import { availableLocalModules } from "./local-modules";
import type { LocalData, LocalSession } from "./local-profiles";

export interface LocalCapabilityGrant extends HostCapability {
  id: string;
  moduleId: string;
  moduleVersion: string;
  capability: string;
  releaseDigest: string;
  grantedAt: number;
}

/** A process-local guard, never a corporate authorization or serializable IPC token. */
export interface LocalCapabilityGuard {
  readonly call: Readonly<HostCapabilityCall>;
  readonly authorization: Readonly<
    LocalCapabilityGrant & { profileId: string }
  >;
  /** Recheck immediately before an effect, including after dialogs or other asynchronous work. */
  assertCurrent(): Promise<void>;
}

function standalone(module: ModuleDefinition) {
  return (
    Object.values(module.resources).some((resource) => resource.standalone) ||
    Object.values(module.operations).some(
      (operation) => operation.policy === "local",
    )
  );
}

async function releaseBinding(data: LocalData, module: ModuleDefinition) {
  const installation = data.modules?.[module.id];
  if (installation) {
    const release = installation.releases[installation.version];
    if (!installation.active || !release)
      throw new LocalExecutionError(
        "LOCAL_NOT_INSTALLED",
        "Install this local module before granting device access.",
      );
    await verifyArtifact(release.package, release.publicKey);
    if (
      canonical(module) !==
      canonical(hydrateModule(moduleContract(release.package.artifact)))
    )
      throw new LocalExecutionError(
        "CAPABILITY_DENIED",
        "The device access declaration does not match the installed release.",
      );
    return release.package.digest;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(module)),
  );
  return (
    "bundled:" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

/** Verified standalone declarations eligible for explicit profile-owner consent. */
export async function localCapabilityAccess(
  data: LocalData,
  catalog: ModuleCatalog,
  moduleId?: string,
) {
  const choices = await Promise.all(
    availableLocalModules(data, catalog)
      .filter(
        (module) =>
          (!moduleId || module.id === moduleId) &&
          standalone(module) &&
          Object.keys(module.capabilities ?? {}).length > 0,
      )
      .map(async (module) => {
        const releaseDigest = await releaseBinding(data, module);
        return Object.entries(module.capabilities ?? {}).map(
          ([capability, declaration]) => {
            const grant = data.capabilityGrants?.find(
              (candidate) =>
                candidate.moduleId === module.id &&
                candidate.moduleVersion === module.version &&
                candidate.capability === capability &&
                candidate.kind === declaration.kind &&
                candidate.permission === declaration.permission &&
                candidate.releaseDigest === releaseDigest,
            );
            return {
              module,
              capability,
              declaration,
              releaseDigest,
              grant,
              granted: !!grant,
            };
          },
        );
      }),
  );
  return choices.flat();
}

/** Resolve against host-owned installed definitions, never a caller-supplied manifest. */
export async function grantedLocalCapability(
  data: LocalData,
  catalog: ModuleCatalog,
  call: HostCapabilityCall,
) {
  const choice = (
    await localCapabilityAccess(data, catalog, call.moduleId)
  ).find(
    (candidate) =>
      candidate.module.id === call.moduleId &&
      candidate.capability === call.capability,
  );
  if (!choice)
    throw new LocalExecutionError(
      "CAPABILITY_UNDECLARED",
      "Choose a device capability declared by an installed standalone module.",
    );
  if (choice.module.version !== call.moduleVersion)
    throw new LocalExecutionError(
      "LOCAL_UPDATE_REQUIRED",
      "Device access requires the active local module release.",
    );
  resolveHostCapability(choice.module, call.capability, call.input);
  if (!choice.grant)
    throw new LocalExecutionError(
      "CAPABILITY_DENIED",
      "Allow this device capability in the local profile before using it.",
    );
  return choice.grant;
}

/** Scoped profile adapter: encryption and atomic writes stay with the profile host. */
export function createLocalCapabilityAuthority(host: {
  catalog: ModuleCatalog;
  profileId: string;
  data(): LocalData;
  revision(): number;
  settled(): Promise<void>;
  assertCurrent(): Promise<void>;
  enqueue<T>(run: () => Promise<T>): Promise<T>;
  save(grants: LocalCapabilityGrant[]): Promise<void>;
}): Pick<LocalSession, "setCapabilityAccess" | "prepareCapability"> {
  return {
    setCapabilityAccess(moduleId, capability, allowed) {
      return host.enqueue(async () => {
        await host.assertCurrent();
        if (
          typeof allowed !== "boolean" ||
          [moduleId, capability].some(
            (value) =>
              typeof value !== "string" ||
              !/^[a-z][a-z0-9-]{0,63}$/.test(value),
          )
        )
          throw Error(
            "Choose a declared device capability and an explicit access decision.",
          );
        const choice = allowed
          ? (
              await localCapabilityAccess(host.data(), host.catalog, moduleId)
            ).find(
              (candidate) =>
                candidate.module.id === moduleId &&
                candidate.capability === capability,
            )
          : undefined;
        if (allowed && !choice)
          throw new LocalExecutionError(
            "CAPABILITY_UNDECLARED",
            "Choose a device capability declared by an installed standalone module.",
          );
        const grants = (host.data().capabilityGrants ?? []).filter(
          (grant) =>
            grant.moduleId !== moduleId || grant.capability !== capability,
        );
        if (allowed && choice)
          grants.push({
            ...choice.declaration,
            id: crypto.randomUUID(),
            moduleId,
            moduleVersion: choice.module.version,
            capability,
            releaseDigest: choice.releaseDigest,
            grantedAt: Date.now(),
          });
        await host.save(grants);
      });
    },
    async prepareCapability(input) {
      const call = structuredClone(input);
      // Device interaction must not hold the transaction queue: revocation must remain possible.
      await host.settled();
      await host.assertCurrent();
      const grant = structuredClone(
        await grantedLocalCapability(host.data(), host.catalog, call),
      );
      const assertCurrent = async () => {
        await host.settled();
        await host.assertCurrent();
        const checkedRevision = host.revision();
        const active = await grantedLocalCapability(
          host.data(),
          host.catalog,
          call,
        );
        if (active.id !== grant.id)
          throw new LocalExecutionError(
            "CAPABILITY_DENIED",
            "This device request lost its original consent. Start a new request after reviewing access.",
          );
        await host.assertCurrent();
        if (host.revision() !== checkedRevision)
          throw new LocalExecutionError(
            "PROFILE_CHANGED",
            "The local profile changed while device access was being checked. Start a new request.",
          );
      };
      await assertCurrent();
      return Object.freeze({
        call: Object.freeze({
          ...call,
          input: Object.freeze(structuredClone(call.input)),
        }),
        authorization: Object.freeze({ ...grant, profileId: host.profileId }),
        assertCurrent,
      });
    },
  };
}
