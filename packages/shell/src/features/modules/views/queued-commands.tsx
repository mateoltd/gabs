import { CommandCorrection } from "./command-correction";
import {
  commandDependents,
  commandReview,
  saveCommandReview,
  replaceCommand,
  type CommandReview,
  type CommandContinuation,
} from "@suite/client/command-recovery";
import * as React from "react";
import * as ui from "@suite/ui-web";
import { canReadSnapshot, canUse, type FeatureProps } from "@suite/client";
import { createModuleQueue } from "@suite/client/module-queue";
import {
  readModuleStorage,
  syncModuleStorage,
} from "@suite/client/module-storage";
import {
  responseContract,
  validateModuleResponse,
} from "@suite/client/module-response";
import { settleJournalEntry } from "@suite/client/module-settlement";
import { sendModuleCall } from "@suite/client/module-transport";
import type {
  ModuleCall,
  ModuleDefinition,
  ModuleQueue,
} from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";

type SavedCommand = {
  entry: JournalEntry;
  module: ModuleDefinition;
  review?: CommandReview;
  dependents: { entry: JournalEntry; module: ModuleDefinition }[];
};

/** A view owns access, while the journal owns durable input and delivery identities. */
export function useQueuedCommands(
  props: FeatureProps,
  module: ModuleDefinition,
  viewPermission: string,
  executing?: (change: 1 | -1) => void,
) {
  const latest = React.useRef({ props, executing });
  latest.current = { props, executing };
  const mounted = React.useRef(false);
  const [commands, setCommands] = React.useState<SavedCommand[]>([]);
  const [error, setError] = React.useState<unknown>();
  const [busy, setBusy] = React.useState(false);
  const refreshing = React.useRef(false);
  const synchronizing = React.useRef(false);
  const access = (call?: ModuleCall, connected = false) => {
    const p = latest.current.props;
    if (
      !mounted.current ||
      !p.offlineEnabled ||
      p.scope.userId !== props.scope.userId ||
      p.scope.workspaceId !== props.scope.workspaceId ||
      !canUse(p.bootstrap, module.id, viewPermission, p.moduleCatalog)
    )
      return false;
    if (call) {
      const operation = module.operations[call.operation ?? ""];
      if (
        call.moduleId !== module.id ||
        call.action !== "operation" ||
        !operation ||
        operation.policy !== "queued" ||
        operation.kind === "query" ||
        operation.serviceOnly ||
        !canUse(p.bootstrap, module.id, operation.permission, p.moduleCatalog)
      )
        return false;
    }
    const now = Date.now();
    const authorizedAt = Date.parse(p.bootstrap.authorizedAt);
    if (p.online && navigator.onLine)
      return (
        authorizedAt <= now &&
        now <
          authorizedAt + Math.max(p.bootstrap.offlineHours, 1 / 60) * 3600000
      );
    if (
      connected ||
      !canReadSnapshot(p.snapshot, now) ||
      p.snapshot.bootstrap.workspace.id !== p.scope.workspaceId ||
      p.snapshot.bootstrap.authorizedAt !== p.bootstrap.authorizedAt
    )
      return false;
    return (
      now < authorizedAt + Math.min(p.bootstrap.offlineHours, 24) * 3600000
    );
  };
  const refresh = async () => {
    if (refreshing.current) return;
    if (!access()) {
      setCommands([]);
      return;
    }
    refreshing.current = true;
    try {
      const p = latest.current.props;
      const state = await readModuleStorage(p.platform, p.scope);
      const saved: SavedCommand[] = [];
      for (const entry of state.journal) {
        if (
          entry.userId !== p.scope.userId ||
          entry.workspaceId !== p.scope.workspaceId ||
          entry.supersededBy ||
          !access(entry.call)
        )
          continue;
        const { module: original } = await responseContract(state, entry.call);
        if (entry.state === "accepted")
          validateModuleResponse(original, entry.call, entry.result);
        if (access(entry.call)) {
          const dependents = [];
          for (const child of commandDependents(state, p.scope, entry.id)) {
            if (!access(child.call)) continue;
            const verified = await responseContract(state, child.call);
            if (access(child.call))
              dependents.push({ entry: child, module: verified.module });
          }
          saved.push({
            entry,
            module: original,
            review: commandReview(state, entry.id),
            dependents,
          });
        }
      }
      if (mounted.current)
        setCommands(
          access() ? saved.filter(({ entry }) => access(entry.call)) : [],
        );
    } catch (error) {
      if (mounted.current && access()) setError(error);
    } finally {
      refreshing.current = false;
    }
  };
  const synchronize = async () => {
    if (synchronizing.current || !access(undefined, true)) return;
    synchronizing.current = true;
    const p = latest.current.props;
    const activity = latest.current.executing;
    activity?.(1);
    if (mounted.current) setBusy(true);
    try {
      await syncModuleStorage(
        p.platform,
        p.scope,
        (call) => sendModuleCall(p.client, p.scope, call),
        () => access(undefined, true),
        (call) => access(call, true),
      );
      if (mounted.current && access()) setError(undefined);
    } catch (error) {
      if (mounted.current && access()) setError(error);
    } finally {
      activity?.(-1);
      synchronizing.current = false;
      if (mounted.current) {
        setBusy(false);
        await refresh();
      }
    }
  };
  const queue = React.useMemo<ModuleQueue>(() => {
    const adapter = createModuleQueue(props.platform, props.scope, (call) =>
      access(call),
    );
    return {
      get: adapter.get,
      async capture(call, dependencies) {
        if (!latest.current.props.offlineEnabled)
          throw Error(
            "Enable offline storage in Settings before saving a pending command on this device.",
          );
        const receipt = await adapter.capture(call, dependencies);
        void refresh();
        // Capture returns a provisional receipt, never an inferred server success.
        void synchronize();
        return receipt;
      },
    };
  }, [props.platform, props.scope.userId, props.scope.workspaceId, module]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    void refresh();
    void synchronize();
    const refreshTimer = setInterval(() => void refresh(), 1500);
    const syncTimer = setInterval(() => void synchronize(), 15000);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(syncTimer);
    };
  }, [props.online, props.bootstrap, props.offlineEnabled, module]);
  const resolve = async (entry: JournalEntry) => {
    if (busy || !access(entry.call, true)) return;
    const p = latest.current.props;
    const activity = latest.current.executing;
    activity?.(1);
    setBusy(true);
    try {
      await settleJournalEntry(
        p.platform,
        p.scope,
        entry.id,
        (request) =>
          p.client.request({
            operation: "moduleAttemptSettle",
            params: {
              workspaceId: p.scope.workspaceId,
              moduleId: request.moduleId,
            },
            moduleVersion: request.moduleVersion,
            body: request.body,
          }),
        () => access(entry.call, true),
      );
      if (mounted.current && access()) setError(undefined);
    } catch (error) {
      if (mounted.current && access()) setError(error);
    } finally {
      activity?.(-1);
      if (mounted.current) {
        setBusy(false);
        await refresh();
      }
    }
  };
  const recovery = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (!mounted.current || busy)
      throw Error("Wait for the current request to finish.");
    const activity = latest.current.executing;
    activity?.(1);
    setBusy(true);
    try {
      return await run();
    } finally {
      activity?.(-1);
      if (mounted.current) {
        setBusy(false);
        await refresh();
      }
    }
  };
  const saveReview = (
    entry: JournalEntry,
    input: unknown,
    revision: number,
    selected: CommandContinuation[],
  ) =>
    recovery(() => {
      const p = latest.current.props;
      return saveCommandReview(
        p.platform,
        p.scope,
        entry.id,
        module.version,
        input,
        revision,
        (call) => access(call),
        selected,
      );
    });
  const replace = (
    entry: JournalEntry,
    review: CommandReview,
    key: string,
    selected: CommandContinuation[],
  ) =>
    recovery(async () => {
      const p = latest.current.props;
      const result = await replaceCommand(
        p.platform,
        p.scope,
        entry.id,
        review.revision,
        key,
        selected,
        (request) =>
          p.client.request({
            operation: "moduleAttemptSettle",
            params: {
              workspaceId: p.scope.workspaceId,
              moduleId: request.moduleId,
            },
            moduleVersion: request.moduleVersion,
            body: request.body,
          }),
        (call) => access(call, true),
      );
      void synchronize();
      return result;
    });
  return {
    module,
    saveReview,
    replace,
    queue,
    commands: commands.filter(({ entry }) => access(entry.call)),
    error: access() ? error : undefined,
    busy,
    online: access(undefined, true),
    synchronize,
    resolve,
  };
}

