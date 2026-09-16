import type { SignedArtifact } from "@suite/module-sdk/platform";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { registerModule } from "@suite/module-catalog";
import type { FeatureProps } from "@suite/platform";
import { readModuleStorage } from "@suite/platform/module-storage";
import { Loading, Empty, ErrorMessage, Button } from "@suite/ui-web";
import { installModule, deviceId, verifyArtifact } from "./module-installation";
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
  const query = useQuery({
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
    ],
    refetchInterval: props.online ? 30000 : false,
    queryFn: async () => {
      const storage = await readModuleStorage(props.platform, props.scope);
      const installed = storage.installed[props.moduleId];
      if (!props.online) {
        const activation = props.bootstrap.modules.find(
          (m) => m.moduleId === props.moduleId,
        );
        if (
          !activation?.entitled ||
          !activation.assigned ||
          activation.state !== "enabled"
        )
          return false;
        if (!installed?.signed || !installed.publicKey) return false;
        await verifyArtifact(installed.signed, installed.publicKey);
        registerModule(
          hydrateModule(
            installed.signed.artifact as unknown as ModuleDefinition,
          ),
        );
        return { pkg: installed.signed, publicKey: installed.publicKey };
      }
      const state = await props.client.request({
        operation: "platformState",
        params: { workspaceId: props.scope.workspaceId },
      });
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
      const definition = state.modules.find((m) => m.id === props.moduleId);
      if (
        device?.state === "installed" &&
        installed?.version === definition?.version &&
        installed.signed &&
        installed.publicKey
      ) {
        try {
          await verifyArtifact(installed.signed, installed.publicKey);
          registerModule(
            hydrateModule(
              installed.signed.artifact as unknown as ModuleDefinition,
            ),
          );
          return { pkg: installed.signed, publicKey: installed.publicKey };
        } catch {
          /* Repair an invalid cached artifact from the official registry. */
        }
      }
      const pkg = await installModule(props, state, props.moduleId);
      registerModule(
        hydrateModule(pkg.artifact as unknown as ModuleDefinition),
      );
      const trust = await props.client.request({ operation: "moduleTrust" });
      return { pkg, publicKey: trust.publicKey };
    },
  });
  if (query.isPending || (query.isFetching && !query.data)) return <Loading />;
  if (query.error)
    return (
      <>
        <ErrorMessage error={query.error} />
        <Button onClick={() => void query.refetch()}>Retry installation</Button>
      </>
    );
  if (!query.data)
    return (
      <>
        <Empty
          title="Module installation required"
          description="Install an assigned, published module to open it on this device."
        />
        <Link to="/modules">Manage modules</Link>
      </>
    );
  return typeof props.children === "function"
    ? props.children(query.data)
    : props.children;
}
