import { ProfileRecoverySchema, type ProfileRecovery } from "@suite/contracts";
import { assertSchema, hydrateModule } from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import {
  SavedWorkRecoverySchema,
  type SavedWorkRecovery,
} from "@suite/module-sdk/platform";
import { canonical } from "@suite/module-sdk/registry";
import { verifyArtifact } from "@suite/module-sdk/verification";
import type { Platform, Scope } from "../index";
import type { SuiteClient } from "../api";
import { changeModuleStorage, type ModuleStorage } from "../modules/storage";
import { responseContractKey } from "../modules/response";
import { checkRecoveryPolicy } from "./input";
import { savedWorkCalls, savedWorkContracts, validateSavedWork } from "./work";

/** Imported observations stay separate from executable journals, drafts and server receipts. */
export interface SavedWorkImport {
  input: SavedWorkRecovery;
  receivedAt: number;
}
export const savedWorkImportLimit = 1024 * 1024;
const size = (text: string) => new TextEncoder().encode(text).byteLength;

/** Bound bytes and nesting before recursive schema/identity processing. */
export function parseSavedWorkImport(text: string, scope: Scope) {
  if (text.length > savedWorkImportLimit || size(text) > savedWorkImportLimit)
    throw Error("The recovery file exceeds the 1 MiB import limit.");
  const input: unknown = JSON.parse(text);
  const pending: { value: unknown; depth: number }[] = [
    { value: input, depth: 0 },
  ];
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (typeof value === "number" && !Number.isFinite(value))
      throw Error("The recovery file contains a non-finite number.");
    if (!value || typeof value !== "object") continue;
    if (depth >= 64) throw Error("The recovery file is nested too deeply.");
    for (const child of Object.values(value))
      pending.push({ value: child, depth: depth + 1 });
  }
  assertSchema(SavedWorkRecoverySchema, input);
  return validateSavedWork(input, scope, input.moduleId);
}
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
export interface SavedWorkImportOptions {
  client: SuiteClient;
  platform: Platform;
  scope: Scope;
  signal: AbortSignal;
  /** Host-owned guard for active profile, workspace, unlock and offline-storage consent. */
  check(): void;
}

/** Online-only admission. No archive field supplies credentials, contracts or accepted outcomes. */
export async function stageSavedWorkImport(
  options: SavedWorkImportOptions,
  text: string,
) {
  const scope = { ...options.scope };
  const input = parseSavedWorkImport(text, scope);
  const client = options.client.forUser(scope.userId);
  const check = () => {
    options.signal.throwIfAborted();
    options.check();
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
  check();
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
  const refreshed = await client.request(
    { operation: "profileRecovery" },
    { signal: options.signal },
  );
  checkSession(refreshed, scope, proof);
  const commitCheck = () => {
    check();
    checkSession(refreshed, scope, proof);
  };
  commitCheck();
  const serialized = canonical(input);
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serialized),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let alreadyImported = false;
  await changeModuleStorage(
    options.platform,
    scope,
    (state) => {
      commitCheck();
      const imports = state.recoveryImports ?? {};
      const existing = imports[digest];
      if (existing) {
        if (canonical(existing.input) !== serialized)
          throw Error(
            "The stored recovery copy changed. Retain the source file.",
          );
        alreadyImported = true;
        return;
      }
      const next = { ...imports, [digest]: { input, receivedAt: Date.now() } };
      if (
        Object.keys(next).length > 32 ||
        size(JSON.stringify(next)) > savedWorkImportLimit
      )
        throw Error(
          "Saved-work import storage is full. Retain this file until previous imports are resolved.",
        );
      state.recoveryImports = next;
      // Contracts, permissions, leases and file-supplied execution state are deliberately not installed.
    },
    commitCheck,
  );
  return { digest, alreadyImported };
}
