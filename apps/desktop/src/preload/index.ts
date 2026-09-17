import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@suite/client";
import { localDeviceBridge } from "./local-devices";
window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.os = process.platform;
});
const bridge: DesktopBridge = {
  ...localDeviceBridge,
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
  lanStatus: () => ipcRenderer.invoke("suite:lan-status"),
  setLan: (scope, enabled) =>
    ipcRenderer.invoke("suite:lan-set", scope, enabled),
  relay: (scope, peerId, envelope) =>
    ipcRenderer.invoke("suite:lan-relay", scope, peerId, envelope),
  authStatus: () => ipcRenderer.invoke("suite:auth-status"),
  execute: (request) => ipcRenderer.invoke("suite:execute", request),
  login: (options) => ipcRenderer.invoke("suite:login", options),
  logout: () => ipcRenderer.invoke("suite:logout"),
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
