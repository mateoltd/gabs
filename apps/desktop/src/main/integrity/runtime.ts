import type { IpcMain } from "electron";
import type { IntegrityFailure } from "./format";

/** Runtime admission is monotonic: only a new, verified process can recover. */
export class IntegrityMonitor {
  private readonly abort = new AbortController();
  private flight?: Promise<void>;
  private interval?: ReturnType<typeof setInterval>;
  private readonly calls = new Set<Promise<unknown>>();
  constructor(
    private readonly host: {
      inspect(): Promise<IntegrityFailure | undefined>;
      lock(): void;
      record(failure: IntegrityFailure): Promise<void>;
      stop(auditFailed: boolean): Promise<void>;
    },
  ) {}
  get signal() {
    return this.abort.signal;
  }
  get locked() {
    return this.abort.signal.aborted;
  }
  assertAvailable() {
    if (this.locked)
      throw Error(
        "Application integrity failed. Repair the installation and restart.",
      );
  }
  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.assertAvailable();
    const call = Promise.resolve().then(() => {
      this.assertAvailable();
      return operation();
    });
    this.calls.add(call);
    try {
      const result = await call;
      this.assertAvailable();
      return result;
    } catch (error) {
      this.assertAvailable();
      throw error;
    } finally {
      this.calls.delete(call);
    }
  }
  /** Already-issued work may settle; its result cannot cross the locked boundary. */
  async drain() {
    await Promise.allSettled([...this.calls]);
  }
  start() {
    if (this.interval || this.locked) return;
    this.interval = setInterval(() => {
      void this.check();
    }, 60000);
    this.interval.unref();
  }
  dispose() {
    clearInterval(this.interval);
    this.interval = undefined;
  }
  check(): Promise<void> {
    if (this.flight) return this.flight;
    if (this.locked) return Promise.resolve();
    const flight = this.inspect();
    this.flight = flight;
    void flight
      .finally(() => {
        if (this.flight === flight) this.flight = undefined;
      })
      .catch(() => {});
    return flight;
  }
  private async inspect() {
    let failure: IntegrityFailure | undefined;
    try {
      failure = await this.host.inspect();
    } catch {
      failure = { code: "unreadable-assets" };
    }
    if (!failure) return;
    this.dispose();
    this.abort.abort();
    // Stop privileged admission before yielding to audit or filesystem work.
    let auditFailed = false;
    try {
      this.host.lock();
    } catch {
      auditFailed = true;
    }
    try {
      await this.host.record(failure);
    } catch {
      auditFailed = true;
    }
    await this.host.stop(auditFailed);
  }
}

/** Every native feature registers through the same before/after access gate. */
export function guardedHandle(
  ipc: Pick<IpcMain, "handle">,
  monitor: IntegrityMonitor,
): IpcMain["handle"] {
  return (channel, listener) =>
    ipc.handle(channel, (event, ...args) =>
      monitor.run(() => listener(event, ...args)),
    );
}
