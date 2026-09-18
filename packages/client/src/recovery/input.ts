import { validateSavedWork, checkSavedWorkPermissions } from "./work";
import { assertSchema, Type, type ModuleDefinition } from "@suite/module-sdk";
import {
  ModuleInputRecoverySchema,
  SavedWorkRecoverySchema,
  type SavedWorkRecovery,
  type ModuleInputRecovery,
} from "@suite/module-sdk/platform";
import type { Bootstrap } from "@suite/contracts";
import type { Scope } from "../index";

export function validateRecoveryInput(
  value: unknown,
  scope: Scope,
  moduleId: string,
): ModuleInputRecovery | SavedWorkRecovery {
  assertSchema(
    Type.Union([ModuleInputRecoverySchema, SavedWorkRecoverySchema]),
    value,
  );
  if (value.kind === "module-work-recovery")
    return validateSavedWork(value, scope, moduleId);
  if (
    value.userId !== scope.userId ||
    value.workspaceId !== scope.workspaceId ||
    value.moduleId !== moduleId ||
    (value.status === "unconfirmed" &&
      (value.pendingRequest.moduleId !== value.moduleId ||
        value.pendingRequest.resource !== value.resource ||
        value.pendingRequest.moduleVersion !== value.moduleVersion))
  )
    throw Error(
      "The recovery input belongs to another account, workspace or module.",
    );
  return value;
}

/** Recovery exports preserve input; they never authorize writes or revive a retired resource. */
export function checkRecoveryPolicy(
  policy: Bootstrap,
  input: ModuleInputRecovery | SavedWorkRecovery,
  dependencies: readonly string[],
  offline = false,
  now = Date.now(),
  contracts?: {
    current: ModuleDefinition;
    originals: readonly ModuleDefinition[];
  },
) {
  if (
    policy.workspace.id !== input.workspaceId ||
    (input.kind === "module-input-recovery" &&
      !policy.permissions.includes(
        `${input.moduleId}.${input.resource}.read`,
      )) ||
    [input.moduleId, ...dependencies].some(
      (id) =>
        !policy.modules.some(
          (item) =>
            item.moduleId === id &&
            item.state === "enabled" &&
            item.assigned &&
            item.entitled,
        ),
    )
  )
    throw Error("Current access does not allow exporting this input.");
  if (input.kind === "module-work-recovery") {
    if (!contracts)
      throw Error("Reconnect to verify the saved-work contracts.");
    checkSavedWorkPermissions(
      input,
      contracts.current,
      contracts.originals,
      (permission) => policy.permissions.includes(permission),
    );
  }
  if (
    offline &&
    (policy.offlineHours <= 0 ||
      !Number.isFinite(Date.parse(policy.authorizedAt)) ||
      Date.parse(policy.authorizedAt) > now ||
      Date.parse(policy.authorizedAt) +
        Math.min(policy.offlineHours, 24) * 3600000 <=
        now)
  )
    throw Error("Offline recovery access expired. Reconnect to continue.");
}
