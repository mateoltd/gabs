import { bundledModuleDefinitions } from "../catalog/index";
import { localModules } from "../catalog/local";
import { installLocalWorker } from "@suite/client/local-worker-runtime";

installLocalWorker(self, {
  bundledModules: bundledModuleDefinitions,
  implementations: localModules,
});
