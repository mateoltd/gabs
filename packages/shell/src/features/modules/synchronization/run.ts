import { type FeatureProps } from "@suite/client";
import { ApiError } from "@suite/client/api";
import { canDispatchQueuedCall } from "@suite/client/module-dispatch";
import {
  responseContract,
  responseContractKey,
} from "@suite/client/module-response";
import {
  readModuleStorage,
  syncModuleStorage,
} from "@suite/client/module-storage";
import { sendModuleCall } from "@suite/client/module-transport";
import {
  hydrateModule,
  type ModuleCall,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { verifiedInstalledModule } from "../installation";
import { canReadSavedWork } from "../recovery/access";

/** One workspace pass; the durable journal owns ordering, uncertainty and retries. */
export async function synchronizeWorkspace(
  current: () => FeatureProps | undefined,
  signal: AbortSignal = new AbortController().signal,
) {
  const owner = current();
  const revision = owner?.bootstrap.policyRevision;
  const authorized = () => {
    const props = current();
    return !!(
      owner &&
      props &&
      !signal.aborted &&
      props.scope.userId === owner.scope.userId &&
      props.scope.workspaceId === owner.scope.workspaceId &&
      props.bootstrap.policyRevision === revision &&
      canReadSavedWork(props, true)
    );
  };
  if (!owner || !authorized()) return { sent: 0, errors: [] };
  const stored = await readModuleStorage(owner.platform, owner.scope);
  const pending = stored.journal.filter(
    (entry) =>
      entry.userId === owner.scope.userId &&
      entry.workspaceId === owner.scope.workspaceId &&
      entry.state === "pending" &&
      !entry.supersededBy &&
      !entry.orderingRecovery,
  );
  if (!pending.length || !authorized()) return { sent: 0, errors: [] };
  const state = await owner.client.request(
    {
      operation: "platformState",
      params: { workspaceId: owner.scope.workspaceId },
    },
    { signal },
  );
  if (!authorized()) return { sent: 0, errors: [] };
  const installed = new Map<string, ModuleDefinition>();
  const originals = new Map<string, ModuleDefinition>();
  const dependencies = new Map<string, string[]>();
  const errors: unknown[] = [];
  for (const id of new Set(pending.map((entry) => entry.call.moduleId))) {
    try {
      const verified = await verifiedInstalledModule(owner, stored, id, state);
      if (!verified) continue;
      const definitions = new Map<string, ModuleDefinition>();
      const collect = (moduleId: string) => {
        if (definitions.has(moduleId)) return;
        const definition = hydrateModule(
          stored.installed[moduleId].signed!
            .artifact as unknown as ModuleDefinition,
        );
        definitions.set(moduleId, definition);
        for (const dependency of Object.keys(definition.dependencies))
          collect(dependency);
      };
      // verifiedInstalledModule verified this complete dependency graph.
      collect(id);
      dependencies.set(
        id,
        createModuleCatalog([...definitions.values()]).dependencies(id),
      );
      installed.set(id, definitions.get(id)!);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const entry of pending) {
    if (!installed.has(entry.call.moduleId)) continue;
    try {
      const original = await responseContract(stored, entry.call);
      originals.set(responseContractKey(entry.call), original.module);
    } catch (error) {
      errors.push(error);
    }
  }
  const eligible = (call: ModuleCall) => {
    const props = current();
    const module = installed.get(call.moduleId);
    return !!(
      props &&
      module &&
      authorized() &&
      canDispatchQueuedCall(
        call,
        module,
        originals.get(responseContractKey(call)),
        (permission) =>
          props.bootstrap.permissions.includes(permission) &&
          dependencies
            .get(call.moduleId)!
            .every((id) =>
              props.bootstrap.modules.some(
                (module) =>
                  module.moduleId === id &&
                  module.state === "enabled" &&
                  module.entitled &&
                  module.assigned,
              ),
            ),
      )
    );
  };
  let sent = 0;
  await syncModuleStorage(
    owner.platform,
    owner.scope,
    async (call) => {
      const latest = await readModuleStorage(owner.platform, owner.scope);
      // Uninstall, repair or an update may have happened while the journal lock was queued.
      const props = current();
      const verified =
        props &&
        (await verifiedInstalledModule(props, latest, call.moduleId, state));
      if (
        !verified ||
        verified.pkg.signature !==
          stored.installed[call.moduleId]?.signed?.signature ||
        !eligible(call)
      )
        throw Error(
          "Current module access changed before synchronization. Your change is retained.",
        );
      try {
        sent++;
        return await sendModuleCall(owner.client, owner.scope, call, {
          signal,
        });
      } catch (error) {
        const latest = current();
        if (
          !signal.aborted &&
          latest?.scope.userId === owner.scope.userId &&
          latest.scope.workspaceId === owner.scope.workspaceId &&
          error instanceof ApiError &&
          (error.status === 401 || error.code === "MEMBERSHIP_REVOKED")
        )
          latest.onError(error);
        throw error;
      }
    },
    authorized,
    eligible,
  );
  return { sent, errors };
}
