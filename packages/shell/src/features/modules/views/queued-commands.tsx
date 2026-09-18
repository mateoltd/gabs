import { synchronizeWorkspace } from "../synchronization/run";
import { SavedWorkExport } from "../recovery/export";
import { canReadSavedWork } from "../recovery/access";
import {
  canContinue,
  continuationKey,
  prepareContinuation,
  type ContinuationAccess,
} from "../recovery/continuation";
import {
  canAccessCommand,
  canInspectCommand,
} from "@suite/client/module-dispatch";
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
import { canUse, type FeatureProps } from "@suite/client";
import { createModuleQueue } from "@suite/client/module-queue";
import {
  readModuleStorage,
  type ModuleStorage,
} from "@suite/client/module-storage";
import {
  responseContract,
  validateModuleResponse,
} from "@suite/client/module-response";
import { settleJournalEntry } from "@suite/client/module-settlement";
import type {
  ModuleCall,
  ModuleDefinition,
  ModuleQueue,
} from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";

// A missing operation must not invalidate another operation's verified definition.
const commandContractKey = (call: ModuleCall) =>
  JSON.stringify([call.moduleId, call.moduleVersion, call.operation]);

type SavedCommand = {
  entry: JournalEntry;
  module: ModuleDefinition;
  review?: CommandReview;
  reviewModule?: ModuleDefinition;
  dependents: { entry: JournalEntry; module: ModuleDefinition }[];
};

