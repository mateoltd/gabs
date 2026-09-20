import type { Bootstrap } from "@suite/contracts";
import { hydrateModule } from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { verifyArtifact } from "@suite/module-sdk/verification";
import type { Platform, Scope } from "../../index";
import type { SuiteClient } from "../../api";
import type { ModuleStorage } from "../../modules/storage";
import { responseContractKey } from "../../modules/response";
import { checkRecoveryPolicy } from "../input";
import {
  savedWorkCalls,
  savedWorkContracts,
  validateSavedWork,
  checkSavedWorkPermissions,
} from "../work";
import { createImportSession } from "./session";
export interface ImportAccess {
  permissions: string[];
  modules: string[];
}
export interface SavedWorkImportOptions {
  client: SuiteClient;
  platform: Platform;
  scope: Scope;
  signal: AbortSignal;
  /** Host-owned guard for active profile, workspace, unlock and offline-storage consent. */
  check(access?: ImportAccess): void;
  receivePolicy?(policy: Bootstrap, signal: AbortSignal): Promise<Bootstrap>;
}

/** Online-only authority comes from current server observations, never the imported file. */
export async function authorizeWorkImport(
  options: SavedWorkImportOptions,
  input: SavedWorkRecovery,
) {
  const scope = { ...options.scope };
  validateSavedWork(input, scope, input.moduleId);
  const client = options.client.forUser(scope.userId);
  let access: ImportAccess | undefined;
  const check = () => {
    options.signal.throwIfAborted();
    options.check(access);
  };
  const requestPolicy = async () => {
    check();
    const candidate = await client.request(
      { operation: "bootstrap", params: { workspaceId: scope.workspaceId } },
      { signal: options.signal },
    );
    check();
    const accepted = options.receivePolicy
      ? await options.receivePolicy(candidate, options.signal)
      : candidate;
    check();
    return accepted;
  };
  const session = await createImportSession(
    client,
    scope,
    options.signal,
    check,
  );
  const policy = await requestPolicy();
  const platform = await client.request(
    { operation: "platformState", params: { workspaceId: scope.workspaceId } },
    { signal: options.signal },
  );
  check();
  const catalog = createModuleCatalog(platform.modules.map(hydrateModule));
  const dependencies = catalog.dependencies(input.moduleId);
  const { publicKey } = await client.request(
    { operation: "moduleTrust" },
    { signal: options.signal },
  );
  check();
  const params = { workspaceId: scope.workspaceId, moduleId: input.moduleId };
  const current = await client.request(
    { operation: "moduleArtifact", params },
    { signal: options.signal },
  );
  check();
  await verifyArtifact(current, publicKey);
  check();
  const module = hydrateModule(moduleContract(current.artifact));
  if (
    module.id !== input.moduleId ||
    !platform.modules.some(
      (item) => item.id === module.id && item.version === module.version,
    )
  )
    throw Error("The recovery module changed. Refresh access and retry.");
  const contracts: ModuleStorage = {
    journal: [],
    drafts: {},
    pages: {},
    installed: {},
    responseContracts: {},
  };
  for (const call of savedWorkCalls(input)) {
    check();
    const key = responseContractKey(call);
    if (Object.hasOwn(contracts.responseContracts!, key)) continue;
    const signed = await client.request(
      {
        operation: "moduleReceiptArtifact",
        params,
        query: { version: call.moduleVersion! },
      },
      { signal: options.signal },
    );
    check();
    contracts.responseContracts![key] = { signed, publicKey };
  }
  const originals = await savedWorkContracts(contracts, input);
  check();
  checkRecoveryPolicy(policy, input, dependencies, false, Date.now(), {
    current: module,
    originals,
  });
  const permissions = new Set<string>();
  checkSavedWorkPermissions(input, module, originals, (permission) => {
    permissions.add(permission);
    return true;
  });
  access = {
    permissions: [...permissions],
    modules: [...new Set([input.moduleId, ...dependencies])],
  };
  check();
  const commitCheck = () => {
    check();
    session.check();
  };
  const refresh = async () => {
    const latest = await requestPolicy();
    if (latest.policyRevision !== policy.policyRevision)
      throw Error(
        "Workspace access changed during import. Retry with current access.",
      );
    checkRecoveryPolicy(latest, input, dependencies, false, Date.now(), {
      current: module,
      originals,
    });
    check();
    const refreshed = await client.request(
      { operation: "profileRecovery" },
      { signal: options.signal },
    );
    session.check(refreshed);
    commitCheck();
  };
  await refresh();
  contracts.responseContracts![`${module.id}@${module.version}`] = {
    signed: current,
    publicKey,
  };
  return { check: commitCheck, refresh, contracts, module, access };
}
