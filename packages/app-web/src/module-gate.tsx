import { ApiError } from "@suite/api-client";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import { useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { moduleDependencies, registerModule } from "@suite/module-catalog";
import type { FeatureProps } from "@suite/platform";
import { readModuleStorage } from "@suite/platform/module-storage";
import {
  Loading,
  Empty,
  ErrorMessage,
  Button,
  PreservedSurface,
} from "@suite/ui-web";
import {
  installModule,
  deviceId,
  verifiedInstalledModule,
} from "./module-installation";
export function ModuleGate(
  props: FeatureProps & {
    moduleId: string;
    children:
      | ReactNode
      | ((installation: {
          pkg: SignedArtifact;
          publicKey: string;
        }) => ReactNode);
  },
) {
  const qc = useQueryClient();
  const query = useQuery<false | { pkg: SignedArtifact; publicKey: string }>({
    networkMode: "always",
    staleTime: 0,
    placeholderData: (previous, query) =>
      query?.queryKey[0] === props.scope.userId &&
      query.queryKey[1] === props.scope.workspaceId &&
      query.queryKey[3] === props.moduleId
        ? previous
        : undefined,
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "runtime-installation",
      props.moduleId,
      props.online,
      props.bootstrap.policyRevision ?? "0",
    ],
    refetchInterval: props.online ? 30000 : false,
    queryFn: async ({ signal }) => {
      const storage = await readModuleStorage(props.platform, props.scope);
      if (!props.online) {
        const verified = await verifiedInstalledModule(
          props,
          storage,
          props.moduleId,
        );
        if (!verified) return false;
        registerModule(
          hydrateModule(verified.pkg.artifact as unknown as ModuleDefinition),
        );
        return verified;
      }
      const state = await props.client.request({
        operation: "platformState",
        params: { workspaceId: props.scope.workspaceId },
      });
      qc.setQueryData(
        [props.scope.userId, props.scope.workspaceId, "platform"],
        state,
      );
      const activation = props.bootstrap.modules.find(
        (m) => m.moduleId === props.moduleId,
      );
      if (
        !activation?.entitled ||
        !activation.assigned ||
        activation.state !== "enabled"
      )
        return false;
      const device = state.installations.find(
        (i) => i.module_id === props.moduleId && i.device_id === deviceId(),
      );
      if (device?.state === "removed") return false;
      if (storage.lifecycle?.[props.moduleId]?.action === "uninstall")
        return false;
      if (!storage.lifecycle?.[props.moduleId]) {
        try {
          const verified = await verifiedInstalledModule(
            props,
            storage,
            props.moduleId,
            state,
          );
          if (verified) {
            registerModule(
              hydrateModule(
                verified.pkg.artifact as unknown as ModuleDefinition,
              ),
            );
            return verified;
          }
        } catch {
          /* Repair a corrupt local release set through the registry. */
        }
      }
      const installed = await installModule(
        props,
        state,
        props.moduleId,
        false,
        () => !signal.aborted,
      );
      if (!installed) return false;
      registerModule(
        hydrateModule(installed.pkg.artifact as unknown as ModuleDefinition),
      );
      // Publish the committed receipt to administration immediately. Waiting
      // for the entire background catalog leaves already-open modules mislabeled.
      await Promise.all(
        ["platform", "lifecycle-storage"].map((key) =>
          qc.invalidateQueries({
            queryKey: [props.scope.userId, props.scope.workspaceId, key],
          }),
        ),
      );
      return installed;
    },
  });
  const retained = useRef<ReactNode>(null);
  const permitted = moduleDependencies(props.moduleId).every((id) =>
    props.bootstrap.modules.some(
      (m) =>
        m.moduleId === id && m.state === "enabled" && m.assigned && m.entitled,
    ),
  );
  const accessDenied =
    query.error instanceof ApiError && [401, 403].includes(query.error.status);
  const visible = permitted && !!query.data && !accessDenied;
  if (visible && query.data)
    retained.current =
      typeof props.children === "function"
        ? props.children(query.data)
        : props.children;
  return (
    <>
      {!permitted ? (
        <Empty
          title="Module access paused"
          description="This module or a required dependency is unavailable. Input in this open view is kept for when your access is restored. Saved pending work remains on this device."
        />
      ) : query.isPending || (query.isFetching && !query.data) ? (
        <Loading />
      ) : query.error ? (
        <div>
          <ErrorMessage error={query.error} />
          <Button onClick={() => void query.refetch()}>
            Retry installation
          </Button>
        </div>
      ) : !query.data ? (
        <>
          <Empty
            title="Module installation required"
            description="Install an assigned, published module to open it on this device."
          />
          <Link to="/modules">Manage modules</Link>
        </>
      ) : null}
      <PreservedSurface visible={visible}>{retained.current}</PreservedSurface>
    </>
  );
}
