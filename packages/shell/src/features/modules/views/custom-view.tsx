import { readModuleReferences } from "@suite/client/reference-reads";
import { assertReferenceAccess } from "../offline/reference-access";
import type { ReferenceQuery } from "@suite/module-sdk/references";
import { readModuleResource } from "@suite/client/module-reads";
import { canReadSavedWork } from "../recovery/access";
import { sendModuleCall } from "@suite/client/module-transport";
import { SavedCommands, useQueuedCommands } from "./queued-commands";
import { createModuleHost } from "@suite/module-sdk/host-capabilities";
import { executeWebHostCapability } from "@suite/client/host";
import { deviceLeaseAccess, useDeviceLeases } from "./device-leases";
import { browserCapabilityLeases } from "@suite/client/browser";
import { ApiError } from "@suite/client/api";
import { viewHost } from "./view-host";
import { assertViewHost } from "@suite/module-sdk/host-ui";
import * as React from "react";
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
import { canUse, type FeatureProps } from "@suite/client";
import { verifyArtifact } from "../installation";
import { ModuleView } from "./view";
import baseCSS from "@suite/ui-web/styles.css?raw";
import controlsCSS from "@suite/ui-web/controls.css?raw";
import listCSS from "@suite/ui-web/work-list.css?raw";
import appCSS from "../../../styles/index.css?raw";
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
  if (bundle.requires) assertViewHost(bundle.requires, viewHost.capabilities);
  const url = URL.createObjectURL(
    new Blob([bundle.javascript], { type: "text/javascript" }),
  );
  try {
    const loaded = await import(/* @vite-ignore */ url);
    if (typeof loaded.createView !== "function")
      throw Error("Module view has no supported factory export.");
    const View = loaded.createView(viewHost);
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
                latest.current.moduleCatalog,
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
                latest.current.moduleCatalog,
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
  const [downloaded, setDownloaded] = React.useState<{ at: number | null }>();
  const allowed = canUse(
    props.bootstrap,
    module.id,
    view.permission,
    props.moduleCatalog,
  );
  const latest = React.useRef(props);
  latest.current = props;
  const nativeHost = React.useRef<Promise<string> | undefined>(undefined);
  const hostEpoch = React.useRef(0);
  React.useEffect(
    () => () => {
      hostEpoch.current++;
      const previous = nativeHost.current;
      nativeHost.current = undefined;
      void previous
        ?.then((handle) => window.suiteDesktop?.closeModuleHost(handle))
        .catch(() => {});
    },
    [allowed],
  );
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const deviceLeases = useDeviceLeases(
    props,
    module,
    view.permission,
    allowed && !!loaded && !error,
  );
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
  const queued = useQueuedCommands(
    props,
    module,
    { kind: "view", permission: view.permission },
    props.executing,
  );
  const client = React.useMemo(
    () =>
      createModuleClient(
        module,
        async (call, options) => {
          const current = latest.current;
          options?.signal?.throwIfAborted();
          if (!mounted.current)
            throw Error(
              "This module view is no longer active. Open it again before sending a request.",
            );
          const permission =
            call.action === "operation"
              ? module.operations[call.operation!]?.permission
              : `${module.id}.${call.resource}.${["list", "get", "references"].includes(call.action) ? "read" : "write"}`;
          const check = () => {
            options?.signal?.throwIfAborted();
            const active = latest.current;
            if (
              !mounted.current ||
              active.scope.userId !== current.scope.userId ||
              active.scope.workspaceId !== current.scope.workspaceId ||
              active.pkg.digest !== props.pkg.digest
            )
              throw Error(
                "This module view is no longer active. Reopen it before reading records.",
              );
            if (
              !permission ||
              !canUse(
                active.bootstrap,
                module.id,
                view.permission,
                active.moduleCatalog,
              ) ||
              !canUse(
                active.bootstrap,
                module.id,
                permission,
                active.moduleCatalog,
              )
            )
              throw Error(
                "This action is not available with your current permissions.",
              );
          };
          check();
          if (call.action === "references") {
            const result = await readModuleReferences(
              {
                platform: current.platform,
                scope: current.scope,
                module,
                resource: call.resource!,
                online: current.online && navigator.onLine,
                authorization: () => latest.current.bootstrap.policyRevision,
                check: (target) => {
                  check();
                  assertReferenceAccess(
                    latest.current,
                    module,
                    call.resource!,
                    target,
                  );
                },
                canCache: () =>
                  latest.current.bootstrap.offlineHours > 0 &&
                  canReadSavedWork(latest.current),
                send: (input, readOptions) =>
                  sendModuleCall(
                    current.client,
                    current.scope,
                    { ...call, input },
                    readOptions,
                  ),
              },
              call.input as ReferenceQuery,
              options,
            );
            check();
            if (result.read?.source === "cache") {
              const at = result.read.downloadedAt;
              setDownloaded((previous) => ({
                at:
                  previous?.at === null || at === null
                    ? null
                    : Math.min(previous?.at ?? at, at),
              }));
            }
            return result;
          }
          if (call.action === "get" || call.action === "list") {
            const checkRead = () => {
              check();
              const active = latest.current;
              if (
                (!active.online || !navigator.onLine) &&
                (active.bootstrap.offlineHours <= 0 ||
                  !canReadSavedWork(active))
              )
                throw Error(
                  "Offline access expired or changed. Reconnect to verify access.",
                );
            };
            const result = await readModuleResource(
              {
                platform: current.platform,
                scope: current.scope,
                module,
                online: current.online && navigator.onLine,
                check: checkRead,
                canCache: () =>
                  latest.current.bootstrap.offlineHours > 0 &&
                  canReadSavedWork(latest.current),
                send: (request, readOptions) =>
                  sendModuleCall(
                    current.client,
                    current.scope,
                    request,
                    readOptions,
                  ),
              },
              call,
              options,
            );
            checkRead();
            const metadata = result.read;
            if (metadata.source === "cache")
              setDownloaded((previous) => ({
                at:
                  previous?.at === null || metadata.downloadedAt === null
                    ? null
                    : Math.min(
                        previous?.at ?? metadata.downloadedAt,
                        metadata.downloadedAt,
                      ),
              }));
            return result;
          }
          if (!current.online || !navigator.onLine)
            throw Error(
              "Reconnect before sending this custom-view request. No change has been submitted.",
            );
          if (
            call.action === "operation" &&
            module.operations[call.operation!].policy === "local"
          )
            throw Error(
              "This operation requires a standalone local workspace.",
            );
          const mutation =
            call.kind !== "query" &&
            !["list", "get", "references"].includes(call.action);
          if (mutation) current.executing?.(1);
          try {
            return await sendModuleCall(
              current.client,
              current.scope,
              call,
              options,
            );
          } finally {
            if (mutation) current.executing?.(-1);
          }
        },
        queued.queue,
      ),
    [module, props.bootstrap, props.online, queued.queue],
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
      {deviceLeases.message && (
        <p role="status" className="muted">
          {deviceLeases.message}
        </p>
      )}
      {downloaded && (
        <p role="status" className="muted">
          This view has used downloaded records.{" "}
          {downloaded.at === null
            ? "Their download time is unknown."
            : `Oldest download used: ${new Date(downloaded.at).toLocaleString()}.`}{" "}
          Reconnect and reload the view for current server data.
        </p>
      )}
      <SavedCommands state={queued} />
      <ui.HostCustomSandbox
        label={view.title}
        css={`
          ${hostCSS}\n${loaded.css}
        `}
      >
        <View
          state={props.editable}
          host={createModuleHost(module, async (call) => {
            const epoch = hostEpoch.current;
            const check = () => {
              const current = latest.current;
              const permission =
                module.capabilities?.[call.capability]?.permission;
              if (!mounted.current || epoch !== hostEpoch.current)
                throw Error(
                  "This module view is no longer active. Reopen it before using a host action.",
                );
              if (
                !permission ||
                !canUse(
                  current.bootstrap,
                  module.id,
                  permission,
                  current.moduleCatalog,
                ) ||
                !canUse(
                  current.bootstrap,
                  module.id,
                  view.permission,
                  current.moduleCatalog,
                )
              )
                throw Error(
                  "Your current permissions do not allow this host action.",
                );
              return current;
            };
            const current = check();
            if (window.suiteDesktop) {
              nativeHost.current ??= window.suiteDesktop.openModuleHost(
                current.scope,
                module.id,
                module.version,
              );
              const handle = await nativeHost.current;
              check();
              return window.suiteDesktop.moduleCapability(
                handle,
                call.capability,
                call.input,
              );
            }
            if (!current.online || !navigator.onLine) {
              if (module.capabilities?.[call.capability]?.offline !== "lease")
                throw Error("Reconnect before using this host action.");
              const live = () => {
                const active = check();
                if (active.online && navigator.onLine)
                  throw Error(
                    "Connection restored. Retry this action with current server authorization.",
                  );
                return deviceLeaseAccess(active);
              };
              try {
                const lease = await browserCapabilityLeases.prepare(
                  current.scope,
                  module,
                  call,
                  live,
                );
                await lease.recheck();
                live();
                return executeWebHostCapability(
                  lease.authorization,
                  call,
                  current.scope,
                );
              } catch (error) {
                deviceLeases.unavailable();
                throw error;
              }
            }
            let authorization;
            try {
              authorization = await current.client.request({
                operation: "moduleCapabilityAuthorize",
                params: {
                  workspaceId: current.scope.workspaceId,
                  moduleId: module.id,
                },
                moduleVersion: module.version,
                body: { capability: call.capability },
              });
            } catch (error) {
              if (
                error instanceof ApiError &&
                error.status >= 400 &&
                error.status < 500
              ) {
                deviceLeases.unavailable();
                await browserCapabilityLeases
                  .invalidate(current.scope)
                  .catch(() => {});
              }
              throw error;
            }
            const final = check();
            if (!final.online || !navigator.onLine)
              throw Error("Reconnect before using this host action.");
            return executeWebHostCapability(authorization, call, current.scope);
          })}
          client={client}
          scope={props.scope}
          online={props.online}
          hasPermission={(permission) =>
            canUse(props.bootstrap, module.id, permission, props.moduleCatalog)
          }
        />
        <ReportRendered ready={() => props.rendered?.(props.pkg.digest)} />
      </ui.HostCustomSandbox>
    </ViewBoundary>
  );
}
