import { assertSchema } from "@suite/module-sdk";
import {
  ModuleInputRecoverySchema,
  type ModuleInputRecovery,
} from "@suite/module-sdk/platform";
import type { Bootstrap } from "@suite/contracts";
import type { Scope } from "../index";

export function validateRecoveryInput(
  value: unknown,
  scope: Scope,
  moduleId: string,
): ModuleInputRecovery {
  assertSchema(ModuleInputRecoverySchema, value);
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
  input: ModuleInputRecovery,
  dependencies: readonly string[],
  offline = false,
  now = Date.now(),
) {
  if (
    policy.workspace.id !== input.workspaceId ||
    !policy.permissions.includes(`${input.moduleId}.${input.resource}.read`) ||
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
