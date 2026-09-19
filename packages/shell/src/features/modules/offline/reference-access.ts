import { canUse, type FeatureProps } from "@suite/client";
import { ApiError } from "@suite/client/api";
import type { ModuleDefinition } from "@suite/module-sdk";
import type { ReferenceTarget } from "@suite/module-sdk/references";
import { canReadSavedWork } from "../recovery/access";

export function assertReferenceAccess(
  props: FeatureProps,
  module: ModuleDefinition,
  resource: string,
  target: ReferenceTarget,
) {
  if (
    !canUse(
      props.bootstrap,
      module.id,
      `${module.id}.${resource}.read`,
      props.moduleCatalog,
    )
  )
    throw new ApiError(
      403,
      "FORBIDDEN",
      "You no longer have access to this resource.",
    );
  if (target.kind === "resource") {
    if (
      target.moduleId !== module.id &&
      !Object.hasOwn(module.dependencies, target.moduleId)
    )
      throw new ApiError(
        403,
        "FORBIDDEN",
        "The module does not declare this reference dependency.",
      );
    if (
      !canUse(
        props.bootstrap,
        target.moduleId,
        `${target.moduleId}.${target.resource}.read`,
        props.moduleCatalog,
      )
    )
      throw new ApiError(
        403,
        "FORBIDDEN",
        "You no longer have access to the referenced resource.",
      );
  }
  if (
    (!props.online || !navigator.onLine) &&
    (props.bootstrap.offlineHours <= 0 || !canReadSavedWork(props))
  )
    throw Error("Connect to renew access to downloaded choices.");
}
