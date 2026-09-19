import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@suite/client";
import { localDeviceBridge } from "./local-devices";
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.os = process.platform;
});
async function recover<Result>(
  channel: string,
  ...args: unknown[]
): Promise<Result> {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (!response?.ok)
    throw Error(
      response?.message ??
        "The received draft could not be recovered. Try again.",
    );
  return response.result;
}
const bridge: DesktopBridge = {
  profileLockStatus: () => ipcRenderer.invoke("suite:profile-lock-status"),
  onProfileLock: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: import("@suite/client").ProfileLockStatus,
    ) => callback(status);
    ipcRenderer.on("suite:profile-lock-changed", listener);
    return () => {
      ipcRenderer.removeListener("suite:profile-lock-changed", listener);
    };
  },
  lockProfile: () => recover("suite:profile-lock"),
  unlockProfile: (method, pin) => recover("suite:profile-unlock", method, pin),
  configureProfileLock: (pin, biometric, previousPin) =>
    recover("suite:profile-lock-configure", pin, biometric, previousPin),
  removeProfileLock: (pin, recovery) =>
    recover("suite:profile-lock-remove", pin, recovery),
  onlineProfiles: () => ipcRenderer.invoke("suite:online-profiles"),
  rememberOnlineProfile: (explicit) =>
    ipcRenderer.invoke("suite:online-profile-remember", explicit),
  forgetOnlineProfile: (id) =>
    ipcRenderer.invoke("suite:online-profile-forget", id),
  lanArchive: (scope) => recover("suite:lan-archive", scope),
  archiveLanReceipt: (scope, selection) =>
    recover("suite:lan-receipt-archive", scope, selection),
  restoreLanReceipt: (scope, selection) =>
    recover("suite:lan-receipt-restore", scope, selection),
  deleteLanReceipt: (scope, selection, confirmation) =>
    recover("suite:lan-receipt-delete", scope, selection, confirmation),
  exportLanReceipt: (scope, selection) =>
    recover("suite:lan-receipt-export", scope, selection),
  importLanReceipt: (scope) => recover("suite:lan-receipt-import", scope),
  receivedPackage: (scope, selection) =>
    ipcRenderer.invoke("suite:lan-package", scope, selection),
  acknowledgePackage: (scope, transferId) =>
    ipcRenderer.invoke("suite:lan-package-ack", scope, transferId),
  lanReceipts: (scope) => recover("suite:lan-receipts", scope),
  submitLanReceipt: (scope, id, digest) =>
    recover("suite:lan-receipt-submit", scope, id, digest),
  dismissLanReceipt: (scope, id, digest) =>
    recover("suite:lan-receipt-dismiss", scope, id, digest),
  downloadExport: async (handle, id) => {
    const response = await ipcRenderer.invoke(
      "suite:export-download",
      handle,
      id,
    );
    if (!response?.ok)
      throw Error(response?.message ?? "The export could not be saved.");
    return response.result;
  },
  prepareModuleOffline: (scope, moduleId, version, enabled) =>
    ipcRenderer.invoke(
      "suite:module-offline",
      scope,
      moduleId,
      version,
      enabled,
    ),
  ...localDeviceBridge,
  exportInput: (handle, input) =>
    ipcRenderer.invoke("suite:input-export", handle, input),
  openModuleHost: (scope, moduleId, version) =>
    ipcRenderer.invoke("suite:module-host-open", scope, moduleId, version),
  closeModuleHost: (handle) =>
    ipcRenderer.invoke("suite:module-host-close", handle),
  moduleCapability: async (handle, capability, input) => {
    const response = await ipcRenderer.invoke(
      "suite:module-capability",
      handle,
      capability,
      input,
    );
    if (!response?.ok)
      throw Error(response?.message ?? "The host action failed.");
    return response.result;
  },
  openBilling: (url) => ipcRenderer.invoke("suite:billing-open", url),
  onLanChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("suite:lan-changed", listener);
    return () => {
      ipcRenderer.removeListener("suite:lan-changed", listener);
    };
  },
  lanStatus: (scope) => ipcRenderer.invoke("suite:lan-status", scope),
  setLan: (scope, enabled, grant) =>
    ipcRenderer.invoke("suite:lan-set", scope, enabled, grant),
  authStatus: () => ipcRenderer.invoke("suite:auth-status"),
  execute: (request) => ipcRenderer.invoke("suite:execute", request),
  login: (options) => ipcRenderer.invoke("suite:login", options),
  logout: () => ipcRenderer.invoke("suite:logout"),
  accountRevision: (userId) =>
    ipcRenderer.invoke("suite:account-revision", userId),
  cacheRead: (scope, key) => ipcRenderer.invoke("suite:cache-read", scope, key),
  cacheWrite: (scope, key, value) =>
    ipcRenderer.invoke("suite:cache-write", scope, key, value),
  cachePruneArtifacts: (scope, keep) =>
    ipcRenderer.invoke("suite:cache-prune-artifacts", scope, keep),
  cachePurge: (scope) => ipcRenderer.invoke("suite:cache-purge", scope),
  identity: () => ipcRenderer.invoke("suite:identity"),
  rememberIdentity: (value) => ipcRenderer.invoke("suite:remember", value),
  saveFile: (filename, content) =>
    ipcRenderer.invoke("suite:save-file", filename, content),
  notify: (title, message) =>
    ipcRenderer.invoke("suite:notify", title, message),
  securityStatus: () => ipcRenderer.invoke("suite:security-status"),
};
contextBridge.exposeInMainWorld("suiteDesktop", bridge);
