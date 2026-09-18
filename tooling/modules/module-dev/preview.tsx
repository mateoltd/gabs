import type { ModuleQueue } from "@suite/module-sdk";
import {
  createModuleHost,
  type HostCapabilityCall,
} from "@suite/module-sdk/host-capabilities";
import { describeViewHost } from "@suite/module-sdk/host-ui";
export { referenceFields } from "@suite/module-sdk/references";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import * as ui from "@suite/ui-web";
import {
  createModuleClient,
  hydrateModule,
  type ModuleTransport,
  type ModuleDefinition,
} from "@suite/module-sdk";
import {
  checkpointValue,
  restoreViewCheckpoint,
  type ModuleViewProps,
  type EditableViewState,
  type ViewStateMetadata,
} from "@suite/module-sdk/ui";
import type { DevState } from "./contracts";

type View = React.ComponentType<
  ModuleViewProps<ModuleDefinition> & { state?: EditableViewState<unknown> }
> & { suiteViewState?: ViewStateMetadata };
type Transport = ModuleTransport;
const hostCSS = fetch("/host.css").then(async (response) => {
  if (!response.ok) throw Error("The host UI stylesheet could not be loaded.");
  return (
    (await response.text()).replaceAll(":root", ":host") +
    "\n:host{font:13px/1.5 var(--font);color-scheme:light;padding:20px;border-radius:var(--radius-panel);border:1px solid var(--border)}"
  );
});
// Attach a rejection handler immediately; the rendered surface reports the error.
void hostCSS.catch(() => {});

class Boundary extends React.Component<
  { children: React.ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p role="alert">
        The custom view failed: {this.state.error.message}. Fix the view source
        to reload it.
      </p>
    ) : (
      this.props.children
    );
  }
}

