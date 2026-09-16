import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ui from "@suite/ui-web";
import {
  createModuleClient,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
import {
  moduleContract,
  validateClientArtifacts,
  type ClientViewBundle,
} from "@suite/module-sdk/client-artifact";
import type { ModuleViewProps } from "@suite/module-sdk/ui";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import { canUse, type FeatureProps } from "@suite/platform";
import { verifyArtifact } from "./module-installation";
import { ModuleView } from "./module-view";
import baseCSS from "../../ui-web/src/styles.css?raw";
import controlsCSS from "../../ui-web/src/controls.css?raw";
import listCSS from "../../ui-web/src/work-list.css?raw";
import appCSS from "./styles.css?raw";
const hostCSS = [baseCSS, controlsCSS, listCSS, appCSS]
  .join("\n")
  .replace(/@import\s+[^;]+;/g, "");
type View = React.ComponentType<ModuleViewProps<ModuleDefinition>>;

export async function loadClientView(bundle: ClientViewBundle): Promise<View> {
  const url = URL.createObjectURL(
    new Blob([bundle.javascript], { type: "text/javascript" }),
  );
  try {
    const loaded = await import(/* @vite-ignore */ url);
    if (typeof loaded.createView !== "function")
      throw Error("Module view has no supported factory export.");
    const View = loaded.createView({ react: React, jsx, ui });
    if (
      typeof View !== "function" &&
      !(View && typeof View === "object" && View.$$typeof)
    )
      throw Error(
        "Module view must export a React component through defineView.",
      );
    return View;
  } finally {
    URL.revokeObjectURL(url);
  }
}

class ViewBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <ui.ErrorMessage
        error={
          new Error(
            `This module view could not render: ${this.state.error.message}`,
          )
        }
      />
    ) : (
      this.props.children
    );
  }
}

export function ModuleSurface(
  props: FeatureProps & { pkg: SignedArtifact; publicKey: string },
) {
  const module = React.useMemo(
    () => hydrateModule(moduleContract(props.pkg.artifact)),
    [props.pkg.digest],
  );
  if (!module.navigation?.view)
    return <ModuleView {...props} moduleId={module.id} />;
  return (
    <CustomModuleView
      key={`${props.scope.userId}:${props.scope.workspaceId}:${props.pkg.digest}`}
      {...props}
      module={module}
      viewId={module.navigation.view}
    />
  );
}

function CustomModuleView(
  props: FeatureProps & {
    pkg: SignedArtifact;
    publicKey: string;
    module: ModuleDefinition;
    viewId: string;
  },
) {
  const { module, viewId } = props;
  const view = module.views![viewId];
  const [loaded, setLoaded] = React.useState<{ View: View; css: string }>();
  const [error, setError] = React.useState<unknown>();
  const allowed = canUse(props.bootstrap, module.id, view.permission);
  const latest = React.useRef(props);
  latest.current = props;
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    let active = true;
    if (!allowed) return;
    void (async () => {
      await verifyArtifact(props.pkg, props.publicKey);
      if (!active) return;
      const bundle = validateClientArtifacts(props.pkg.artifact)[viewId];
      const View = await loadClientView(bundle);
      if (active) setLoaded({ View, css: bundle.css });
    })().catch((error) => {
      if (active) setError(error);
    });
    return () => {
      active = false;
    };
  }, [allowed, props.pkg.digest, props.publicKey, viewId]);
  const client = React.useMemo(
    () =>
      createModuleClient(module, async (call) => {
        const current = latest.current;
        if (!mounted.current)
          throw Error(
            "This module view is no longer active. Open it again before sending a request.",
          );
        if (!current.online || !navigator.onLine)
          throw Error(
            "Reconnect before sending this custom-view request. No change has been submitted.",
          );
        const permission =
          call.action === "operation"
            ? module.operations[call.operation!]?.permission
            : `${module.id}.${call.resource}.${["list", "get"].includes(call.action) ? "read" : "write"}`;
        if (!permission || !canUse(current.bootstrap, module.id, permission))
          throw Error(
            "This action is not available with your current permissions.",
          );
        if (
          call.action === "operation" &&
          module.operations[call.operation!].policy === "local"
        )
          throw Error("This operation requires a standalone local workspace.");
        return call.action === "operation"
          ? current.client.request({
              operation: "moduleOperation",
              params: {
                workspaceId: current.scope.workspaceId,
                moduleId: module.id,
                operationName: call.operation!,
              },
              body: call.input,
              idempotencyKey: call.key,
              moduleVersion: call.moduleVersion,
            })
          : current.client.request({
              operation: "moduleRequest",
              params: {
                workspaceId: current.scope.workspaceId,
                moduleId: module.id,
              },
              body: {
                action: call.action,
                resource: call.resource,
                input: call.input,
              },
              idempotencyKey: call.key,
              moduleVersion: call.moduleVersion,
            });
      }),
    [module],
  );
  if (!allowed)
    return (
      <ui.Empty
        title="View unavailable"
        description="Your current permissions do not allow this view."
      />
    );
  if (error) return <ui.ErrorMessage error={error} />;
  if (!loaded) return <ui.Loading />;
  const { View } = loaded;
  return (
    <ViewBoundary>
      <ui.HostCustomSandbox
        label={view.title}
        css={`
          ${hostCSS}\n${loaded.css}
        `}
      >
        <View
          client={client}
          scope={props.scope}
          online={props.online}
          hasPermission={(permission) =>
            canUse(props.bootstrap, module.id, permission)
          }
        />
      </ui.HostCustomSandbox>
    </ViewBoundary>
  );
}
