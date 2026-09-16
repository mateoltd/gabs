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
import {
  checkpointValue,
  restoreViewCheckpoint,
  type ModuleViewProps,
  type EditableViewState,
  type ViewCheckpoint,
  type ViewStateMetadata,
} from "@suite/module-sdk/ui";
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
type View = React.ComponentType<
  ModuleViewProps<ModuleDefinition> & { state?: EditableViewState<unknown> }
> & { suiteViewState?: ViewStateMetadata };
type LoadedView = { View: View; css: string };
type SurfaceState = {
  editable?: EditableViewState<unknown>;
  prepared?: LoadedView;
  executing?: (change: 1 | -1) => void;
  rendered?: (digest: string) => void;
  renderFailed?: (digest: string, error: Error) => void;
};

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
  { children: React.ReactNode; onError?: (error: Error) => void },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
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

function ReportRendered({ ready }: { ready: () => void }) {
  React.useLayoutEffect(ready, []);
  return null;
}

export function ModuleSurface(
  props: FeatureProps & { pkg: SignedArtifact; publicKey: string },
) {
  return (
    <SurfaceSession
      key={`${props.scope.userId}:${props.scope.workspaceId}:${props.pkg.module_id}`}
      {...props}
    />
  );
}

function SurfaceSession(
  props: FeatureProps & { pkg: SignedArtifact; publicKey: string },
) {
  const [installed, setInstalled] = React.useState({
    pkg: props.pkg,
    publicKey: props.publicKey,
  });
  const [review, setReview] = React.useState(false);
  const [checkpoint, setCheckpoint] = React.useState<ViewCheckpoint>();
  const checkpointRef = React.useRef(checkpoint);
  const activeDigest = React.useRef(installed.pkg.digest);
  const latest = React.useRef(props);
  latest.current = props;
  const [candidate, setCandidate] = React.useState<
    LoadedView & { digest: string }
  >();
  const [updateError, setUpdateError] = React.useState<unknown>();
  const [prepared, setPrepared] = React.useState<LoadedView>();
  const rollback = React.useRef<{
    target: string;
    installed: typeof installed;
    prepared: LoadedView | undefined;
    checkpoint: ViewCheckpoint | undefined;
  }>(undefined);
  const activeRequests = React.useRef(0);
  const [executing, setExecuting] = React.useState(false);
  const trackExecution = React.useCallback((change: 1 | -1) => {
    activeRequests.current += change;
    setExecuting(activeRequests.current > 0);
  }, []);
  const custom =
    moduleContract(installed.pkg.artifact).navigation?.view ||
    moduleContract(props.pkg.artifact).navigation?.view;
  // Generated forms retain their React state across schema changes. Arbitrary
  // custom component state cannot be transferred without a publisher contract.
  if (!custom && installed.pkg.digest !== props.pkg.digest)
    setInstalled({ pkg: props.pkg, publicKey: props.publicKey });
  const active = custom
    ? installed
    : { pkg: props.pkg, publicKey: props.publicKey };
  const pending = active.pkg.digest !== props.pkg.digest;
  const runningModule = React.useMemo(
    () => hydrateModule(moduleContract(active.pkg.artifact)),
    [active.pkg.digest],
  );
  const viewId = runningModule.navigation?.view;
  const view = viewId ? runningModule.views?.[viewId] : undefined;
  const targetModule = React.useMemo(
    () => hydrateModule(moduleContract(props.pkg.artifact)),
    [props.pkg.digest],
  );
  const targetId = targetModule.navigation?.view;
  const supportsTransfer = !!(
    view?.state &&
    targetId &&
    targetModule.views?.[targetId]?.state
  );
  React.useEffect(() => {
    let active = true;
    setCandidate(undefined);
    if (pending && supportsTransfer && targetId)
      void (async () => {
        await verifyArtifact(props.pkg, props.publicKey);
        const bundle = validateClientArtifacts(props.pkg.artifact)[targetId];
        const View = await loadClientView(bundle);
        if (!View.suiteViewState)
          throw Error(
            "This release does not expose its declared editable-state contract.",
          );
        restoreViewCheckpoint(
          targetModule,
          targetId,
          View.suiteViewState,
          undefined,
        );
        if (active)
          setCandidate({ View, css: bundle.css, digest: props.pkg.digest });
      })().catch((error) => {
        if (active) setUpdateError(error);
      });
    return () => {
      active = false;
    };
  }, [props.pkg.digest, props.publicKey, pending, supportsTransfer, targetId]);
  React.useEffect(() => setUpdateError(undefined), [props.pkg.digest]);
  const adopt = (keepInput: boolean) => {
    try {
      if (activeRequests.current)
        throw Error(
          "Wait for the current request to finish before updating this view.",
        );
      let next: ViewCheckpoint | undefined;
      if (keepInput) {
        if (
          !candidate ||
          candidate.digest !== props.pkg.digest ||
          !targetId ||
          !candidate.View.suiteViewState
        )
          throw Error(
            "The updated view is not ready. Keep the current view and try again.",
          );
        try {
          next = restoreViewCheckpoint(
            targetModule,
            targetId,
            candidate.View.suiteViewState,
            checkpointRef.current,
          );
        } catch (cause) {
          throw new Error(
            "This update could not preserve your input. Your current view remains open.",
            { cause },
          );
        }
      }
      rollback.current = keepInput
        ? {
            target: props.pkg.digest,
            installed,
            prepared,
            checkpoint: checkpointRef.current,
          }
        : undefined;
      checkpointRef.current = next;
      setCheckpoint(next);
      activeDigest.current = props.pkg.digest;
      setPrepared(
        candidate?.digest === props.pkg.digest ? candidate : undefined,
      );
      setInstalled({ pkg: props.pkg, publicKey: props.publicKey });
      setUpdateError(undefined);
      setReview(false);
    } catch (error) {
      setUpdateError(error);
    }
  };
  const editable: EditableViewState<unknown> | undefined =
    view?.state && viewId
      ? {
          value: checkpoint?.value,
          save: (value) => {
            if (
              activeDigest.current !== active.pkg.digest ||
              !canUse(
                latest.current.bootstrap,
                runningModule.id,
                view.permission,
              )
            )
              throw Error(
                "This editable view is no longer active or authorized.",
              );
            const next = Object.freeze({
              viewId,
              moduleVersion: runningModule.version,
              version: view.state!.version,
              value: checkpointValue(view.state!.schema, value),
            });
            checkpointRef.current = next;
            setCheckpoint(next);
          },
          clear: () => {
            if (
              activeDigest.current !== active.pkg.digest ||
              !canUse(
                latest.current.bootstrap,
                runningModule.id,
                view.permission,
              )
            )
              throw Error(
                "This editable view is no longer active or authorized.",
              );
            checkpointRef.current = undefined;
            setCheckpoint(undefined);
          },
        }
      : undefined;
  return (
    <>
      {pending && (
        <div className="notice" role="status">
          <span>
            Version {props.pkg.version} is ready. Your current view remains
            open.
          </span>
          <ui.Button onClick={() => setReview(true)}>
            Review module update
          </ui.Button>
        </div>
      )}
      <InstalledSurface
        {...props}
        {...active}
        editable={editable}
        prepared={prepared}
        executing={trackExecution}
        rendered={(digest) => {
          if (rollback.current?.target === digest) rollback.current = undefined;
        }}
        renderFailed={(digest, error) => {
          const previous = rollback.current;
          if (!previous || previous.target !== digest) return;
          rollback.current = undefined;
          activeDigest.current = previous.installed.pkg.digest;
          checkpointRef.current = previous.checkpoint;
          setCheckpoint(previous.checkpoint);
          setInstalled(previous.installed);
          setPrepared(previous.prepared);
          setUpdateError(
            new Error(
              "The updated view could not render. Your previous input is preserved.",
              { cause: error },
            ),
          );
          setReview(true);
        }}
      />
      <ui.Modal
        open={review && pending}
        onOpenChange={setReview}
        title="Update this module"
        description={
          supportsTransfer
            ? "Keep your input while updating this view. The new release validates any converted input before replacing the current view."
            : "This custom view cannot automatically transfer its unsaved input. Copy or finish your work before replacing it."
        }
      >
        <ui.ErrorMessage error={updateError} />
        {executing && (
          <p role="status">
            Waiting for the current request to finish before updating this view.
          </p>
        )}
        <div className="actions">
          <ui.Button onClick={() => setReview(false)}>
            Keep current view
          </ui.Button>
          {supportsTransfer && (
            <ui.Button
              disabled={
                executing || !candidate || candidate.digest !== props.pkg.digest
              }
              onClick={() => adopt(true)}
            >
              Update and keep input
            </ui.Button>
          )}
          <ui.Button disabled={executing} onClick={() => adopt(false)}>
            Discard unsaved input and update
          </ui.Button>
        </div>
      </ui.Modal>
    </>
  );
}

