import {
  ProfileRecoverySchema,
  type ProfileRecovery,
  type Bootstrap,
} from "@suite/contracts";
import { assertSchema, hydrateModule } from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { canonical } from "@suite/module-sdk/registry";
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
function checkSession(
  proof: ProfileRecovery,
  scope: Scope,
  previous?: ProfileRecovery,
) {
  assertSchema(ProfileRecoverySchema, proof);
  const now = Date.now();
  const issued = Date.parse(proof.authenticatedAt);
  const expires = Date.parse(proof.expiresAt);
  if (
    proof.userId !== scope.userId ||
    issued > now ||
    expires <= now ||
    expires <= issued ||
    expires - issued > 300_000 ||
    (previous && canonical(proof) !== canonical(previous))
  )
    throw Error("Sign in again to import saved work into this account.");
}
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
  receivePolicy?(policy: Bootstrap, signal: AbortSignal): Promise<unknown>;
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
  check();
  const proof = await client.request(
    { operation: "profileRecovery" },
    { signal: options.signal },
  );
  checkSession(proof, scope);
  check();
  const policy = await client.request(
    { operation: "bootstrap", params: { workspaceId: scope.workspaceId } },
    { signal: options.signal },
  );
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
  const params = { workspaceId: scope.workspaceId, moduleId: input.moduleId };
  const current = await client.request(
    { operation: "moduleArtifact", params },
    { signal: options.signal },
  );
  await verifyArtifact(current, publicKey);
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
    contracts.responseContracts![key] = { signed, publicKey };
  }
  const originals = await savedWorkContracts(contracts, input);
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
    checkSession(proof, scope);
  };
  const refresh = async () => {
    const latest = await client.request(
      { operation: "bootstrap", params: { workspaceId: scope.workspaceId } },
      { signal: options.signal },
    );
    if (latest.policyRevision !== policy.policyRevision)
      throw Error(
        "Workspace access changed during import. Retry with current access.",
      );
    checkRecoveryPolicy(latest, input, dependencies, false, Date.now(), {
      current: module,
      originals,
    });
    await options.receivePolicy?.(latest, options.signal);
    check();
    const refreshed = await client.request(
      { operation: "profileRecovery" },
      { signal: options.signal },
    );
    checkSession(refreshed, scope, proof);
    commitCheck();
  };
  await refresh();
  contracts.responseContracts![`${module.id}@${module.version}`] = {
    signed: current,
    publicKey,
  };
  return { check: commitCheck, refresh, contracts, module, access };
}
