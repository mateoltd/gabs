import { assertSchema } from "@suite/module-sdk";
import {
  deviceRequestBytes,
  localDeviceLimits,
  LocalExecutionError,
  type LocalDeviceIntent,
} from "@suite/module-sdk/local";
import { hostCapabilitySchemas } from "@suite/module-sdk/host-capabilities";
import type { LocalCapabilityGuard } from "./local-capabilities";
import type { LocalDeviceGrant } from "@suite/module-sdk/local";

export interface LocalDeviceRequest extends LocalDeviceIntent {
  createdAt: number;
  state: "pending" | "running" | "completed" | "rejected" | "uncertain";
  attemptId?: string;
  result?: unknown;
  error?: string;
  retryOf?: string;
}
/** Host-owned adapter. Call assertCurrent immediately before every external effect. */
export type LocalDeviceExecutor = (
  guard: LocalCapabilityGuard,
  signal: AbortSignal,
) => Promise<unknown>;

export function appendDeviceRequests(
  saved: Record<string, LocalDeviceRequest>,
  intents: readonly (LocalDeviceIntent & { retryOf?: string })[],
) {
  if (!intents.length) return saved;
  if (
    intents.length > localDeviceLimits.transactionCount ||
    deviceRequestBytes(intents) > localDeviceLimits.transactionBytes
  )
    throw new LocalExecutionError(
      "LOCAL_DEVICE_LIMIT",
      "The worker exceeded the local device request limit.",
    );
  const next = { ...saved };
  for (const intent of intents) {
    if (!/^[0-9a-f-]{36}$/.test(intent.id) || Object.hasOwn(next, intent.id))
      throw new LocalExecutionError(
        "LOCAL_DEVICE_INVALID",
        "The worker returned a duplicate or invalid device request identifier.",
      );
    next[intent.id] = {
      ...structuredClone(intent),
      createdAt: Date.now(),
      state: "pending",
    };
  }
  if (
    Object.keys(next).length > localDeviceLimits.journalCount ||
    deviceRequestBytes(next) > localDeviceLimits.journalBytes
  )
    throw new LocalExecutionError(
      "LOCAL_DEVICE_LIMIT",
      "Review and clear saved device requests before creating more.",
    );
  return next;
}

