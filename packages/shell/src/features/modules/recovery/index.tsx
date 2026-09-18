import { ResourceRecovery } from "./resources";
import type { FeatureProps } from "@suite/client";
import { ApiError } from "@suite/client/api";
import { readModuleStorage } from "@suite/client/module-storage";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { ErrorMessage } from "@suite/ui-web";
import { useQuery } from "@tanstack/react-query";
import { usePlatformState } from "../../administration/module-lifecycle";
import { SavedCommands, useQueuedCommands } from "../views/queued-commands";
import { offlineRecoveryContracts } from "./contracts";
import { canReadSavedWork } from "./access";

function ModuleRecovery(
  props: FeatureProps & { module: ModuleDefinition; versions: string[] },
) {
  const state = useQueuedCommands(props, props.module, { kind: "recovery" });
  // Reauthentication can clear native authority while preserving pending input.
  // Restore the original contracts through authenticated transport before
  // advertising this workspace's saved work as ready for offline recovery.
  const originals = useQuery({
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "recovery-contracts",
      props.module.id,
      props.versions,
      props.bootstrap.policyRevision,
    ],
    enabled: props.online && canReadSavedWork(props),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const failures: Error[] = [];
      for (const version of props.versions) {
        try {
          await props.client.request(
            {
              operation: "moduleReceiptArtifact",
              params: {
                workspaceId: props.scope.workspaceId,
                moduleId: props.module.id,
              },
              query: { version },
            },
            { signal },
          );
        } catch (error) {
          signal.throwIfAborted();
          if (
            error instanceof ApiError &&
            (error.status === 401 || error.code === "MEMBERSHIP_REVOKED")
          )
            props.onError(error);
          failures.push(
            Error(
              `Recovery access for release ${version} could not be prepared. ${error instanceof Error ? error.message : "Reconnect and try again."}`,
            ),
          );
        }
      }
      return failures;
    },
  });
  const ready = !props.online || originals.isSuccess;
  return (
    <section aria-label={`${props.module.name} saved work`}>
      <h4>{props.module.name}</h4>
      <ErrorMessage error={originals.error ?? originals.data?.[0]} />
      {props.online && originals.isFetching && !ready && (
        <p role="status">Preparing saved-work access…</p>
      )}
      {ready && (
        <div className="actions">
          <SavedCommands state={state} />
          <ResourceRecovery {...props} />
        </div>
      )}
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
      const versions: Record<string, string[]> = {};
      const add = (id: string, version?: string) => {
        if (!version || !ids.has(id)) return;
        const entries = (versions[id] ??= []);
        if (!entries.includes(version)) entries.push(version);
      };
      for (const entry of state.journal) {
        if (
          entry.userId !== props.scope.userId ||
          entry.workspaceId !== props.scope.workspaceId
        )
          continue;
        add(entry.call.moduleId, entry.call.moduleVersion);
        add(
          entry.call.moduleId,
          state.commandReviews?.[entry.id]?.moduleVersion,
        );
      }
      for (const key of Object.keys(state.drafts)) {
        const id = key.split("/")[0];
        add(id, state.draftVersions?.[key]);
        add(id, state.draftReviews?.[key]?.recoveryInput?.moduleVersion);
        add(id, state.draftReviews?.[key]?.collision?.moduleVersion);
      }
      return {
        ids: [...ids],
        versions,
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
          versions={saved.data.versions[module.id] ?? []}
        />
      ))}
    </div>
  );
}
