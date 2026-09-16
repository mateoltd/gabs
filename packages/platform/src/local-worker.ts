import type { ModuleDefinition } from "@suite/module-sdk";
import {
  LocalExecutionError,
  type LocalRequest,
  type LocalResult,
} from "@suite/module-sdk/local";
export type LocalWorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "addEventListener"
>;
export type LocalWorkerFactory = () => LocalWorkerPort;
/** One worker per transaction allows cancellation of synchronous CPU work. */
export class LocalWorkerHost {
  private active = new Map<LocalWorkerPort, () => void>();
  private closed = false;
  constructor(
    private readonly factory: LocalWorkerFactory = () =>
      new Worker(new URL("./local-worker-entry.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  run(
    module: ModuleDefinition,
    request: LocalRequest,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<LocalResult> {
    if (this.closed)
      return Promise.reject(
        new LocalExecutionError("PROFILE_LOCKED", "Unlock the local profile."),
      );
    if (options.signal?.aborted)
      return Promise.reject(
        new LocalExecutionError(
          "LOCAL_CANCELLED",
          "The local operation was cancelled.",
        ),
      );
    return new Promise((resolve, reject) => {
      const worker = this.factory();
      let done = false;
      const finish = (error: unknown, value?: LocalResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", cancel);
        this.active.delete(worker);
        worker.terminate();
        if (error) reject(error);
        else resolve(value!);
      };
      const cancel = () =>
        finish(
          new LocalExecutionError(
            "LOCAL_CANCELLED",
            "The local operation was cancelled.",
          ),
        );
      const timer = setTimeout(
        () =>
          finish(
            new LocalExecutionError(
              "LOCAL_TIMEOUT",
              "The local operation exceeded its time limit.",
            ),
          ),
        options.timeoutMs ?? 30000,
      );
      this.active.set(worker, () =>
        finish(
          new LocalExecutionError(
            "PROFILE_LOCKED",
            "The profile was locked before this operation completed.",
          ),
        ),
      );
      options.signal?.addEventListener("abort", cancel, { once: true });
      worker.addEventListener("error", () =>
        finish(
          new LocalExecutionError(
            "LOCAL_WORKER_FAILED",
            "The local worker stopped. Retry with the same request identifier.",
          ),
        ),
      );
      worker.addEventListener("messageerror", () =>
        finish(
          new LocalExecutionError(
            "LOCAL_WORKER_FAILED",
            "The local worker returned unreadable data.",
          ),
        ),
      );
      worker.addEventListener("message", (event) => {
        const response = event.data;
        if (response?.ok === true && response.value?.snapshot)
          finish(undefined, response.value);
        else if (
          response?.ok === false &&
          typeof response.error?.code === "string" &&
          typeof response.error?.message === "string"
        )
          finish(
            new LocalExecutionError(
              response.error.code,
              response.error.message,
              response.error.detail,
            ),
          );
        else
          finish(
            new LocalExecutionError(
              "LOCAL_WORKER_FAILED",
              "The local worker returned an invalid response.",
            ),
          );
      });
      try {
        worker.postMessage({ module, request });
      } catch (error) {
        finish(error);
      }
    });
  }
  close() {
    this.closed = true;
    for (const cancel of this.active.values()) cancel();
  }
}
