import type { ModulePermission } from "@suite/module-sdk/platform";

export function PermissionOrigin({
  entries,
  id,
}: {
  entries?: ModulePermission[];
  id?: string;
}) {
  if (!entries?.length || entries.some((entry) => entry.current)) return null;
  return (
    <span id={id} className="small muted" style={{ display: "block" }}>
      Other releases:{" "}
      {entries
        .map(
          (entry) =>
            `${entries.length > 1 ? entry.moduleId + ": " : ""}${entry.versions.join(", ")}`,
        )
        .join("; ")}
      . May authorize recovery and supported older clients.
    </span>
  );
}
