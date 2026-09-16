import type { ModuleDefinition } from "@suite/module-sdk";
import { requireCondition } from "./errors";

/** Version is a contract selector, never permission to bypass current policy. */
export function assertClientModuleVersion(
  module: ModuleDefinition,
  requested: string | string[] | undefined,
) {
  // Existing unversioned callers use the workspace contract. Rollout policy must
  // explicitly govern legacy callers before permitting multiple client releases.
  if (requested === undefined) return;
  requireCondition(
    typeof requested === "string" &&
      /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(requested),
    400,
    "INVALID_MODULE_VERSION",
    "Provide one valid module release version.",
  );
  requireCondition(
    requested === module.version,
    409,
    "MODULE_UPDATE_REQUIRED",
    `${module.name} ${requested} is not the workspace's accepted release (${module.version}). Update this module before retrying. Pending work is preserved.`,
  );
}
