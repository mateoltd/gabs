import type { ModuleCall, ModuleDefinition } from "@suite/module-sdk";

/** Both contracts are host-verified definitions; historical permissions never replace current grants. */
export function canInspectCommand(
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
  const captured = Object.hasOwn(original.operations, call.operation)
    ? original.operations[call.operation]
    : undefined;
  const active = Object.hasOwn(installed.operations, call.operation)
    ? installed.operations[call.operation]
    : undefined;
  return !!(
    captured &&
    captured.policy === "queued" &&
    captured.kind !== "query" &&
    !captured.serviceOnly &&
    granted(captured.permission) &&
    (!active || granted(active.permission))
  );
}

/** Inspection of a retired contract never authorizes dispatch under that contract. */
export function canAccessCommand(
  call: ModuleCall,
  installed: ModuleDefinition,
  original: ModuleDefinition | undefined,
  granted: (permission: string) => boolean,
): boolean {
  if (!canInspectCommand(call, installed, original, granted)) return false;
  const active = Object.hasOwn(installed.operations, call.operation!)
    ? installed.operations[call.operation!]
    : undefined;
  return !!(
    active &&
    active.policy === "queued" &&
    active.kind !== "query" &&
    !active.serviceOnly
  );
}
