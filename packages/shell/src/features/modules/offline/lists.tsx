import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { canUse, type FeatureProps } from "@suite/client";
import type { ModuleDefinition, ResourceListOptions } from "@suite/module-sdk";
import {
  changeModuleStorage,
  readModuleStorage,
} from "@suite/client/module-storage";
import {
  downloadOfflineList,
  removeOfflineList,
  clearRecentResourcePages,
  type OfflineList,
} from "@suite/client/offline-lists";
import { sendModuleCall } from "@suite/client/module-transport";
import {
  Button,
  ErrorMessage,
  Field,
  Input,
  Modal,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { canReadSavedWork } from "../recovery/access";

type Props = FeatureProps & {
  module: ModuleDefinition;
  resource: string;
  query: ResourceListOptions;
  openList(query: ResourceListOptions): void;
  changed(refresh?: boolean): Promise<unknown>;
};
const canManage = (props: Props) =>
  props.bootstrap.offlineHours > 0 &&
  canReadSavedWork(props) &&
  !!props.module.resources[props.resource] &&
  canUse(
    props.bootstrap,
    props.module.id,
    `${props.module.id}.${props.resource}.read`,
    props.moduleCatalog,
  );

/** Resource-owned controls use the current host policy; stored selection never grants access. */
export function OfflineLists(props: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [maxPages, setMaxPages] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const latest = useRef(props);
  latest.current = props;
  const generation = useRef(0);
  const close = () => {
    generation.current++;
    setOpen(false);
    setBusy(false);
  };
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const allowed = canManage(props);
  useEffect(() => {
    close();
  }, [
    props.scope.userId,
    props.scope.workspaceId,
    props.module.id,
    props.module.version,
    props.resource,
    allowed,
  ]);
  const stored = useQuery({
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "offline-lists",
      props.module.id,
      props.module.version,
      props.resource,
    ],
    enabled: open && allowed,
    networkMode: "always",
    queryFn: () => readModuleStorage(props.platform, props.scope),
    staleTime: 0,
  });
  const lists = Object.values(stored.data?.offlineLists ?? {}).filter(
    (list) =>
      list.moduleId === props.module.id && list.resource === props.resource,
  );
  const run = async (
    work: (check: (connected?: boolean) => void) => Promise<string>,
    refresh = false,
  ) => {
    const token = ++generation.current;
    const initial = props;
    const check = (connected = false) => {
      const current = latest.current;
      if (
        generation.current !== token ||
        current.scope.userId !== initial.scope.userId ||
        current.scope.workspaceId !== initial.scope.workspaceId ||
        current.module.id !== initial.module.id ||
        current.module.version !== initial.module.version ||
        current.resource !== initial.resource ||
        !canManage(current) ||
        (connected && (!current.online || !navigator.onLine))
      )
        throw Error(
          "Current access or connectivity changed. Previous offline lists are preserved.",
        );
    };
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      check();
      const message = await work(check);
      check();
      await stored.refetch();
      check();
      await latest.current.changed(refresh);
      if (generation.current === token) setNotice(message);
    } catch (error) {
      if (generation.current === token) setError(error);
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const download = (existing?: OfflineList) =>
    run(async (check) => {
      const list = await downloadOfflineList({
        platform: props.platform,
        scope: props.scope,
        module: props.module,
        resource: props.resource,
        title: existing?.title ?? title,
        query: existing?.query ?? props.query,
        maxPages: existing?.maxPages ?? Number(maxPages),
        existing,
        check: () => check(true),
        send: (call) => sendModuleCall(props.client, props.scope, call),
      });
      return `${list.title}: ${list.records} records downloaded.${list.truncated ? " More records are available online." : ""}`;
    }, true);
  return (
    <>
      <Button
        disabled={!allowed}
        onClick={() => {
          setTitle(
            `${props.module.resources[props.resource].title} offline`.slice(
              0,
              80,
            ),
          );
          setNotice(undefined);
          setError(undefined);
          setOpen(true);
        }}
      >
        Offline lists
      </Button>
      <Modal
        open={open && allowed}
        title="Offline lists"
        description="Keep selected filtered lists on this device. Downloads stay subject to current permissions and the company’s offline access window."
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <ErrorMessage error={error ?? stored.error} />
        {notice && <p role="status">{notice}</p>}
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void download();
          }}
        >
          <h3>Save current filters</h3>
          <Field label="Offline list name">
            <Input
              value={title}
              maxLength={80}
              required
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Record limit">
            <Select
              value={maxPages}
              onValueChange={setMaxPages}
              disabled={busy}
            >
              {[1, 5, 10].map((count) => (
                <SelectOption key={count} value={String(count)}>
                  Up to {(props.query.limit ?? 50) * count} records
                </SelectOption>
              ))}
            </Select>
          </Field>
          <p className="small">
            Starts at the first page using the current search, filters and sort.
            Selected lists share a 50-page, 5 MiB budget. Drafts and pending
            changes are kept separately.
          </p>
          <Button type="submit" disabled={busy || !props.online}>
            {busy ? "Working…" : "Download list"}
          </Button>
        </form>
        <h3>Saved lists</h3>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async (check) => {
              await changeModuleStorage(
                props.platform,
                props.scope,
                (state) => {
                  check();
                  clearRecentResourcePages(state);
                },
              );
              return "Recently viewed pages cleared. Selected lists, drafts and pending changes are unchanged.";
            })
          }
        >
          Clear recently viewed pages
        </Button>
        {stored.isPending ? (
          <p role="status">Loading saved lists…</p>
        ) : lists.length === 0 ? (
          <p>No lists selected for this resource.</p>
        ) : (
          <ul>
            {lists.map((list) => (
              <li key={list.id}>
                <h4>{list.title}</h4>
                <p>
                  {list.records} records. Downloaded{" "}
                  <time dateTime={new Date(list.downloadedAt).toISOString()}>
                    {new Date(list.downloadedAt).toLocaleString()}
                  </time>
                  . {list.truncated && "More records are available online."}
                </p>
                {!list.pages.every((key) => stored.data?.pages[key]) && (
                  <p>
                    Some pages are unavailable. Connect and refresh this list.
                  </p>
                )}
                {list.moduleVersion !== props.module.version && (
                  <p>
                    This list uses release {list.moduleVersion}. Save a new list
                    for the installed release.
                  </p>
                )}
                <div className="actions">
                  <Button
                    aria-label={`Open ${list.title}`}
                    disabled={
                      busy || list.moduleVersion !== props.module.version
                    }
                    onClick={() => {
                      if (canManage(latest.current)) {
                        props.openList(list.query);
                        close();
                      }
                    }}
                  >
                    Open list
                  </Button>
                  <Button
                    aria-label={`Refresh ${list.title}`}
                    disabled={
                      busy ||
                      !props.online ||
                      list.moduleVersion !== props.module.version
                    }
                    onClick={() => void download(list)}
                  >
                    Refresh
                  </Button>
                  <Button
                    aria-label={`Remove ${list.title}`}
                    disabled={busy}
                    onClick={() =>
                      void run(async (check) => {
                        await changeModuleStorage(
                          props.platform,
                          props.scope,
                          (state) => {
                            check();
                            removeOfflineList(state, list.id);
                          },
                        );
                        return "Downloaded list removed. Drafts and pending changes are unchanged.";
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
