import {
  type IpcMain,
  dialog,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { open, writeFile } from "node:fs/promises";
import type { Scope } from "@suite/client";
import type { LanRecovery } from "./recovery";
import { recoveryFileLimit, type ReceiptSelection } from "./receipts";
/** Recovery exposes IDs and native file pickers, never renderer-supplied paths or export bytes. */
export function registerLanRecovery(
  recovery: LanRecovery,
  host: {
    sender(event: IpcMainInvokeEvent): void;
    validateScope(scope: Scope): void;
    window(): BrowserWindow;
    handle: IpcMain["handle"];
  },
) {
  function handle<Args extends unknown[], Result>(
    channel: string,
    action: (scope: Scope, ...args: Args) => Promise<Result>,
  ) {
    host.handle(channel, async (event, scope: Scope, ...args: Args) => {
      host.sender(event);
      try {
        host.validateScope(scope);
        return { ok: true, result: await action(scope, ...args) };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "The received draft could not be recovered. Try again.",
        };
      }
    });
  }
  handle("suite:lan-receipts", (scope) => recovery.list(scope));
  handle("suite:lan-archive", (scope) => recovery.archiveState(scope));
  for (const action of ["archive", "restore"] as const)
    handle(
      `suite:lan-receipt-${action}`,
      (scope, selection: ReceiptSelection) =>
        recovery[action](scope, selection),
    );
  handle(
    "suite:lan-receipt-delete",
    (scope, selection: ReceiptSelection, confirmation: boolean) =>
      recovery.remove(scope, selection, confirmation),
  );
  for (const action of ["submit", "dismiss"] as const)
    handle(
      `suite:lan-receipt-${action}`,
      (scope, id: string, digest: string) => {
        if (
          typeof id !== "string" ||
          !id.length ||
          id.length > 128 ||
          typeof digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(digest)
        )
          throw Error("Invalid receipt selection.");
        return recovery[action](scope, id, digest);
      },
    );
  handle("suite:lan-receipt-export", (scope, selection: ReceiptSelection) =>
    recovery.exportFile(scope, selection, {
      choose: async (filename) => {
        const result = await dialog.showSaveDialog(host.window(), {
          defaultPath: filename,
          filters: [{ name: "Draft recovery", extensions: ["json"] }],
        });
        return result.canceled ? undefined : result.filePath;
      },
      write: (path, content) => writeFile(path, content, { mode: 0o600 }),
    }),
  );
  handle("suite:lan-receipt-import", (scope) =>
    recovery.importFile(scope, {
      choose: async () => {
        const result = await dialog.showOpenDialog(host.window(), {
          properties: ["openFile"],
          filters: [{ name: "Draft recovery", extensions: ["json"] }],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      read: async (path) => {
        const file = await open(path, "r");
        try {
          const bytes = Buffer.alloc(recoveryFileLimit + 1);
          let count = 0;
          while (count < bytes.length) {
            const read = await file.read(
              bytes,
              count,
              bytes.length - count,
              null,
            );
            if (!read.bytesRead) break;
            count += read.bytesRead;
          }
          if (count > recoveryFileLimit)
            throw Error("The recovery file exceeds 1 MiB.");
          return bytes.subarray(0, count).toString("utf8");
        } finally {
          await file.close();
        }
      },
    }),
  );
}
