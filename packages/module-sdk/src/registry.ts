import { compare, satisfies } from "semver";
export interface ReleaseManifest {
  id: string;
  version: string;
  publisher: string;
  host: string;
  backend: string;
  dependencies: Record<string, string>;
  permissions: readonly string[];
}
export { compare as compareVersions, satisfies } from "semver";
export function resolveReleases(
  id: string,
  releases: readonly ReleaseManifest[],
  host: string,
  backend: string,
  pins: Record<string, string> = {},
) {
  type Request = { id: string; range: string; path: string[] };
  function solve(
    pending: Request[],
    selected: Map<string, ReleaseManifest>,
  ): Map<string, ReleaseManifest> | undefined {
    if (!pending.length) return selected;
    const [request, ...rest] = pending;
    if (request.path.includes(request.id)) return;
    const existing = selected.get(request.id);
    if (existing)
      return satisfies(existing.version, request.range)
        ? solve(rest, selected)
        : undefined;
    const candidates = releases
      .filter(
        (r) =>
          r.id === request.id &&
          r.publisher === "suite" &&
          satisfies(r.version, request.range) &&
          (!pins[r.id] || r.version === pins[r.id]) &&
          satisfies(host, r.host) &&
          satisfies(backend, r.backend),
      )
      .sort((a, b) => compare(b.version, a.version));
    for (const candidate of candidates) {
      const next = new Map(selected).set(candidate.id, candidate);
      const result = solve(
        [
          ...Object.entries(candidate.dependencies).map(([id, range]) => ({
            id,
            range,
            path: [...request.path, request.id],
          })),
          ...rest,
        ],
        next,
      );
      if (result) return result;
    }
  }
  const selected = solve([{ id, range: "*", path: [] }], new Map());
  if (!selected)
    throw Error(
      `No compatible official release set for ${id}. Check version pins, dependencies, and cycles.`,
    );
  const result: ReleaseManifest[] = [];
  const added = new Set<string>();
  const emit = (name: string) => {
    if (added.has(name)) return;
    const m = selected.get(name)!;
    for (const d of Object.keys(m.dependencies)) emit(d);
    added.add(name);
    result.push(m);
  };
  emit(id);
  return result;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