/** Claim durably, release the write queue for interaction, then record the known outcome. */
export function createLocalDeviceProcessor(host: {
  data(): Record<string, LocalDeviceRequest>;
  enqueue<T>(run: () => Promise<T>): Promise<T>;
  assertCurrent(): Promise<void>;
  prepare(call: LocalDeviceIntent["call"]): Promise<LocalCapabilityGuard>;
  authorize(call: LocalDeviceIntent["call"]): Promise<LocalDeviceGrant>;
  save(requests: Record<string, LocalDeviceRequest>): Promise<void>;
}) {
  const active = new Map<string, AbortController>();
  let closed = false;
  return {
    async process(
      id: string,
      execute: LocalDeviceExecutor,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) {
      const { signal, timeoutMs = 120000 } = options;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000)
        throw Error(
          "Choose a device timeout between 1 and 600000 milliseconds.",
        );
      if (closed)
        throw new LocalExecutionError(
          "PROFILE_LOCKED",
          "Unlock the local profile.",
        );
      if (signal?.aborted)
        throw new LocalExecutionError(
          "LOCAL_CANCELLED",
          "The device request was cancelled.",
        );
      if (active.has(id))
        throw new LocalExecutionError(
          "LOCAL_DEVICE_BUSY",
          "This device request is already being processed.",
        );
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      active.set(id, controller);
      let claimed: LocalDeviceRequest | undefined;
      let invoked = false;
      const current = () => {
        if (closed)
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
        if (controller.signal.aborted)
          throw new LocalExecutionError(
            timedOut ? "LOCAL_TIMEOUT" : "LOCAL_CANCELLED",
            timedOut
              ? "The device request exceeded its time limit. Check its outcome before retrying."
              : "The device request was cancelled.",
          );
      };
      const finish = (change: Partial<LocalDeviceRequest>) =>
        host.enqueue(async () => {
          await host.assertCurrent();
          const saved = host.data()[id];
          if (
            !saved ||
            saved.attemptId !== claimed!.attemptId ||
            saved.state !== "running"
          )
            throw new LocalExecutionError(
              "LOCAL_DEVICE_CHANGED",
              "The device request changed while it was being processed.",
            );
          await host.save({ ...host.data(), [id]: { ...saved, ...change } });
        });
      try {
        claimed = await host.enqueue(async () => {
          await host.assertCurrent();
          current();
          const request = host.data()[id];
          if (request?.state === "completed") return structuredClone(request);
          if (!request || request.state !== "pending")
            throw new LocalExecutionError(
              "LOCAL_DEVICE_NOT_PENDING",
              "Only a pending device request may run. Check an uncertain outcome before creating another request.",
            );
          const value: LocalDeviceRequest = {
            ...structuredClone(request),
            state: "running",
            attemptId: crypto.randomUUID(),
          };
          await host.save({ ...host.data(), [id]: value });
          return value;
        });
        if (claimed.state === "completed")
          return structuredClone(claimed.result);
        // Never prepare a guard from inside enqueue: preparation waits for the write queue.
        const guard = await host.prepare(claimed.call);
        if (guard.authorization.id !== claimed.grantId)
          throw new LocalExecutionError(
            "CAPABILITY_DENIED",
            "This device request lost its original consent. Create a new request after reviewing access.",
          );
        const scoped: LocalCapabilityGuard = Object.freeze({
          call: guard.call,
          authorization: guard.authorization,
          async assertCurrent() {
            current();
            await guard.assertCurrent();
            current();
            const saved = host.data()[id];
            if (
              saved?.state !== "running" ||
              saved.attemptId !== claimed!.attemptId
            )
              throw new LocalExecutionError(
                "LOCAL_DEVICE_CHANGED",
                "The device request is no longer active.",
              );
          },
        });
        await scoped.assertCurrent();
        invoked = true;
        const result = await new Promise<unknown>((resolve, reject) => {
          const aborted = () => {
            try {
              current();
            } catch (error) {
              reject(error);
            }
          };
          controller.signal.addEventListener("abort", aborted, { once: true });
          void Promise.resolve()
            .then(() => {
              current();
              return execute(scoped, controller.signal);
            })
            .then(resolve, reject)
            .finally(() =>
              controller.signal.removeEventListener("abort", aborted),
            );
        });
        try {
          assertSchema(
            hostCapabilitySchemas[guard.authorization.kind].output,
            result,
          );
        } catch {
          throw new LocalExecutionError(
            "CAPABILITY_RESPONSE_INVALID",
            "The device returned an unverified result. Check its outcome before retrying.",
          );
        }
        await finish({
          state: "completed",
          result: structuredClone(result),
          error: undefined,
        });
        return result;
      } catch (error) {
        if (claimed)
          await finish({
            state: invoked ? "uncertain" : "rejected",
            error:
              error instanceof Error
                ? error.message
                : "The device request could not finish.",
          }).catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
        active.delete(id);
        signal?.removeEventListener("abort", cancel);
      }
    },
    retry(id: string, options: { confirmUncertain?: boolean } = {}) {
      return host.enqueue(async () => {
        await host.assertCurrent();
        if (closed)
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
        const request = host.data()[id];
        if (!request || !["rejected", "uncertain"].includes(request.state))
          throw new LocalExecutionError(
            "LOCAL_DEVICE_NOT_RETRYABLE",
            "Only a rejected or uncertain device request can be retried.",
          );
        if (request.state === "uncertain" && options.confirmUncertain !== true)
          throw new LocalExecutionError(
            "LOCAL_DEVICE_REVIEW_REQUIRED",
            "Check whether the device action already happened before explicitly requesting it again.",
          );
        const previous = Object.values(host.data()).find(
          (item) => item.retryOf === id,
        );
        if (previous) return previous.id;
        const grant = await host.authorize(request.call);
        const nextId = crypto.randomUUID();
        const next = appendDeviceRequests(host.data(), [
          { id: nextId, grantId: grant.id, call: request.call, retryOf: id },
        ]);
        await host.save(next);
        return nextId;
      });
    },
    dismiss(id: string) {
      return host.enqueue(async () => {
        await host.assertCurrent();
        if (active.has(id))
          throw new LocalExecutionError(
            "LOCAL_DEVICE_BUSY",
            "Cancel or finish the active device request before clearing it.",
          );
        const requests = { ...host.data() };
        delete requests[id];
        await host.save(requests);
      });
    },
    close() {
      closed = true;
      for (const controller of active.values()) controller.abort();
    },
  };
}
