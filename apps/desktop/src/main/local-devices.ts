import {
  type IpcMain,
  dialog,
  Notification,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { writeFile } from "node:fs/promises";
import { LocalDeviceSessions } from "./local-device-sessions";

export function createLocalDeviceHost(
  window: () => BrowserWindow | undefined,
  minimizedTest: boolean,
) {
  const sessions = new LocalDeviceSessions((handle, nonce) => {
    const win = window();
    if (!win || win.isDestroyed())
      throw Error("The local profile window is unavailable.");
    win.webContents.send("suite:local-device-check", handle, nonce);
  });
  return {
    clear: () => sessions.clear(),
    register(
      sender: (event: IpcMainInvokeEvent) => void,
      handle: IpcMain["handle"],
    ) {
      handle("suite:local-device-open", (event, request) => {
        sender(event);
        return sessions.open(request);
      });
      handle("suite:local-device-close", (event, handle) => {
        sender(event);
        sessions.close(handle);
      });
      handle(
        "suite:local-device-reply",
        (event, handle, nonce, allowed, message) => {
          sender(event);
          sessions.reply(handle, nonce, allowed, message);
        },
      );
      handle("suite:local-device-execute", async (event, handle) => {
        sender(event);
        try {
          const result = await sessions.execute(
            handle,
            async (request, recheck) => {
              if (request.kind === "files.export") {
                const input = request.call.input as {
                  filename: string;
                  content: string;
                };
                const win = window();
                if (!win || win.isDestroyed())
                  throw Error("The local profile window is unavailable.");
                const result = await dialog.showSaveDialog(win, {
                  defaultPath: input.filename,
                  filters: [
                    {
                      name: "Module export",
                      extensions: [input.filename.split(".").at(-1)!],
                    },
                  ],
                });
                if (result.canceled || !result.filePath)
                  return { status: "cancelled" };
                await recheck();
                await writeFile(result.filePath, input.content, {
                  mode: 0o600,
                });
                return { status: "saved" };
              }
              if (request.kind === "notifications.show") {
                if (minimizedTest || !Notification.isSupported())
                  return { requested: false };
                const input = request.call.input as {
                  title: string;
                  message: string;
                };
                await recheck();
                new Notification({
                  title: input.title,
                  body: input.message,
                }).show();
                return { requested: true };
              }
              // Corporate transport belongs to its authenticated workspace, never a local profile.
              if (request.kind === "lan.status")
                return {
                  enabled: false,
                  configured: false,
                  peers: [],
                };
              throw Error(
                "Relay corporate artifacts and pending work from an authorized online workspace.",
              );
            },
          );
          return { ok: true, result };
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "The local device action failed.",
          };
        } finally {
          sessions.close(handle);
        }
      });
    },
  };
}
