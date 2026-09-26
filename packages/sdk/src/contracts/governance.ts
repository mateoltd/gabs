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

export type OrganizationIssue = {
  code:
    | "duplicate-rank"
    | "root"
    | "missing-parent"
    | "duplicate-parent"
    | "cycle"
    | "orphan"
    | "assignment";
  message: string;
  rankIds: string[];
};

/** Diagnose the whole draft without mutating it or turning partial results into authority. */
export function organizationIssues(
  policy: OrganizationPolicy,
): OrganizationIssue[] {
  const issues: OrganizationIssue[] = [];
  const add = (
    code: OrganizationIssue["code"],
    message: string,
    rankIds: string[],
  ) => issues.push({ code, message, rankIds: [...new Set(rankIds)] });
  const ranks = new Map(policy.ranks.map((rank) => [rank.id, rank]));
  const seen = new Set<string>(),
    duplicates = new Set<string>();
  for (const rank of policy.ranks) {
    if (seen.has(rank.id)) duplicates.add(rank.id);
    seen.add(rank.id);
  }
  if (duplicates.size)
    add("duplicate-rank", "Rank identifiers must be unique.", [...duplicates]);
  const root = ranks.get(policy.rootId);
  if (
    !root ||
    root.name !== "Administrador" ||
    root.parents.length ||
    root.inherit ||
    root.denies.length
  )
    add(
      "root",
      "The Administrador root is required and cannot inherit or deny permissions.",
      [policy.rootId],
    );
  const children = new Map<string, string[]>();
  for (const rank of ranks.values()) {
    if (rank.parents.some((id) => !ranks.has(id)))
      add("missing-parent", "A parent rank is missing.", [rank.id]);
    if (new Set(rank.parents).size !== rank.parents.length)
      add("duplicate-parent", "Duplicate parent connection.", [rank.id]);
    for (const parent of rank.parents) {
      const list = children.get(parent) ?? [];
      list.push(rank.id);
      children.set(parent, list);
    }
  }
  // Strongly connected components identify every cycle member, including overlapping cycles.
  let nextIndex = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>();
  const stack: string[] = [],
    active = new Set<string>();
  const visit = (id: string) => {
    index.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    active.add(id);
    for (const parent of ranks.get(id)!.parents) {
      if (!ranks.has(parent)) continue;
      if (!index.has(parent)) {
        visit(parent);
        low.set(id, Math.min(low.get(id)!, low.get(parent)!));
      } else if (active.has(parent))
        low.set(id, Math.min(low.get(id)!, index.get(parent)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      active.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || ranks.get(id)!.parents.includes(id))
      add("cycle", "The organization cannot contain cycles.", component);
  };
  for (const id of ranks.keys()) if (!index.has(id)) visit(id);
  const connected = new Set<string>();
  const queue = root ? [root.id] : [];
  for (let offset = 0; offset < queue.length; offset++) {
    const id = queue[offset];
    if (connected.has(id)) continue;
    connected.add(id);
    for (const child of children.get(id) ?? [])
      if (!connected.has(child)) queue.push(child);
  }
  const disconnected = [...ranks.keys()].filter((id) => !connected.has(id));
  if (disconnected.length)
    add("orphan", "Every rank must connect to Administrador.", disconnected);
  for (const [kind, assignments] of [
    ["Group", policy.groups],
    ["Tag", policy.tags ?? []],
  ] as const) {
    if (new Set(assignments.map((item) => item.id)).size !== assignments.length)
      add(
        "assignment",
        `${kind} identifiers must be unique.`,
        assignments.flatMap((item) => item.rankIds),
      );
    const names = new Set<string>();
    for (const item of assignments) {
      if (kind === "Tag") {
        const name = item.name.normalize("NFKC").trim().toLowerCase();
        if (!name || names.has(name))
          add(
            "assignment",
            "Tag names must be nonempty and unique.",
            item.rankIds,
          );
        names.add(name);
      }
      if (item.rankIds.includes(policy.rootId) && item.denies.length)
        add(
          "assignment",
          `The root cannot receive ${kind.toLowerCase()} denials.`,
          [policy.rootId],
        );
      if (new Set(item.rankIds).size !== item.rankIds.length)
        add(
          "assignment",
          `A ${kind.toLowerCase()} contains duplicate ranks.`,
          item.rankIds,
        );
      if (item.rankIds.some((id) => !ranks.has(id)))
        add(
          "assignment",
          `A ${kind.toLowerCase()} contains an unknown rank.`,
          item.rankIds,
        );
    }
  }
  return issues;
}
export function validateOrganization(policy: OrganizationPolicy) {
  const issue = organizationIssues(policy)[0];
  if (issue) throw Error(issue.message);
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
