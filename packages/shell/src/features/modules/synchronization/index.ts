import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FeatureProps } from "@suite/client";
import { synchronizeWorkspace } from "./host";

/** Corporate work progresses while any workspace route is open. Never mounts module code. */
export function useWorkspaceSynchronization(props: FeatureProps | undefined) {
  const latest = useRef(props);
  latest.current = props;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!props?.online || !props.offlineEnabled) return;
    const controller = new AbortController();
    let busy = false;
    const active = () =>
      !controller.signal.aborted &&
      latest.current?.scope.userId === props.scope.userId &&
      latest.current.scope.workspaceId === props.scope.workspaceId;
    const run = async () => {
      if (busy || !active()) return;
      busy = true;
      try {
        const result = await synchronizeWorkspace(
          () => latest.current,
          controller.signal,
        );
        if (!active()) return;
        if (result.sent)
          await queryClient.invalidateQueries({
            queryKey: [props.scope.userId, props.scope.workspaceId],
          });
        if (result.errors.length) latest.current?.onError(result.errors[0]);
      } catch (error) {
        if (active()) latest.current?.onError(error);
      } finally {
        busy = false;
      }
    };
    void run();
    const timer = setInterval(() => void run(), 15_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    props?.scope.userId,
    props?.scope.workspaceId,
    props?.online,
    props?.offlineEnabled,
    props?.bootstrap.policyRevision,
    queryClient,
  ]);
}
