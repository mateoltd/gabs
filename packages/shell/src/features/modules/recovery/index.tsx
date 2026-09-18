import { ResourceRecovery } from "./resources";
import type { FeatureProps } from "@suite/client";
import { readModuleStorage } from "@suite/client/module-storage";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { ErrorMessage } from "@suite/ui-web";
import { useQuery } from "@tanstack/react-query";
import { usePlatformState } from "../../administration/module-lifecycle";
import { SavedCommands, useQueuedCommands } from "../views/queued-commands";
import { offlineRecoveryContracts } from "./contracts";

function ModuleRecovery(props: FeatureProps & { module: ModuleDefinition }) {
  const state = useQueuedCommands(props, props.module, { kind: "recovery" });
  return (
    <section aria-label={`${props.module.name} saved work`}>
      <h4>{props.module.name}</h4>
      <div className="actions">
        <SavedCommands state={state} />
        <ResourceRecovery {...props} />
      </div>
    </section>
  );
}

/** Host-owned inspection does not mount executable module code or install it. */
export function SavedWorkRecovery(props: FeatureProps) {
  const current = usePlatformState(props);
  const saved = useQuery({
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "saved-work-recovery",
      props.online,
    ],
    enabled: props.offlineEnabled,
    networkMode: "always",
    refetchInterval: 1500,
    queryFn: async () => {
      const state = await readModuleStorage(props.platform, props.scope);
      const ids = new Set(
        state.journal
          .filter(
            (entry) =>
              entry.userId === props.scope.userId &&
              entry.workspaceId === props.scope.workspaceId &&
              !entry.supersededBy &&
              (entry.call.action === "operation" ||
                entry.state !== "accepted" ||
                entry.recoveredAt !== undefined),
          )
          .map((entry) => entry.call.moduleId),
      );
      for (const key of Object.keys(state.drafts)) ids.add(key.split("/")[0]);
      return {
        ids: [...ids],
        ...(props.online
          ? { modules: [], failures: [] }
          : await offlineRecoveryContracts(state)),
      };
    },
  });
  if (!props.offlineEnabled || !saved.data?.ids.length) return null;
  // Never use stale online metadata as a substitute for an offline signed contract.
  const available = props.online
    ? current.isSuccess &&
      !current.error &&
      Date.now() - current.dataUpdatedAt < 60_000
      ? current.data.modules.map(hydrateModule)
      : []
    : saved.data.modules;
  const catalog = createModuleCatalog(available);
  const modules = available.filter((module) => {
    if (!saved.data.ids.includes(module.id)) return false;
    try {
      catalog.dependencies(module.id);
      return true;
    } catch {
      // Missing dependency metadata must fail closed, not crash recovery of other modules.
      return false;
    }
  });
  return (
    <div>
      <h3>Saved work recovery</h3>
      <p className="small">
        Inspect saved changes and drafts, and resolve original requests even
        after removing a module from this device. Current access and offline
        expiry still apply.
      </p>
      <ErrorMessage
        error={
          saved.error ?? (props.online ? current.error : saved.data.failures[0])
        }
      />
      {modules.map((module) => (
        <ModuleRecovery
          key={`${props.scope.userId}/${props.scope.workspaceId}/${module.id}/${module.version}/${props.online}`}
          {...props}
          moduleCatalog={catalog}
          module={module}
        />
      ))}
    </div>
  );
}
