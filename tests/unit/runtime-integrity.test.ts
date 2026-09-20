import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import {
  IntegrityMonitor,
  guardedHandle,
} from "../../apps/desktop/src/main/integrity/runtime";
import type { IntegrityFailure } from "../../apps/desktop/src/main/integrity/assets";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const fault: IntegrityFailure = { code: "changed-asset", asset: "preload.cjs" };
afterEach(() => {
  vi.useRealTimers();
});
describe("runtime integrity admission", () => {
  it("blocks immediately, cancels transport and refuses late success before audit completes", async () => {
    const result = deferred<string>(),
      audit = deferred<void>();
    const stop = vi.fn(async () => {}),
      lock = vi.fn();
    const monitor = new IntegrityMonitor({
      inspect: async () => fault,
      lock,
      record: () => audit.promise,
      stop,
    });
    const pending = monitor.run(() => result.promise);
    const rejected = expect(pending).rejects.toThrow(
      "Application integrity failed",
    );
    const checking = monitor.check();
    await Promise.resolve();
    expect(monitor.signal.aborted).toBe(true);
    expect(lock).toHaveBeenCalledOnce();
    await expect(monitor.run(() => "new result")).rejects.toThrow(
      "Application integrity failed",
    );
    result.resolve("already committed result");
    await rejected;
    await monitor.drain();
    expect(stop).not.toHaveBeenCalled();
    audit.resolve();
    await checking;
    expect(stop).toHaveBeenCalledWith(false);
  });
  it("deduplicates simultaneous checks and cannot recover inside the locked process", async () => {
    const inspection = deferred<IntegrityFailure | undefined>();
    const inspect = vi.fn(() => inspection.promise),
      record = vi.fn(async () => {}),
      stop = vi.fn(async () => {});
    const monitor = new IntegrityMonitor({
      inspect,
      lock: () => {},
      record,
      stop,
    });
    const first = monitor.check(),
      second = monitor.check();
    expect(first).toBe(second);
    inspection.resolve(fault);
    await first;
    await monitor.check();
    expect(inspect).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(monitor.locked).toBe(true);
  });
  it("still stops admission when inspection, cleanup or audit reporting fails", async () => {
    const stop = vi.fn(async () => {});
    const monitor = new IntegrityMonitor({
      inspect: async () => {
        throw Error("disk unavailable");
      },
      lock: () => {
        throw Error("cleanup unavailable");
      },
      record: async (failure) => {
        expect(failure.code).toBe("unreadable-assets");
        throw Error("audit unavailable");
      },
      stop,
    });
    await monitor.check();
    expect(stop).toHaveBeenCalledWith(true);
    expect(monitor.locked).toBe(true);
  });
  it("periodically checks without overlap and stops its timer after a fault", async () => {
    vi.useFakeTimers();
    const inspection = deferred<IntegrityFailure | undefined>(),
      inspect = vi.fn(() => inspection.promise);
    const monitor = new IntegrityMonitor({
      inspect,
      lock: () => {},
      record: async () => {},
      stop: async () => {},
    });
    monitor.start();
    monitor.start();
    await vi.advanceTimersByTimeAsync(120000);
    expect(inspect).toHaveBeenCalledOnce();
    inspection.resolve(fault);
    await monitor.check();
    await vi.advanceTimersByTimeAsync(120000);
    expect(inspect).toHaveBeenCalledOnce();
    monitor.dispose();
  });
  it("registers real handlers behind the same gate and preserves ordinary values and errors", async () => {
    let listener!: Parameters<IpcMain["handle"]>[1];
    let failure: IntegrityFailure | undefined;
    const monitor = new IntegrityMonitor({
      inspect: async () => failure,
      lock: () => {},
      record: async () => {},
      stop: async () => {},
    });
    const handle = guardedHandle(
      {
        handle: (_channel, callback) => {
          listener = callback;
        },
      },
      monitor,
    );
    const effect = vi.fn((_: IpcMainInvokeEvent, value: number) => {
      if (!value) throw Error("ordinary validation");
      return value * 2;
    });
    handle("suite:fixture", effect);
    expect(await listener({} as IpcMainInvokeEvent, 3)).toBe(6);
    await expect(listener({} as IpcMainInvokeEvent, 0)).rejects.toThrow(
      "ordinary validation",
    );
    failure = fault;
    await monitor.check();
    await expect(listener({} as IpcMainInvokeEvent, 4)).rejects.toThrow(
      "Application integrity failed",
    );
    expect(effect).toHaveBeenCalledTimes(2);
  });
});