/** Recovery can inspect and settle saved work, but cannot capture or dispatch commands. */
export function useQueuedCommands(
  props: FeatureProps,
  module: ModuleDefinition,
  owner: { kind: "view"; permission: string } | { kind: "recovery" },
  executing?: (change: 1 | -1) => void,
) {
  const latest = React.useRef({ props, executing, module });
  latest.current = { props, executing, module };
  const contracts = React.useRef(new Map<string, ModuleDefinition>());
  const continuations = React.useRef(new Map<string, ContinuationAccess>());
  const rememberContract = async (state: ModuleStorage, call: ModuleCall) => {
    const key = commandContractKey(call);
    try {
      const verified = await responseContract(state, call);
      contracts.current.set(key, verified.module);
      return verified.module;
    } catch (error) {
      contracts.current.delete(key);
      throw error;
    }
  };
  const mounted = React.useRef(false);
  const [commands, setCommands] = React.useState<SavedCommand[]>([]);
  const [error, setError] = React.useState<unknown>();
  const [busy, setBusy] = React.useState(false);
  const refreshing = React.useRef(false);
  const synchronizing = React.useRef(false);
  const access = (call?: ModuleCall, connected = false, executable = false) => {
    const p = latest.current.props;
    if (
      !mounted.current ||
      latest.current.module.id !== module.id ||
      latest.current.module.version !== module.version ||
      !p.offlineEnabled ||
      p.scope.userId !== props.scope.userId ||
      p.scope.workspaceId !== props.scope.workspaceId ||
      (owner.kind === "view" &&
        !canUse(p.bootstrap, module.id, owner.permission, p.moduleCatalog)) ||
      (owner.kind === "recovery" && executable)
    )
      return false;
    if (
      call &&
      !(executable ? canAccessCommand : canInspectCommand)(
        call,
        module,
        call.moduleVersion === module.version
          ? module
          : contracts.current.get(commandContractKey(call)),
        (permission) =>
          canUse(p.bootstrap, module.id, permission, p.moduleCatalog),
      )
    )
      return false;
    return canReadSavedWork(p, connected);
  };
  const continuationAccess = (
    call: ModuleCall,
    connected = false,
    state?: ModuleStorage,
  ) =>
    access(undefined, connected, true) &&
    canContinue(
      latest.current.props,
      call,
      continuations.current.get(continuationKey(call)),
      state,
    );
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
      const failures: unknown[] = [];
      for (const entry of state.journal) {
        if (
          entry.userId !== p.scope.userId ||
          entry.workspaceId !== p.scope.workspaceId ||
          entry.supersededBy ||
          entry.call.moduleId !== module.id ||
          entry.call.action !== "operation"
        )
          continue;
        try {
          const original = await rememberContract(state, entry.call);
          if (!access(entry.call)) continue;
          if (entry.state === "accepted")
            validateModuleResponse(original, entry.call, entry.result);
          const review = commandReview(state, entry.id);
          let reviewModule: ModuleDefinition | undefined;
          if (review) {
            const reviewed = {
              ...review.source,
              moduleVersion: review.moduleVersion,
            };
            reviewModule = await rememberContract(state, reviewed);
            if (!access(reviewed)) continue;
          }
          const dependents = [];
          for (const child of commandDependents(state, p.scope, entry.id)) {
            const key = continuationKey(child.call);
            try {
              const prepared = await prepareContinuation(p, state, child.call);
              if (!prepared) {
                continuations.current.delete(key);
                continue;
              }
              continuations.current.set(key, prepared);
              if (continuationAccess(child.call, false, state))
                dependents.push({ entry: child, module: prepared.original });
            } catch (error) {
              continuations.current.delete(key);
              failures.push(error);
            }
          }
          if (access(entry.call))
            saved.push({
              entry,
              module: original,
              review,
              reviewModule,
              dependents,
            });
        } catch (error) {
          failures.push(error);
        }
      }
      if (mounted.current && access() && failures.length) setError(failures[0]);
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
    if (
      owner.kind === "recovery" ||
      synchronizing.current ||
      !access(undefined, true)
    )
      return;
    synchronizing.current = true;
    const activity = latest.current.executing;
    activity?.(1);
    if (mounted.current) setBusy(true);
    try {
      const result = await synchronizeWorkspace(() =>
        access(undefined, true) ? latest.current.props : undefined,
      );
      if (mounted.current && access()) setError(result.errors[0]);
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
      access(call, false, true),
    );
    return {
      async get(identity) {
        if (!access())
          throw Error(
            "Current access does not allow reading this saved change.",
          );
        const call: ModuleCall = {
          ...identity,
          action: "operation",
          input: {},
        };
        await rememberContract(
          await readModuleStorage(props.platform, props.scope),
          call,
        );
        return adapter.get(identity);
      },
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
    const refreshTimer = setInterval(() => void refresh(), 1500);
    return () => {
      clearInterval(refreshTimer);
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
        "saved-command",
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
    previous?: CommandReview,
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
        (call, state, dependentId) =>
          (dependentId
            ? continuationAccess(call, false, state)
            : access(call, false, true)) &&
          (!previous ||
            access({
              ...previous.source,
              moduleVersion: previous.moduleVersion,
            })),
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
        (call, state, dependentId) =>
          dependentId
            ? continuationAccess(call, true, state)
            : access(call, true, true),
      );
      void synchronize();
      return result;
    });
  return {
    module,
    recoveryOnly: owner.kind === "recovery",
    saveReview,
    replace,
    queue,
    commands: commands
      .filter(
        ({ entry, review }) =>
          access(entry.call) &&
          (!review ||
            access({ ...review.source, moduleVersion: review.moduleVersion })),
      )
      .map((command) => ({
        ...command,
        executable: access(command.entry.call, false, true),
        dependents: command.dependents.filter(({ entry }) =>
          continuationAccess(entry.call),
        ),
      })),
    recoveryProps:
      owner.kind === "recovery"
        ? { ...latest.current.props, module }
        : undefined,
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
            !state.commands.some(
              ({ entry, executable }) =>
                executable && entry.state === "pending",
            )
          }
          onClick={() => void state.synchronize()}
        >
          Retry pending commands
        </ui.Button>
        <ul>
          {state.commands.map(
            ({ entry, module, review, reviewModule, executable }) => (
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
                {!executable && (
                  <p>
                    {state.recoveryOnly
                      ? "This recovery screen preserves saved input and reviews. Resolving an outcome never submits a new command."
                      : "This command is no longer available for queued execution in the installed release. Its original input and saved review remain available for recovery."}
                  </p>
                )}
                {entry.settlement === "cancelled" ? (
                  <p>
                    The server stopped retries of this original request. Its
                    saved input is preserved.
                  </p>
                ) : (
                  entry.error && <p>{entry.error}</p>
                )}
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
                {!executable && review && reviewModule && (
                  <details>
                    <summary>View saved review</summary>
                    <p>
                      Review release {review.moduleVersion}. This input has not
                      been submitted.
                    </p>
                    <ui.ResourceValue
                      value={review.input}
                      schema={
                        reviewModule.operations[entry.call.operation!].input
                      }
                    />
                  </details>
                )}
                {executable &&
                  (["rejected", "conflict"].includes(entry.state) ||
                    review) && (
                    <ui.Button
                      disabled={state.busy}
                      onClick={() => setReviewId(entry.id)}
                    >
                      {review ? "Resume command review" : "Review command"}
                    </ui.Button>
                  )}
                {state.recoveryProps && (
                  <SavedWorkExport
                    {...state.recoveryProps}
                    active={open}
                    selection={{ requestId: entry.id }}
                  />
                )}
                {entry.state !== "accepted" &&
                  entry.settlement !== "cancelled" &&
                  (!executable ||
                    (entry.state === "pending" &&
                      entry.delivery !== "unsubmitted")) && (
                    <ui.Button
                      disabled={!state.online || state.busy}
                      onClick={() => setResolving(entry)}
                    >
                      Resolve outcome
                    </ui.Button>
                  )}
              </li>
            ),
          )}
        </ul>
      </ui.Modal>
      {reviewing?.executable && (
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
            state.saveReview(
              reviewing.entry,
              input,
              revision,
              selected,
              reviewing.review,
            )
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
