import type { ModuleDefinition } from "@suite/module-sdk";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import type {
  LocalReferenceProvider,
  LocalServiceGrant,
  LocalServiceParticipant,
} from "@suite/module-sdk/local";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import { referenceFields } from "@suite/module-sdk/references";
import { canonical, satisfies } from "@suite/module-sdk/registry";
import { availableLocalModules } from "./local-modules";
import type { LocalData } from "./local-profiles";

/** Only declared standalone reference targets are eligible for profile-owner consent. */
export function localReferenceAccess(
  data: LocalData,
  catalog: ModuleCatalog,
  replacements: readonly ModuleDefinition[] = [],
) {
  const available = new Map(
    availableLocalModules(data, catalog).map((m) => [m.id, m]),
  );
  for (const module of replacements) available.set(module.id, module);
  const modules = [...available.values()];
  return modules.flatMap((consumer) => {
    const targets = new Map<
      string,
      { provider: ModuleDefinition; resource: string }
    >();
    for (const definition of Object.values(consumer.resources).filter(
      (r) => r.standalone,
    )) {
      for (const { target } of referenceFields(definition.schema)) {
        if (target.kind !== "resource" || target.moduleId === consumer.id)
          continue;
        const provider = modules.find((m) => m.id === target.moduleId);
        const range = consumer.dependencies[target.moduleId];
        if (
          !provider ||
          !range ||
          !satisfies(provider.version, range) ||
          !provider.resources[target.resource]?.standalone ||
          !provider.permissions.includes(
            `${provider.id}.${target.resource}.read`,
          )
        )
          continue;
        targets.set(`${provider.id}/${target.resource}`, {
          provider,
          resource: target.resource,
        });
      }
    }
    return [...targets.values()].map(({ provider, resource }) => ({
      consumer,
      provider,
      resource,
      granted: !!data.referenceGrants?.some(
        (grant) =>
          grant.consumerId === consumer.id &&
          grant.consumerVersion === consumer.version &&
          grant.providerId === provider.id &&
          grant.providerVersion === provider.version &&
          grant.resource === resource,
      ),
    }));
  });
}
/** A grant authorizes one declared alias, with both exact releases and a matching public local contract. */
export function localServiceAccess(data: LocalData, catalog: ModuleCatalog) {
  const modules = availableLocalModules(data, catalog);
  return modules.flatMap((consumer) =>
    Object.entries(consumer.services ?? {}).flatMap(([service, reference]) => {
      const provider = modules.find((m) => m.id === reference.moduleId);
      const contract = provider?.operations[reference.operation];
      if (
        !provider ||
        !contract ||
        contract.policy !== "local" ||
        !contract.public ||
        !provider.permissions.includes(contract.permission) ||
        !consumer.dependencies[provider.id] ||
        !satisfies(provider.version, consumer.dependencies[provider.id]) ||
        canonical(contract) !== canonical(reference.contract)
      )
        return [];
      return [
        {
          consumer,
          provider,
          service,
          operation: reference.operation,
          granted: !!data.serviceGrants?.some(
            (grant) =>
              grant.consumerId === consumer.id &&
              grant.consumerVersion === consumer.version &&
              grant.providerId === provider.id &&
              grant.providerVersion === provider.version &&
              grant.service === service,
          ),
        },
      ];
    }),
  );
}
export function serviceContext(
  data: LocalData,
  module: ModuleDefinition,
  profileId: string,
  catalog: ModuleCatalog,
) {
  const choices = localServiceAccess(data, catalog).filter(
    (choice) => choice.granted,
  );
  const participants: LocalServiceParticipant[] = [];
  const artifacts: Record<
    string,
    { package: SignedArtifact; publicKey: string }
  > = {};
  const referenceArtifacts: Record<
    string,
    { package: SignedArtifact; publicKey: string }
  > = {};
  const grants: LocalServiceGrant[] = [];
  const visited = new Set([module.id]);
  const visit = (consumerId: string) => {
    for (const choice of choices.filter((c) => c.consumer.id === consumerId)) {
      grants.push({
        consumerId,
        consumerVersion: choice.consumer.version,
        providerId: choice.provider.id,
        providerVersion: choice.provider.version,
        service: choice.service,
      });
      if (visited.has(choice.provider.id)) continue;
      visited.add(choice.provider.id);
      const installation = data.modules?.[choice.provider.id];
      const release = installation?.releases[installation.version];
      if (release)
        artifacts[choice.provider.id] = {
          package: release.package,
          publicKey: release.publicKey,
        };
      const references = referenceContext(
        data,
        choice.provider,
        profileId,
        catalog,
      );
      Object.assign(referenceArtifacts, references.referenceArtifacts);
      const prefix = choice.provider.id + "/";
      participants.push({
        profileId,
        module: choice.provider,
        configuration: release?.configuration ?? {},
        snapshot: {
          records: Object.fromEntries(
            Object.entries(data.records)
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, rows]) => [key.slice(prefix.length), rows]),
          ),
          receipts: data.receipts?.[choice.provider.id] ?? {},
        },
        referenceProviders: references.referenceProviders,
      });
      visit(choice.provider.id);
    }
  };
  visit(module.id);
  return { participants, artifacts, referenceArtifacts, grants };
}
export function referenceContext(
  data: LocalData,
  module: ModuleDefinition,
  profileId: string,
  catalog: ModuleCatalog,
) {
  const referenceProviders: LocalReferenceProvider[] = [];
  const referenceArtifacts: Record<
    string,
    { package: SignedArtifact; publicKey: string }
  > = {};
  for (const access of localReferenceAccess(data, catalog).filter(
    (access) =>
      access.granted &&
      access.consumer.id === module.id &&
      access.consumer.version === module.version,
  )) {
    let provider = referenceProviders.find(
      (entry) => entry.module.id === access.provider.id,
    );
    if (!provider) {
      provider = {
        profileId,
        module: access.provider,
        resources: [],
        records: {},
      };
      referenceProviders.push(provider);
      const installed = data.modules?.[access.provider.id];
      const providerRelease = installed?.releases[installed.version];
      if (providerRelease)
        referenceArtifacts[access.provider.id] = {
          package: providerRelease.package,
          publicKey: providerRelease.publicKey,
        };
    }
    provider.resources.push(access.resource);
    provider.records[access.resource] =
      data.records[`${access.provider.id}/${access.resource}`] ?? [];
  }
  return { referenceProviders, referenceArtifacts };
}
