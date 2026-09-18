import { canUse, type FeatureProps } from "@suite/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

export const peerCount = (count: number) =>
  `${count} ${count === 1 ? "peer" : "peers"} connected`;

/** One scoped subscription feeds both the persistent shell and Settings. */
export function useLocalNetwork(features: FeatureProps | undefined) {
  const native = window.suiteDesktop;
  const client = useQueryClient();
  const userId = features?.scope.userId,
    workspaceId = features?.scope.workspaceId;
  const key = useMemo(
    () => [userId, workspaceId, "lan"],
    [userId, workspaceId],
  );
  const grants =
    features?.moduleCatalog.modules.flatMap((module) =>
      Object.entries(module.capabilities ?? {}).flatMap(
        ([capability, declaration]) => {
          const view = module.navigation?.view
            ? module.views?.[module.navigation.view]
            : undefined;
          return declaration.kind === "lan.relay" &&
            canUse(
              features.bootstrap,
              module.id,
              declaration.permission,
              features.moduleCatalog,
            ) &&
            (!view || features.bootstrap.permissions.includes(view.permission))
            ? [
                {
                  moduleId: module.id,
                  moduleVersion: module.version,
                  capability,
                  name: module.name,
                  offline: declaration.offline === "lease",
                  key: `${module.id}/${module.version}/${capability}`,
                },
              ]
            : [];
        },
      ),
    ) ?? [];
  const enabled =
    !!native &&
    !!features &&
    features.bootstrap.workspace.kind === "company" &&
    (features.bootstrap.permissions.includes("modules.manage") ||
      grants.length > 0);
  const state = useQuery({
    queryKey: key,
    enabled,
    queryFn: async ({ signal }) => {
      const status = await native!.lanStatus({
        userId: userId!,
        workspaceId: workspaceId!,
      });
      signal.throwIfAborted();
      return status;
    },
    networkMode: "always",
    gcTime: 0,
    retry: false,
    refetchInterval: enabled ? 15000 : false,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (!enabled || !native) {
      void client.resetQueries({ queryKey: key, exact: true });
      return;
    }
    return native.onLanChanged(() => {
      // Discard the old status immediately and cancel any earlier response.
      void client.resetQueries({ queryKey: key, exact: true });
    });
  }, [client, enabled, key, native]);
  return {
    ...state,
    allowed: enabled,
    grants,
    data: enabled && !state.isError ? state.data : undefined,
  };
}
export type LocalNetworkState = ReturnType<typeof useLocalNetwork>;

export function LocalNetworkStatus({
  network,
}: {
  network: LocalNetworkState;
}) {
  const status = network.data;
  const [wasEnabled, setWasEnabled] = useState(false);
  useEffect(() => {
    if (!network.allowed || status) setWasEnabled(!!status?.enabled);
  }, [network.allowed, status]);
  const checking = network.isPending && wasEnabled;
  if (!network.allowed || (!status?.enabled && !checking)) return null;
  // Keep a focused link mounted while its old count is being revalidated.
  const label = checking
    ? "Local network: checking status"
    : `Local network: ${peerCount(status!.peers.length)}`;
  return (
    <footer className="workspace-status" aria-label="Workspace status">
      <Link
        to="/settings#local-network"
        aria-label={`${label}. Open settings`}
        onClick={() => document.getElementById("local-network")?.focus()}
      >
        {label}
      </Link>
    </footer>
  );
}
