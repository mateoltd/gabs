import type { ModuleDefinition } from "../index";
export interface LocalBundle {
  format: "suite-local-v1";
  javascript: string;
}
export function hasLocalOperations(module: ModuleDefinition) {
  return Object.values(module.operations).some((op) => op.policy === "local");
}
export function requiresLocalCode(module: ModuleDefinition) {
  return (
    hasLocalOperations(module) ||
    Object.keys(module.localStorage?.migrations ?? {}).length > 0
  );
}
export function requiresServer(module: ModuleDefinition) {
  return (
    Object.values(module.operations).some((op) => op.policy !== "local") ||
    Object.keys(module.storage?.migrations ?? {}).length > 0
  );
}
export function validateLocalArtifact(
  artifact: Record<string, unknown>,
): LocalBundle | undefined {
  const needed = requiresLocalCode(artifact as unknown as ModuleDefinition);
  const value = artifact.local as LocalBundle | undefined;
  if (!needed) {
    if (value !== undefined)
      throw Error(
        "A local bundle requires declared local operations or migrations.",
      );
    return;
  }
  if (
    !value ||
    value.format !== "suite-local-v1" ||
    typeof value.javascript !== "string" ||
    !value.javascript.trim()
  )
    throw Error(
      "Local operations require a signed suite-local-v1 executable bundle.",
    );
  if (new TextEncoder().encode(value.javascript).byteLength > 2 * 1024 * 1024)
    throw Error("Local executable exceeds the supported bundle size.");
  return value;
}
