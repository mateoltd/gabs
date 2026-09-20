import { createNativeVaultProvider } from "@suite/client/native-vault";
import { moduleCatalog } from "../catalog/index";
import type { LocalProfileRuntime } from "@suite/client/local-profiles";
import {
  LocalWorkerHost,
  type LocalWorkerFactory,
} from "@suite/client/local-worker";

export const localWorkerFactory: LocalWorkerFactory = () =>
  new Worker(new URL("./worker-entry.ts", import.meta.url), { type: "module" });

export const localProfileRuntime: LocalProfileRuntime = Object.freeze({
  catalog: moduleCatalog,
  workerFactory: localWorkerFactory,
  vaults:
    typeof window !== "undefined" && window.suiteDesktop
      ? createNativeVaultProvider(window.suiteDesktop.localVaults)
      : undefined,
});

export const createLocalWorkerHost = () =>
  new LocalWorkerHost(localWorkerFactory);
