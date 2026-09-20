import { expect, type Page } from "@playwright/test";
import type { ReplyGate } from "./server-reply";

interface WriteReply {
  committed: boolean;
  release(): void;
  dispose(): void;
}

/** Delay delivery of the real IndexedDB completion event, never the write itself. */
export async function holdBrowserWriteReply(
  page: Page,
  key: string,
  digest: string,
): Promise<ReplyGate> {
  await page.evaluate(
    ({ key, digest }) => {
      const root = globalThis as typeof globalThis & {
        writeReply?: WriteReply;
      };
      const put = IDBObjectStore.prototype.put;
      const add = IDBTransaction.prototype.addEventListener;
      const remove = IDBTransaction.prototype.removeEventListener;
      const selected = new WeakSet<IDBTransaction>();
      const listeners = new WeakMap<
        IDBTransaction,
        Map<EventListenerOrEventListenerObject, EventListener>
      >();
      const pending: (() => void)[] = [];
      let released = false;
      const gate: WriteReply = {
        committed: false,
        release() {
          released = true;
          for (const notify of pending.splice(0)) notify();
        },
        dispose() {
          gate.release();
          IDBObjectStore.prototype.put = put;
          IDBTransaction.prototype.addEventListener = add;
          IDBTransaction.prototype.removeEventListener = remove;
        },
      };
      root.writeReply = gate;
      IDBObjectStore.prototype.put = function (value, recordKey) {
        const request = put.call(this, value, recordKey);
        if (
          !gate.committed &&
          this.transaction.db.name === "suite-offline-v1" &&
          this.name === "records" &&
          recordKey === key &&
          value?.recoveryImports?.[digest]?.promotion
        )
          selected.add(this.transaction);
        return request;
      };
      IDBTransaction.prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (!listener) return;
        if (
          type !== "complete" ||
          this.db.name !== "suite-offline-v1" ||
          this.mode !== "readwrite" ||
          !this.objectStoreNames.contains("records")
        )
          return add.call(this, type, listener, options);
        const tx = this;
        const wrapped: EventListener = (event) => {
          const notify = () => {
            if (typeof listener === "function") listener.call(tx, event);
            else listener.handleEvent(event);
          };
          if (selected.has(tx) && !released) {
            gate.committed = true;
            pending.push(notify);
          } else notify();
        };
        const mapping = listeners.get(tx) ?? new Map();
        mapping.set(listener, wrapped);
        listeners.set(tx, mapping);
        return add.call(tx, type, wrapped, options);
      };
      IDBTransaction.prototype.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        if (!listener) return;
        return remove.call(
          this,
          type,
          (type === "complete" &&
            listener &&
            listeners.get(this)?.get(listener)) ||
            listener,
          options,
        );
      };
    },
    { key, digest },
  );
  return {
    arrived: async () => {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (globalThis as typeof globalThis & { writeReply?: WriteReply })
                .writeReply?.committed,
          ),
        )
        .toBe(true);
    },
    release: () =>
      page.evaluate(() =>
        (
          globalThis as typeof globalThis & { writeReply?: WriteReply }
        ).writeReply!.release(),
      ),
    dispose: async () => {
      if (!page.isClosed())
        await page.evaluate(() =>
          (
            globalThis as typeof globalThis & { writeReply?: WriteReply }
          ).writeReply?.dispose(),
        );
    },
  };
}
