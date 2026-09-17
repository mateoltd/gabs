import { ipcRenderer } from "electron";
import type { DesktopBridge } from "@suite/client";

const checks = new Map<string, () => Promise<void>>();
ipcRenderer.on(
  "suite:local-device-check",
  (_event, handle: string, nonce: string) => {
    const check = checks.get(handle);
    void (async () => {
      try {
        if (!check)
          throw Error("This local device request is no longer active.");
        await check();
        if (checks.get(handle) !== check)
          throw Error("This local device request was closed.");
        await ipcRenderer.invoke(
          "suite:local-device-reply",
          handle,
          nonce,
          true,
        );
      } catch (error) {
        await ipcRenderer.invoke(
          "suite:local-device-reply",
          handle,
          nonce,
          false,
          error instanceof Error
            ? error.message
            : "Local device access was denied.",
        );
      }
    })().catch(() => {});
  },
);
export const localDeviceBridge: Pick<
  DesktopBridge,
  "openLocalDevice" | "executeLocalDevice" | "closeLocalDevice"
> = {
  async openLocalDevice(request, recheck) {
    if (typeof recheck !== "function")
      throw Error("A live local profile check is required.");
    const handle = (await ipcRenderer.invoke(
      "suite:local-device-open",
      request,
    )) as string;
    checks.set(handle, recheck);
    return handle;
  },
  async executeLocalDevice(handle) {
    const response = await ipcRenderer.invoke(
      "suite:local-device-execute",
      handle,
    );
    if (!response?.ok)
      throw Error(response?.message ?? "The local device action failed.");
    return response.result;
  },
  async closeLocalDevice(handle) {
    checks.delete(handle);
    await ipcRenderer.invoke("suite:local-device-close", handle);
  },
};
