import { ApiError, type SuiteClient } from "../api";
import type { Platform, Snapshot } from "../index";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { savedWorkContracts, savedWorkCalls } from "../recovery/work";
import { responseContractKey } from "../modules/response";
import { readModuleStorage } from "../modules/storage";
import { checkRecoveryPolicy, validateRecoveryInput } from "../recovery/input";

export interface RecoveryExportOptions {
  platform: Platform;
  client: SuiteClient;
  input:
    | import("@suite/module-sdk/platform").ModuleInputRecovery
    | import("@suite/module-sdk/platform").SavedWorkRecovery;
  signal: AbortSignal;
  access(): {
    policy: import("@suite/contracts").Bootstrap;
    dependencies: readonly string[];
    online: boolean;
    offlineEnabled: boolean;
    module?: ModuleDefinition;
  };
  receivePolicy(
    policy: import("@suite/contracts").Bootstrap,
    signal: AbortSignal,
  ): Promise<import("@suite/contracts").Bootstrap>;
  onError(error: unknown): void;
  check(): void;
}

/** Permission and lease checks shared by file and archive exports. */
export async function authorizeRecoveryExport(options: RecoveryExportOptions) {
  const { input, signal } = options;
  const check = () => {
    signal.throwIfAborted();
    options.check();
  };
  check();
  validateRecoveryInput(input, input, input.moduleId);
  let access = options.access();
  let policy = access.policy;
  let currentModule = access.module;
  const offline = !access.online || !navigator.onLine;
  if (!offline) {
    try {
      const me = await options.client.request({ operation: "me" }, { signal });
      check();
      if (me.user.id !== input.userId)
        throw new ApiError(
          401,
          "PROFILE_CHANGED",
          "This recovery profile is no longer active.",
        );
      policy = await options.client.request(
        { operation: "bootstrap", params: { workspaceId: input.workspaceId } },
        { signal },
      );
      check();
      policy = await options.receivePolicy(policy, signal);
      check();
      if (input.kind === "module-work-recovery") {
        const pkg = await options.client.request(
          {
            operation: "moduleArtifact",
            params: {
              workspaceId: input.workspaceId,
              moduleId: input.moduleId,
            },
          },
          { signal },
        );
        check();
        currentModule = hydrateModule(moduleContract(pkg.artifact));
      }
    } catch (error) {
      if (!signal.aborted) options.onError(error);
      throw error;
    }
  }
  access = options.access();
  const offlineNow = offline || !access.online || !navigator.onLine;
  const stored =
    input.kind === "module-work-recovery"
      ? await readModuleStorage(options.platform, input)
      : undefined;
  if (input.kind === "module-work-recovery" && stored && !offlineNow) {
    const missing = savedWorkCalls(input).filter(
      (call) => !stored.responseContracts?.[responseContractKey(call)],
    );
    if (missing.length) {
      const { publicKey } = await options.client.request(
        { operation: "moduleTrust" },
        { signal },
      );
      check();
      for (const call of missing) {
        const signed = await options.client.request(
          {
            operation: "moduleReceiptArtifact",
            params: {
              workspaceId: input.workspaceId,
              moduleId: input.moduleId,
            },
            query: { version: call.moduleVersion! },
          },
          { signal },
        );
        check();
        (stored.responseContracts ??= {})[responseContractKey(call)] = {
          signed,
          publicKey,
        };
      }
    }
  }
  const contracts =
    input.kind === "module-work-recovery" && currentModule
      ? {
          current: currentModule,
          originals: await savedWorkContracts(stored!, input),
        }
      : undefined;
  check();
  if (
    input.kind === "module-work-recovery" &&
    currentModule?.version !== options.access().module?.version
  )
    throw Error(
      "The recovery release changed. Refresh saved work before exporting.",
    );
  if (offlineNow && !access.offlineEnabled)
    throw Error("Reconnect to authorize recovery export.");
  let offlineSnapshot: Snapshot | undefined;
  if (offlineNow) {
    const snapshot = await options.platform.load<Snapshot>(
      { userId: input.userId, workspaceId: input.workspaceId },
      "snapshot",
    );
    check();
    if (
      !snapshot ||
      snapshot.expiresAt <= Date.now() ||
      snapshot.cachedAt > Date.now()
    )
      throw Error("Offline recovery access expired. Reconnect to continue.");
    offlineSnapshot = snapshot;
    checkRecoveryPolicy(
      snapshot.bootstrap,
      input,
      access.dependencies,
      true,
      Date.now(),
      contracts,
    );
  }
  if (input.kind === "module-work-recovery" && !offlineNow) {
    const revision = policy.policyRevision;
    try {
      policy = await options.client.request(
        { operation: "bootstrap", params: { workspaceId: input.workspaceId } },
        { signal },
      );
      check();
      policy = await options.receivePolicy(policy, signal);
      check();
      access = options.access();
      if (policy.policyRevision !== revision)
        throw Error(
          "Workspace access changed while preparing this export. Refresh saved work and try again.",
        );
    } catch (error) {
      if (!signal.aborted) options.onError(error);
      throw error;
    }
  }
  checkRecoveryPolicy(
    policy,
    input,
    access.dependencies,
    offlineNow,
    Date.now(),
    contracts,
  );
  checkRecoveryPolicy(
    access.policy,
    input,
    access.dependencies,
    offlineNow,
    Date.now(),
    contracts,
  );
  check();

  const assertCurrent = () => {
    check();
    const current = options.access();
    const disconnected = offlineNow || !current.online || !navigator.onLine;
    if (
      current.policy.policyRevision !== policy.policyRevision ||
      (input.kind === "module-work-recovery" &&
        current.module?.version !== currentModule?.version)
    )
      throw Error(
        "Workspace access changed while preparing this export. Retry with current access.",
      );
    if (
      disconnected &&
      (!current.offlineEnabled ||
        !offlineSnapshot ||
        offlineSnapshot.expiresAt <= Date.now() ||
        offlineSnapshot.cachedAt > Date.now())
    )
      throw Error(
        "Reconnect or refresh offline recovery access before exporting.",
      );
    checkRecoveryPolicy(
      policy,
      input,
      current.dependencies,
      disconnected,
      Date.now(),
      contracts,
    );
    checkRecoveryPolicy(
      current.policy,
      input,
      current.dependencies,
      disconnected,
      Date.now(),
      contracts,
    );
  };
  assertCurrent();
  return assertCurrent;
}
