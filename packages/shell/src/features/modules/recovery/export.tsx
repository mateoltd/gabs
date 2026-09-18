import { useLayoutEffect, useRef, useState } from "react";
import { canUse, type FeatureProps } from "@suite/client";
import { exportRecoveryInput } from "@suite/client/browser";
import { readModuleStorage } from "@suite/client/module-storage";
import {
  createSavedWorkRecovery,
  savedWorkContracts,
  checkSavedWorkPermissions,
  type WorkSelection,
} from "@suite/client/work-recovery";
import type { ModuleDefinition } from "@suite/module-sdk";
import { Button, ErrorMessage } from "@suite/ui-web";
import { canReadSavedWork } from "./access";

/** Export the selected snapshot only while its owning recovery surface is active. */
export function SavedWorkExport(
  props: FeatureProps & {
    module: ModuleDefinition;
    selection: WorkSelection;
    active: boolean;
  },
) {
  const latest = useRef(props);
  latest.current = props;
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    return () => controller.current?.abort();
  }, [
    props.active,
    props.scope.userId,
    props.scope.workspaceId,
    props.module.id,
    props.module.version,
  ]);
  const save = async () => {
    if (busy) return;
    const captured = props;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    const check = () => {
      abort.signal.throwIfAborted();
      const p = latest.current;
      if (
        !mounted.current ||
        !p.active ||
        p.scope.userId !== captured.scope.userId ||
        p.scope.workspaceId !== captured.scope.workspaceId ||
        p.module.id !== captured.module.id ||
        p.module.version !== captured.module.version ||
        !canReadSavedWork(p)
      )
        throw Error("This saved-work recovery surface is no longer active.");
    };
    setBusy(true);
    setError(undefined);
    try {
      check();
      const state = await readModuleStorage(captured.platform, captured.scope);
      check();
      const input = await createSavedWorkRecovery(
        state,
        captured.scope,
        captured.module.id,
        captured.selection,
      );
      const originals = await savedWorkContracts(state, input);
      const authorize = () => {
        check();
        const p = latest.current;
        checkSavedWorkPermissions(input, p.module, originals, (permission) =>
          canUse(p.bootstrap, p.module.id, permission, p.moduleCatalog),
        );
      };
      authorize();
      await exportRecoveryInput({
        client: captured.client,
        input,
        signal: abort.signal,
        check: authorize,
        receivePolicy: (policy, signal) =>
          latest.current.receivePolicy(policy, signal),
        onError: (error) => latest.current.onError(error),
        access: () => {
          const p = latest.current;
          return {
            policy: p.bootstrap,
            dependencies: p.moduleCatalog.dependencies(p.module.id),
            module: p.module,
            online: p.online,
            offlineEnabled: p.offlineEnabled,
          };
        },
      });
    } catch (error) {
      if (mounted.current && !abort.signal.aborted) setError(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <div className="actions">
      <Button
        disabled={busy || !props.active || !canReadSavedWork(props)}
        onClick={() => void save()}
      >
        {"requestId" in props.selection
          ? "Export saved request"
          : "Export saved draft"}
      </Button>
      <ErrorMessage error={error} />
    </div>
  );
}
