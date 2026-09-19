import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ResourceClient,
  ResourceListOptions,
  ResourcePage,
  ResourceRead,
} from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";

export type ResourceListQuery<T> = Omit<ResourceListOptions<T>, "cursor">;
export type ResourceListState<T> =
  | { status: "success"; page: ResourceRead<ResourcePage<T>>; error: undefined }
  | { status: "error"; page: undefined; error: unknown }
  | { status: "idle"; page: undefined; error: undefined }
  | { status: "loading"; page: undefined; error: undefined };

/** The host supplies a new resource client whenever authorization or workspace changes. */
export function useResourceList<T>(
  resource: Pick<ResourceClient<T>, "list">,
  query: ResourceListQuery<NoInfer<T>> = {},
  { enabled = true }: { enabled?: boolean } = {},
): ResourceListState<T> & {
  pageNumber: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextPage(): void;
  previousPage(): void;
  firstPage(): void;
  reload(): void;
} {
  // Match JSON transport semantics and ignore object-key insertion order.
  const key = canonical(JSON.parse(JSON.stringify(query)));
  const context = useMemo(
    () => ({ resource, query: structuredClone(query), enabled }),
    [resource, key, enabled],
  );
  const [position, setPosition] = useState<{
    context: typeof context;
    index: number;
    cursors: (string | undefined)[];
  }>({ context, index: 0, cursors: [undefined] });
  const current =
    position.context === context
      ? position
      : { context, index: 0, cursors: [undefined] };
  const cursor = current.cursors[current.index];
  const [revision, setRevision] = useState(0);
  const ticket = useMemo(
    () => ({ context, cursor, revision }),
    [context, cursor, revision],
  );
  const [result, setResult] = useState<{
    ticket: typeof ticket;
    state: ResourceListState<T>;
  }>();
  useEffect(() => {
    if (!context.enabled) return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return context.resource.list(
          { ...context.query, ...(cursor ? { cursor } : {}) },
          { signal: controller.signal },
        );
      })
      .then((page) => {
        if (!controller.signal.aborted)
          setResult({
            ticket,
            state: { status: "success", page, error: undefined },
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            ticket,
            state: { status: "error", page: undefined, error },
          });
      });
    return () => controller.abort();
  }, [ticket]);
  // Mask old records during render, before effects can observe a new scope or query.
  const state: ResourceListState<T> = !enabled
    ? { status: "idle", page: undefined, error: undefined }
    : result?.ticket === ticket
      ? result.state
      : { status: "loading", page: undefined, error: undefined };
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return {
    ...state,
    pageNumber: current.index + 1,
    hasNextPage:
      enabled && state.status === "success" && !!state.page.nextCursor,
    hasPreviousPage: enabled && current.index > 0,
    nextPage() {
      if (!enabled || state.status !== "success" || !state.page.nextCursor)
        return;
      setPosition({
        context,
        index: current.index + 1,
        cursors: [
          ...current.cursors.slice(0, current.index + 1),
          state.page.nextCursor,
        ],
      });
    },
    previousPage() {
      if (enabled && current.index > 0)
        setPosition({ ...current, index: current.index - 1 });
    },
    firstPage() {
      setPosition({ context, index: 0, cursors: [undefined] });
      reload();
    },
    reload,
  };
}
