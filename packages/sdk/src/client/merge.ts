import type { JsonRecord } from "../authoring/module";

/** Merge only fields unchanged on the server since the submitted base version. */
export function mergeFields(
  base: JsonRecord,
  local: JsonRecord,
  remote: JsonRecord,
): { data: JsonRecord; conflicts: string[] } {
  const data = { ...remote };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (JSON.stringify(base[key]) === JSON.stringify(local[key])) continue;
    if (
      JSON.stringify(remote[key]) !== JSON.stringify(base[key]) &&
      JSON.stringify(remote[key]) !== JSON.stringify(local[key])
    )
      conflicts.push(key);
    else if (key in local) data[key] = local[key];
    else delete data[key];
  }
  return { data, conflicts };
}