export function SavedCommands({
  state,
}: {
  state: ReturnType<typeof useQueuedCommands>;
}) {
  const [open, setOpen] = React.useState(false);
  const [resolving, setResolving] = React.useState<JournalEntry>();
  const [reviewId, setReviewId] = React.useState<string>();
  const reviewing = state.commands.find(({ entry }) => entry.id === reviewId);
  if (!state.commands.length && !state.error) return null;
  return (
    <>
      <ui.ErrorMessage error={state.error} />
      <ui.Button onClick={() => setOpen(true)}>
        Saved commands ({state.commands.length})
      </ui.Button>
      <ui.Modal
        open={open}
        onOpenChange={setOpen}
        title="Saved commands"
        description="Saved input stays provisional until the server accepts it. Rejected changes retain their original input."
      >
        <ui.ErrorMessage error={state.error} />
        <ui.Button
          disabled={
            !state.online ||
            state.busy ||
            !state.commands.some(({ entry }) => entry.state === "pending")
          }
          onClick={() => void state.synchronize()}
        >
          Retry pending commands
        </ui.Button>
        <ul>
          {state.commands.map(({ entry, module, review }) => (
            <li key={entry.id}>
              <h3>{module.operations[entry.call.operation!].title}</h3>
              <p>
                {entry.state === "pending"
                  ? entry.delivery === "unsubmitted"
                    ? "Pending submission"
                    : "Outcome unknown"
                  : entry.state === "accepted"
                    ? "Accepted"
                    : entry.state === "conflict"
                      ? "Conflict"
                      : "Rejected"}
              </p>
              <p>
                Saved{" "}
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </p>
              {entry.error && <p>{entry.error}</p>}
              <details>
                <summary>Delivery details</summary>
                <p>
                  Release {entry.call.moduleVersion}. Retry identity:{" "}
                  <code>{entry.id}</code>
                </p>
                {!!entry.dependencies.length && (
                  <p>Prerequisites: {entry.dependencies.join(", ")}</p>
                )}
                {entry.businessError !== undefined && (
                  <ui.ResourceValue
                    value={entry.businessError}
                    schema={module.operations[entry.call.operation!].errors}
                  />
                )}
              </details>
              <details>
                <summary>View saved input</summary>
                <ui.ResourceValue
                  value={entry.call.input}
                  schema={module.operations[entry.call.operation!].input}
                />
              </details>
              {entry.state === "accepted" && (
                <details>
                  <summary>View accepted result</summary>
                  <ui.ResourceValue
                    value={entry.result}
                    schema={module.operations[entry.call.operation!].output}
                  />
                </details>
              )}
              {(["rejected", "conflict"].includes(entry.state) || review) && (
                <ui.Button
                  disabled={state.busy}
                  onClick={() => setReviewId(entry.id)}
                >
                  {review ? "Resume command review" : "Review command"}
                </ui.Button>
              )}
              {entry.state === "pending" &&
                entry.delivery !== "unsubmitted" && (
                  <ui.Button
                    disabled={!state.online || state.busy}
                    onClick={() => setResolving(entry)}
                  >
                    Resolve outcome
                  </ui.Button>
                )}
            </li>
          ))}
        </ul>
      </ui.Modal>
      {reviewing && (
        <CommandCorrection
          key={reviewing.entry.id}
          entry={reviewing.entry}
          originalModule={reviewing.module}
          module={state.module}
          review={reviewing.review}
          dependents={reviewing.dependents}
          online={state.online}
          busy={state.busy}
          save={(input, revision, selected) =>
            state.saveReview(reviewing.entry, input, revision, selected)
          }
          replace={(review, key, selected) =>
            state.replace(reviewing.entry, review, key, selected)
          }
          close={() => setReviewId(undefined)}
        />
      )}
      <ui.Modal
        open={
          !!resolving &&
          state.commands.some(({ entry }) => entry.id === resolving.id)
        }
        onOpenChange={(open) => {
          if (!open) setResolving(undefined);
        }}
        title="Resolve command outcome"
        description="Recover the accepted result, or ask the server to stop the original request if it never committed. Saved input is preserved."
      >
        <ui.Button
          disabled={!state.online || state.busy}
          onClick={() => {
            if (resolving)
              void state.resolve(resolving).then(() => setResolving(undefined));
          }}
        >
          Recover result or stop retries
        </ui.Button>
      </ui.Modal>
    </>
  );
}
