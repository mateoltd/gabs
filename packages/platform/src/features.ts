import { moduleDependencies } from "@suite/module-catalog";
import type { Bootstrap } from "@suite/contracts";
import type { SuiteClient } from "@suite/api-client";
import type { Platform, Scope, Snapshot } from "./index";
export interface FeatureProps {
  client: SuiteClient;
  scope: Scope;
  bootstrap: Bootstrap;
  online: boolean;
  platform: Platform;
  snapshot?: Snapshot;
  offlineEnabled: boolean;
  onError: (error: unknown) => void;
}
export function canUse(
  bootstrap: Bootstrap,
  moduleId: string,
  permission: string,
) {
  const required = moduleDependencies(moduleId);
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
