import { Type, type Static } from "@sinclair/typebox";

const policyId = Type.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
const strings = Type.Array(Type.String({ maxLength: 200 }), {
  maxItems: 500,
  uniqueItems: true,
});
export const RankSchema = Type.Object(
  {
    id: policyId,
    name: Type.String({ minLength: 1, maxLength: 100 }),
    parents: Type.Array(policyId, { maxItems: 100, uniqueItems: true }),
    inherit: Type.Boolean(),
    denies: strings,
    x: Type.Number(),
    y: Type.Number(),
  },
  { additionalProperties: false },
);
const assignment = {
  id: policyId,
  name: Type.String({ minLength: 1, maxLength: 100 }),
  rankIds: Type.Array(policyId, { maxItems: 500, uniqueItems: true }),
  grants: strings,
  denies: strings,
  modules: Type.Optional(
    Type.Array(Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }), {
      maxItems: 100,
      uniqueItems: true,
    }),
  ),
};
export const PolicyGroupSchema = Type.Object(
  {
    ...assignment,
    /** Existing group labels remain metadata; they do not create role policies. */
    tags: strings,
  },
  { additionalProperties: false },
);
export const PolicyTagSchema = Type.Object(assignment, {
  additionalProperties: false,
});
export const OrganizationPolicySchema = Type.Object(
  {
    rootId: policyId,
    ranks: Type.Array(RankSchema, { maxItems: 500 }),
    groups: Type.Array(PolicyGroupSchema, { maxItems: 100 }),
    /** Optional for saved policies and supported clients predating role tags. */
    tags: Type.Optional(Type.Array(PolicyTagSchema, { maxItems: 100 })),
  },
  { additionalProperties: false },
);
export type Rank = Static<typeof RankSchema>;
export type PolicyGroup = Static<typeof PolicyGroupSchema>;
export type PolicyTag = Static<typeof PolicyTagSchema>;
export type OrganizationPolicy = Static<typeof OrganizationPolicySchema>;

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
  for (const [kind, assignments] of [
    ["Group", policy.groups],
    ["Tag", policy.tags ?? []],
  ] as const) {
    if (new Set(assignments.map((item) => item.id)).size !== assignments.length)
      throw Error(`${kind} identifiers must be unique.`);
    const names = new Set<string>();
    for (const item of assignments) {
      if (kind === "Tag") {
        const name = item.name.normalize("NFKC").trim().toLowerCase();
        if (!name || names.has(name))
          throw Error("Tag names must be nonempty and unique.");
        names.add(name);
      }
      if (item.rankIds.includes(root.id) && item.denies.length)
        throw Error(`The root cannot receive ${kind.toLowerCase()} denials.`);
      if (new Set(item.rankIds).size !== item.rankIds.length)
        throw Error(`A ${kind.toLowerCase()} contains duplicate ranks.`);
      for (const id of item.rankIds)
        if (!ranks.has(id))
          throw Error(`A ${kind.toLowerCase()} contains an unknown rank.`);
    }
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