function InstalledSurface(
  props: FeatureProps & {
    pkg: SignedArtifact;
    publicKey: string;
  } & SurfaceState,
) {
  const module = React.useMemo(
    () => hydrateModule(moduleContract(props.pkg.artifact)),
    [props.pkg.digest],
  );
  if (!module.navigation?.view)
    return (
      <ModuleView
        key={`${props.scope.userId}:${props.scope.workspaceId}:${module.id}`}
        {...props}
        module={module}
      />
    );
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
  } & SurfaceState,
) {
  const { module, viewId } = props;
  const view = module.views![viewId];
  const [loaded, setLoaded] = React.useState<LoadedView | undefined>(
    props.prepared,
  );
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
    if (props.prepared) {
      setLoaded(props.prepared);
      return;
    }
    void (async () => {
      await verifyArtifact(props.pkg, props.publicKey);
      if (!active) return;
      const bundle = validateClientArtifacts(props.pkg.artifact)[viewId];
      const View = await loadClientView(bundle);
      if (view.state) {
        if (!View.suiteViewState)
          throw Error(
            "This release does not expose its declared editable-state contract.",
          );
        restoreViewCheckpoint(module, viewId, View.suiteViewState, undefined);
      }
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
        const mutation =
          call.kind !== "query" && !["list", "get"].includes(call.action);
        if (mutation) current.executing?.(1);
        try {
          return await (call.action === "operation"
            ? current.client.request({
                operation:
                  call.kind === "query" ? "moduleQuery" : "moduleOperation",
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
              }));
        } finally {
          if (mutation) current.executing?.(-1);
        }
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
    <ViewBoundary
      onError={(error) => props.renderFailed?.(props.pkg.digest, error)}
    >
      <ui.HostCustomSandbox
        label={view.title}
        css={`
          ${hostCSS}\n${loaded.css}
        `}
      >
        <View
          state={props.editable}
          client={client}
          scope={props.scope}
          online={props.online}
          hasPermission={(permission) =>
            canUse(props.bootstrap, module.id, permission)
          }
        />
        <ReportRendered ready={() => props.rendered?.(props.pkg.digest)} />
      </ui.HostCustomSandbox>
    </ViewBoundary>
  );
}
