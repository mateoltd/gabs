import type { ModuleCall, ModuleDefinition } from "@suite/module-sdk";

/** Both contracts are host-verified definitions; historical permissions never replace current grants. */
export function canAccessCommand(
  call: ModuleCall,
  installed: ModuleDefinition,
  original: ModuleDefinition | undefined,
  granted: (permission: string) => boolean,
): boolean {
  if (
    call.action !== "operation" ||
    !call.operation ||
    call.resource ||
    call.kind ||
    call.moduleId !== installed.id ||
    original?.id !== installed.id ||
    original.version !== call.moduleVersion
  )
    return false;
  for (const definition of [installed, original]) {
    const operation = Object.hasOwn(definition.operations, call.operation)
      ? definition.operations[call.operation]
      : undefined;
    if (
      !operation ||
      operation.policy !== "queued" ||
      operation.kind === "query" ||
      operation.serviceOnly ||
      !granted(operation.permission)
    )
      return false;
  }
  return true;
}
