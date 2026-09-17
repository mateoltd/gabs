export interface Rank {
  id: string;
  name: string;
  parents: string[];
  inherit: boolean;
  denies: string[];
  x: number;
  y: number;
}
export interface PolicyGroup {
  id: string;
  name: string;
  rankIds: string[];
  tags: string[];
  grants: string[];
  denies: string[];
}
export interface OrganizationPolicy {
  rootId: string;
  ranks: Rank[];
  groups: PolicyGroup[];
}
export function validateOrganization(policy: OrganizationPolicy) {
  const ranks = new Map(policy.ranks.map((r) => [r.id, r]));
  if (ranks.size !== policy.ranks.length)
    throw Error("Rank identifiers must be unique.");
  const root = ranks.get(policy.rootId);
  if (
    !root ||
    root.name !== "Administrador" ||
    root.parents.length ||
    root.inherit ||
    root.denies.length
  )
    throw Error(
      "The Administrador root is required and cannot inherit or deny permissions.",
    );
  const complete = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (complete.has(id)) return;
    if (path.includes(id))
      throw Error("The organization cannot contain cycles.");
    const rank = ranks.get(id);
    if (!rank) throw Error("A parent rank is missing.");
    if (id !== root.id && !rank.parents.length)
      throw Error("Every rank must connect to Administrador.");
    if (new Set(rank.parents).size !== rank.parents.length)
      throw Error("Duplicate parent connection.");
    for (const parent of rank.parents) visit(parent, [...path, id]);
    complete.add(id);
  };
  for (const rank of policy.ranks) visit(rank.id, []);
  if (new Set(policy.groups.map((g) => g.id)).size !== policy.groups.length)
    throw Error("Group identifiers must be unique.");
  for (const group of policy.groups) {
    if (group.rankIds.includes(root.id) && group.denies.length)
      throw Error("The root cannot receive group denials.");
    for (const id of group.rankIds)
      if (!ranks.has(id)) throw Error("A group contains an unknown rank.");
  }
}
export function effectivePermissions(
  assigned: string[],
  grants: Record<string, readonly string[]>,
  policy?: OrganizationPolicy,
) {
  if (policy) validateOrganization(policy);
  const sources: Record<string, { grants: string[]; denies: string[] }> = {};
  const add = (
    permission: string,
    kind: "grants" | "denies",
    source: string,
  ) => {
    const entry = (sources[permission] ??= { grants: [], denies: [] });
    if (!entry[kind].includes(source)) entry[kind].push(source);
  };
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const permission of grants[id] ?? []) add(permission, "grants", id);
    const rank = policy?.ranks.find((r) => r.id === id);
    for (const permission of rank?.denies ?? []) add(permission, "denies", id);
    for (const group of policy?.groups.filter((g) => g.rankIds.includes(id)) ??
      []) {
      for (const p of group.grants) add(p, "grants", group.name);
      for (const p of group.denies) add(p, "denies", group.name);
    }
    if (rank?.inherit) for (const parent of rank.parents) visit(parent);
  };
  for (const id of assigned) visit(id);
  if (policy && assigned.includes(policy.rootId))
    for (const permission of grants[policy.rootId] ?? []) {
      sources[permission].denies = [];
    }
  return {
    permissions: Object.keys(sources).filter(
      (p) => sources[p].grants.length && !sources[p].denies.length,
    ),
    sources,
  };
}

/** Layer every rank below all its parents, with deterministic ordering within each layer. */
export function layoutOrganization(
  policy: OrganizationPolicy,
): OrganizationPolicy {
  validateOrganization(policy);
  const ranks = new Map(policy.ranks.map((r) => [r.id, r]));
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    const rank = ranks.get(id)!;
    const value = rank.parents.length
      ? 1 + Math.max(...rank.parents.map(depth))
      : 0;
    depths.set(id, value);
    return value;
  };
  const layers = new Map<number, Rank[]>();
  for (const rank of policy.ranks) {
    const d = depth(rank.id);
    const layer = layers.get(d) ?? [];
    layer.push(rank);
    layers.set(d, layer);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [d, layer] of [...layers.entries()].sort(([a], [b]) => a - b)) {
    const center = (r: Rank) =>
      r.parents.length
        ? r.parents.reduce((sum, id) => sum + (positions.get(id)?.x ?? 0), 0) /
          r.parents.length
        : 0;
    layer.sort((a, b) => center(a) - center(b) || a.name.localeCompare(b.name));
    layer.forEach((r, i) =>
      positions.set(r.id, { x: 40 + i * 210, y: 40 + d * 140 }),
    );
  }
  return {
    ...policy,
    ranks: policy.ranks.map((r) => ({ ...r, ...positions.get(r.id)! })),
  };
}
