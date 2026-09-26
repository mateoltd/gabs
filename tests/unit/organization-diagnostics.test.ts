import { describe, expect, it } from "vitest";
import {
  effectivePermissions,
  layoutOrganization,
  organizationIssues,
  validateOrganization,
  type OrganizationPolicy,
  type Rank,
} from "@suite/module-sdk/governance";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const root = id(1);
const rank = (n: number, parents: string[] = [root]): Rank => ({
  id: id(n),
  name: n === 1 ? "Administrador" : `Role ${n}`,
  parents: n === 1 ? [] : parents,
  inherit: false,
  denies: [],
  x: n * 10,
  y: n * 10,
});
const policy = (ranks: Rank[]): OrganizationPolicy => ({
  rootId: root,
  ranks,
  groups: [],
  tags: [],
});

describe("organization draft diagnostics", () => {
  it("reports every member of a reachable overlapping cycle without calling it orphaned", () => {
    const draft = policy([
      rank(1),
      rank(2, [root, id(3)]),
      rank(3, [id(2), id(4)]),
      rank(4, [id(2)]),
    ]);
    const before = structuredClone(draft);
    const issues = organizationIssues(draft);
    expect(issues.filter((issue) => issue.code === "cycle")).toHaveLength(1);
    expect(issues.find((issue) => issue.code === "cycle")?.rankIds).toEqual(
      expect.arrayContaining([id(2), id(3), id(4)]),
    );
    expect(issues.some((issue) => issue.code === "orphan")).toBe(false);
    expect(draft).toEqual(before);
    expect(() => validateOrganization(draft)).toThrow(
      "The organization cannot contain cycles.",
    );
    expect(() => layoutOrganization(draft)).toThrow();
    expect(() => effectivePermissions([id(2)], {}, draft)).toThrow();
  });

  it("reports all disconnected descendants and local broken edges together", () => {
    const draft = policy([
      rank(1),
      rank(2),
      rank(3, [id(99)]),
      rank(4, [id(3)]),
      rank(5, [id(6)]),
      rank(6, [id(5)]),
    ]);
    const issues = organizationIssues(draft);
    expect(
      issues.find((issue) => issue.code === "missing-parent")?.rankIds,
    ).toEqual([id(3)]);
    expect(issues.find((issue) => issue.code === "orphan")?.rankIds).toEqual([
      id(3),
      id(4),
      id(5),
      id(6),
    ]);
    expect(issues.find((issue) => issue.code === "cycle")?.rankIds).toEqual(
      expect.arrayContaining([id(5), id(6)]),
    );
  });

  it("keeps assignment repairs with their editor instead of marking unrelated chart roles", () => {
    const draft = policy([rank(1), rank(2)]);
    draft.tags = [
      {
        id: id(10),
        name: "North",
        rankIds: [id(2)],
        grants: [],
        denies: [],
      },
      {
        id: id(11),
        name: " north ",
        rankIds: [id(2)],
        grants: [],
        denies: [],
      },
    ];
    expect(organizationIssues(draft)).toContainEqual({
      code: "assignment",
      message: "Tag names must be nonempty and unique.",
      rankIds: [],
    });
    expect(() => validateOrganization(draft)).toThrow();
  });

  it("arranges a valid graph below every parent without mutating the draft", () => {
    const draft = policy([rank(1), rank(2), rank(3), rank(4, [id(2), id(3)])]);
    const before = structuredClone(draft);
    const arranged = layoutOrganization(draft);
    expect(arranged.ranks.find((item) => item.id === id(4))!.y).toBeGreaterThan(
      arranged.ranks.find((item) => item.id === id(2))!.y,
    );
    expect(draft).toEqual(before);
    expect(organizationIssues(arranged)).toEqual([]);
  });

  it("handles permission names that match object prototype properties", () => {
    const draft = policy([rank(1), rank(2)]);
    const result = effectivePermissions(
      [id(2)],
      { [id(2)]: ["__proto__", "constructor", "toString"] },
      draft,
    );
    expect(result.permissions).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(result.sources["__proto__"]).toEqual({
      grants: [id(2)],
      denies: [],
    });
    expect(result.sources.constructor).toEqual({ grants: [id(2)], denies: [] });
  });
});
