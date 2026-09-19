import { useEffect, useRef } from "react";
import { ApiError, type SuiteClient } from "@suite/client/api";
import type { Bootstrap } from "@suite/contracts";
import type { PolicyRequest } from "./policy";

/** Long polling uses the same bounded, credential-protected transport on both clients. */
export function usePolicyDelivery(
  client: SuiteClient,
  workspaceId: string,
  userId: string,
  online: boolean,
  begin: (signal: AbortSignal) => Promise<PolicyRequest>,
  receive: (
    bootstrap: Bootstrap,
    changed: boolean,
    request: PolicyRequest,
    signal: AbortSignal,
  ) => Promise<void>,
  failure: (error: unknown) => void,
) {
  const latest = useRef({ begin, receive, failure });
  latest.current = { begin, receive, failure };
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    let revision: string | undefined;
    let delay = 1000;
    const pause = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        controller.signal.addEventListener("abort", done, { once: true });
        if (controller.signal.aborted) done();
      });
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const request = await latest.current.begin(controller.signal);
          controller.signal.throwIfAborted();
          const result = await client.request(
            {
              operation: "workspacePolicy",
              params: { workspaceId },
              query: revision ? { since: revision } : {},
            },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) break;
          await latest.current.receive(
            result.bootstrap,
            revision !== result.revision,
            request,
            controller.signal,
          );
          revision = result.revision;
          delay = 1000;
        } catch (error) {
          if (controller.signal.aborted) break;
          if (error instanceof ApiError && [401, 403].includes(error.status)) {
            latest.current.failure(error);
            delay = 30000;
          }
          await pause();
          delay = Math.min(delay * 2, 30000);
        }
      }
    })();
    return () => controller.abort();
  }, [client, workspaceId, userId, online]);
}
