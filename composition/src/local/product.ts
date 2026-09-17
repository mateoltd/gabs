import {
  availableLocalModules as available,
  createLocalProfile as create,
  localReferenceAccess as references,
  localReleaseIssue as releaseIssue,
  localSchemaVersion as schemaVersion,
  localServiceAccess as services,
  planLocalInstallation as plan,
  planRetainedLocalInstallation as planRetained,
  unlockLocalProfile as unlock,
} from "@suite/client/local-profiles";
import { LocalWorkerHost as GenericLocalWorkerHost } from "@suite/client/local-worker";
import { localProfileRuntime, localWorkerFactory } from "./runtime";

export * from "@suite/client/local-profiles";

export const createLocalProfile = (name: string, password: string) =>
  create(name, password, localProfileRuntime);
export const unlockLocalProfile = (id: string, password: string) =>
  unlock(id, password, localProfileRuntime);
export const availableLocalModules = (data: Parameters<typeof available>[0]) =>
  available(data, localProfileRuntime.catalog);
export const localReferenceAccess = (
  data: Parameters<typeof references>[0],
  replacements: Parameters<typeof references>[2] = [],
) => references(data, localProfileRuntime.catalog, replacements);
export const localServiceAccess = (data: Parameters<typeof services>[0]) =>
  services(data, localProfileRuntime.catalog);
export const planLocalInstallation = (
  data: Parameters<typeof plan>[0],
  root: Parameters<typeof plan>[1],
  registry: Parameters<typeof plan>[2],
) => plan(data, root, registry, localProfileRuntime.catalog);
export const localSchemaVersion = (
  data: Parameters<typeof schemaVersion>[0],
  module: Parameters<typeof schemaVersion>[1],
) => schemaVersion(data, module, localProfileRuntime.catalog);
export const localReleaseIssue = (
  data: Parameters<typeof releaseIssue>[0],
  module: Parameters<typeof releaseIssue>[1],
) => releaseIssue(data, module, localProfileRuntime.catalog);
export const planRetainedLocalInstallation = (
  data: Parameters<typeof planRetained>[0],
  moduleId: string,
  version: string,
) => planRetained(data, moduleId, version, localProfileRuntime.catalog);

export class LocalWorkerHost extends GenericLocalWorkerHost {
  constructor() {
    super(localWorkerFactory);
  }
}
