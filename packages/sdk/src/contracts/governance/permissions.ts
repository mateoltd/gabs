import type { OrganizationPolicy } from "./schema";
import { validateOrganization } from "./graph";

export function effectivePermissions(
  assigned: string[],
  grants: Record<string, readonly string[]>,
  policy?: OrganizationPolicy,
) {
  if (policy) validateOrganization(policy);
  const sources: Record<string, { grants: string[]; denies: string[] }> =
    Object.create(null);
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
    for (const tag of policy?.tags?.filter((tag) => tag.rankIds.includes(id)) ??
      []) {
      for (const permission of tag.grants)
        add(permission, "grants", `Tag: ${tag.name}`);
      for (const permission of tag.denies)
        add(permission, "denies", `Tag: ${tag.name}`);
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

/** Module policy follows the same opt-in role inheritance as permissions. */
export function effectiveModulePolicies(
  assigned: readonly string[],
  policy?: OrganizationPolicy,
) {
  const sources: Record<string, string[]> = Object.create(null);
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const rank = policy?.ranks.find((item) => item.id === id);
    for (const [kind, entries] of [
      ["Group", policy?.groups ?? []],
      ["Tag", policy?.tags ?? []],
    ] as const) {
      for (const entry of entries) {
        if (!entry.rankIds.includes(id)) continue;
        for (const moduleId of entry.modules ?? []) {
          const names = (sources[moduleId] ??= []);
          const name = `${kind}: ${entry.name}`;
          if (!names.includes(name)) names.push(name);
        }
      }
    }
    if (rank?.inherit) for (const parent of rank.parents) visit(parent);
  };
  for (const id of assigned) visit(id);
  return sources;
}
