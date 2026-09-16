import type { PoolClient } from "pg";
import { policyListenerPool, type DB } from "./database";

/** Notifications wake readers; durable revisions and fresh authorization decide the response. */
export class PolicySignals {
  private client?: PoolClient;
  private connecting?: Promise<void>;
  private closed = false;
  private waiters = new Map<string, Set<() => void>>();
  private count = 0;
  constructor(private db: DB) {}
  async connect() {
    if (this.closed) throw Error("Policy delivery is closing.");
    if (this.connecting) return this.connecting;
    if (this.client) return;
    if (!this.connecting)
      this.connecting = (async () => {
        const client = await policyListenerPool(this.db).connect();
        const lost = () => {
          if (this.client !== client) return;
          this.client = undefined;
          client.release(true);
          for (const callbacks of this.waiters.values())
            for (const wake of [...callbacks]) wake();
        };
        this.client = client;
        client.once("error", lost);
        client.once("end", lost);
        client.on("notification", (message) => {
          if (message.channel === "suite_policy" && message.payload)
            for (const wake of [...(this.waiters.get(message.payload) ?? [])])
              wake();
        });
        try {
          await client.query("LISTEN suite_policy");
          if (this.closed) lost();
        } catch (error) {
          lost();
          throw error;
        }
      })().finally(() => {
        this.connecting = undefined;
      });
    await this.connecting;
  }
  subscribe(workspaceId: string, signal: AbortSignal) {
    if (this.count >= 1000) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    let wake!: () => void;
    const promise = new Promise<void>((resolve) => {
      wake = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", wake);
        const callbacks = this.waiters.get(workspaceId);
        if (callbacks?.delete(wake)) this.count--;
        if (!callbacks?.size) this.waiters.delete(workspaceId);
        resolve();
      };
      const callbacks = this.waiters.get(workspaceId) ?? new Set();
      callbacks.add(wake);
      this.waiters.set(workspaceId, callbacks);
      this.count++;
      timer = setTimeout(wake, 15000);
      signal.addEventListener("abort", wake, { once: true });
      if (signal.aborted) wake();
    });
    return { promise, close: wake };
  }
  async close() {
    this.closed = true;
    await this.connecting?.catch(() => {});
    for (const callbacks of this.waiters.values())
      for (const wake of [...callbacks]) wake();
    const client = this.client;
    this.client = undefined;
    if (client) client.release(true);
  }
}
