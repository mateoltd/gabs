import { moduleDefinitions } from "@suite/module-catalog";
import { localModules } from "@suite/module-catalog/local";
import { executeLocalCall, type LocalRequest } from "@suite/module-sdk/local";
import { canonical } from "@suite/module-sdk/registry";
import type { ModuleDefinition } from "@suite/module-sdk";
// Reviewed application code runs in a dedicated worker, not a hostile-code sandbox.
self.addEventListener(
  "message",
  async (
    event: MessageEvent<{ module: ModuleDefinition; request: LocalRequest }>,
  ) => {
    try {
      const module = moduleDefinitions.find(
        (m) => m.id === event.data.module.id,
      );
      if (!module || canonical(module) !== canonical(event.data.module))
        throw Error(
          "The installed local module contract does not match this request.",
        );
      const value = await executeLocalCall(
        module,
        event.data.request,
        localModules.find((m) => m.module.id === module.id),
      );
      self.postMessage({ ok: true, value });
    } catch (error) {
      const failure = error as {
        code?: string;
        message?: string;
        detail?: unknown;
      };
      self.postMessage({
        ok: false,
        error: {
          code: failure.code ?? "LOCAL_OPERATION_FAILED",
          message: failure.message ?? "Local operation failed.",
          detail: failure.detail,
        },
      });
    }
  },
);
