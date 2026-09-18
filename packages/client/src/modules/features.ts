import type { Bootstrap } from "@suite/contracts";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import type { SuiteClient } from "@suite/client/api";
import type { Platform, Scope, Snapshot } from "../index";
export interface FeatureProps {
  client: SuiteClient;
  scope: Scope;
  bootstrap: Bootstrap;
  online: boolean;
  platform: Platform;
  snapshot?: Snapshot;
  offlineEnabled: boolean;
  moduleCatalog: ModuleCatalog;
  receivePolicy(policy: Bootstrap, signal: AbortSignal): Promise<Bootstrap>;
  onError: (error: unknown) => void;
}
export function canUse(
  bootstrap: Bootstrap,
  moduleId: string,
  permission: string,
  catalog: ModuleCatalog,
) {
  const required = catalog.dependencies(moduleId);
  return (
    bootstrap.permissions.includes(permission) &&
    required.every((id) =>
      bootstrap.modules.some(
        (m) =>
          m.moduleId === id &&
          m.state === "enabled" &&
          m.entitled &&
          m.assigned,
      ),
    )
  );
}