function Surface({
  data,
  viewId,
  send,
  sendHost,
  queue,
}: {
  data: DevState;
  viewId: string;
  send: Transport;
  sendHost: (call: HostCapabilityCall) => Promise<unknown>;
  queue: ModuleQueue;
}) {
  const module = React.useMemo(
    () => hydrateModule(data.module),
    [data.revision],
  );
  const view = module.views![viewId];
  const [loaded, setLoaded] = React.useState<{ View: View; css: string }>();
  const [error, setError] = React.useState<unknown>();
  const [value, setValue] = React.useState<unknown>();
  const latest = React.useRef({ data, send, sendHost, queue, active: true });
  latest.current.data = data;
  latest.current.send = send;
  latest.current.sendHost = sendHost;
  latest.current.queue = queue;
  React.useEffect(() => {
    latest.current.active = true;
    return () => {
      latest.current.active = false;
    };
  }, []);
  React.useEffect(() => {
    let active = true;
    void (async () => {
      const bundle = await import(
        /* @vite-ignore */ `/views/${viewId}.js?revision=${encodeURIComponent(data.revision)}`
      );
      if (typeof bundle.createView !== "function")
        throw Error("The view must export a supported factory.");
      const View = bundle.createView({
        react: React,
        jsx,
        ui,
        capabilities: describeViewHost(
          { react: React, jsx, ui },
          { queuedCommands: true },
        ),
      }) as View;
      if (
        typeof View !== "function" &&
        !(View && typeof View === "object" && "$$typeof" in View)
      )
        throw Error(
          "The view must export a React component through defineView.",
        );
      if (view.state) {
        if (!View.suiteViewState)
          throw Error(
            "The view does not expose its declared editable-state contract.",
          );
        restoreViewCheckpoint(module, viewId, View.suiteViewState, undefined);
      }
      const css = await hostCSS;
      if (active) setLoaded({ View, css });
    })().catch((error) => {
      if (active) setError(error);
    });
    return () => {
      active = false;
    };
  }, [data.revision, viewId]);
  const authorization = JSON.stringify([
    data.online,
    data.permissions,
    data.grants,
    data.readGrants,
    data.members,
    Object.entries(data.providers).map(([id, provider]) => [
      id,
      provider.permissions,
    ]),
  ]);
  const client = React.useMemo(
    () =>
      createModuleClient(
        module,
        (call, options) => {
          if (
            !latest.current.active ||
            !latest.current.data.permissions.includes(view.permission)
          )
            return Promise.reject(
              Error("This preview is no longer active or authorized."),
            );
          return latest.current.send(call, options);
        },
        {
          capture: (call, dependencies) => {
            if (
              !latest.current.active ||
              !latest.current.data.permissions.includes(view.permission)
            )
              throw Error("This preview is no longer active or authorized.");
            return latest.current.queue.capture(call, dependencies);
          },
          get: (identity) => {
            if (
              !latest.current.active ||
              !latest.current.data.permissions.includes(view.permission)
            )
              throw Error("This preview is no longer active or authorized.");
            return latest.current.queue.get(identity);
          },
        },
      ),
    [module, view.permission, authorization],
  );
  const host = React.useMemo(
    () =>
      createModuleHost(module, (call) => {
        if (
          !latest.current.active ||
          !latest.current.data.permissions.includes(view.permission)
        )
          return Promise.reject(
            Error("This preview is no longer active or authorized."),
          );
        return latest.current.sendHost(call);
      }),
    [module, view.permission, authorization],
  );
  if (error)
    return (
      <p role="alert">
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  if (!loaded) return <p role="status">Loading custom view…</p>;
  const editable: EditableViewState<unknown> | undefined = view.state
    ? {
        value,
        save(next) {
          setValue(checkpointValue(view.state!.schema, next));
        },
        clear() {
          setValue(undefined);
        },
      }
    : undefined;
  return (
    <ui.HostCustomSandbox
      label={view.title}
      css={`
        ${loaded.css}\n${data.views[viewId].css}
      `}
    >
      <loaded.View
        host={host}
        client={client}
        scope={data.scope}
        online={data.online}
        hasPermission={(permission) => data.permissions.includes(permission)}
        state={editable}
      />
    </ui.HostCustomSandbox>
  );
}

function Preview({
  data,
  send,
  sendHost,
  queue,
}: {
  data: DevState;
  send: Transport;
  sendHost: (call: HostCapabilityCall) => Promise<unknown>;
  queue: ModuleQueue;
}) {
  const selectId = React.useId();
  const names = Object.keys(data.module.views ?? {});
  const [viewId, setViewId] = React.useState(
    data.module.navigation?.view ?? names[0],
  );
  const view = data.module.views?.[viewId];
  return (
    <>
      <label htmlFor={selectId}>Preview view</label>
      <select
        id={selectId}
        value={viewId}
        onChange={(event) => setViewId(event.target.value)}
      >
        {names.map((name) => (
          <option key={name} value={name}>
            {data.module.views![name].title}
          </option>
        ))}
      </select>
      {view && data.permissions.includes(view.permission) ? (
        <Boundary key={`${data.revision}:${viewId}`}>
          <Surface
            data={data}
            viewId={viewId}
            send={send}
            sendHost={sendHost}
            queue={queue}
          />
        </Boundary>
      ) : (
        <p role="status">Your simulated permissions do not allow this view.</p>
      )}
    </>
  );
}
let root: Root | undefined;
export function updatePreview(
  data: DevState,
  send: Transport,
  sendHost: (call: HostCapabilityCall) => Promise<unknown>,
  queue: ModuleQueue,
) {
  const section = document.getElementById("custom-preview")!;
  section.hidden = !Object.keys(data.module.views ?? {}).length;
  if (section.hidden) return;
  root ??= createRoot(document.getElementById("preview-root")!);
  root.render(
    <Preview
      key={data.revision}
      data={data}
      send={send}
      sendHost={sendHost}
      queue={queue}
    />,
  );
}
export function hidePreview() {
  root?.unmount();
  root = undefined;
  document.getElementById("custom-preview")!.hidden = true;
}
