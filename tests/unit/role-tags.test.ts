import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertSchema } from "@suite/module-sdk";
import {
  OrganizationPolicySchema,
  effectivePermissions,
  validateOrganization,
  type OrganizationPolicy,
  type PolicyTag,
} from "@suite/module-sdk/governance";
function fixture() {
  const root = randomUUID(),
    parent = randomUUID(),
    child = randomUUID(),
    other = randomUUID();
  const policy: OrganizationPolicy = {
    rootId: root,
    ranks: [root, parent, child, other].map((id) => ({
      id,
      name: id === root ? "Administrador" : id,
      parents: id === root ? [] : [id === child ? parent : root],
      inherit: false,
      denies: [],
      x: 0,
      y: 0,
    })),
    groups: [],
    tags: [
      {
        id: randomUUID(),
        name: "Reviewers",
        rankIds: [parent, other],
        grants: ["orders.export"],
        denies: [],
      },
    ],
  };
  return { policy, root, parent, child, other };
}
it("combines role tags with opt-in parent inheritance and explains denials across assigned roles", () => {
  const { policy, root, parent, child, other } = fixture();
  const grants = {
    [root]: ["roles.manage", "orders.export"],
    [child]: ["orders.read"],
  };
  assertSchema(OrganizationPolicySchema, policy);
  expect(effectivePermissions([child], grants, policy).permissions).toEqual([
    "orders.read",
  ]);
  policy.ranks.find((rank) => rank.id === child)!.inherit = true;
  expect(
    effectivePermissions([child], grants, policy).sources["orders.export"],
  ).toEqual({ grants: ["Tag: Reviewers"], denies: [] });
  policy.tags!.push({
    id: randomUUID(),
    name: "Restricted",
    rankIds: [other],
    grants: [],
    denies: ["orders.export", "roles.manage"],
  });
  expect(effectivePermissions([child, other], grants, policy)).toMatchObject({
    permissions: ["orders.read"],
    sources: {
      "orders.export": {
        grants: ["Tag: Reviewers"],
        denies: ["Tag: Restricted"],
      },
    },
  });
  expect(
    effectivePermissions([root, other], grants, policy).permissions,
  ).toContain("roles.manage");
  expect(policy.ranks.find((rank) => rank.id === parent)!.parents).toEqual([
    root,
  ]);
});
it("refuses duplicate/unknown tag targets, ambiguous names and direct root denials", () => {
  const { policy, root } = fixture();
  const tag = policy.tags![0];
  for (const tags of [
    [tag, tag],
    [tag, { ...tag, id: randomUUID(), name: " reviewers " }],
    [{ ...tag, name: " " }],
    [{ ...tag, rankIds: [randomUUID()] }],
    [{ ...tag, rankIds: [...tag.rankIds, tag.rankIds[0]] }],
    [{ ...tag, rankIds: [root], denies: ["roles.manage"] }],
  ])
    expect(() => validateOrganization({ ...policy, tags })).toThrow();
  expect(() =>
    assertSchema(OrganizationPolicySchema, {
      ...policy,
      tags: [{ ...tag, roles: [root] }],
    }),
  ).toThrow();
});
it("retains legacy group labels as inert metadata and derives complete tag types from the schema", () => {
  const { policy, child } = fixture();
  delete policy.tags;
  policy.groups.push({
    id: randomUUID(),
    name: "Office",
    rankIds: [child],
    tags: ["orders.export"],
    grants: [],
    denies: [],
  });
  assertSchema(OrganizationPolicySchema, policy);
  expect(effectivePermissions([child], {}, policy).permissions).toEqual([]);
  const invalid: PolicyTag = {
    id: "example",
    name: "Example",
    // @ts-expect-error Tag targets are typed role identifiers, not actor claims.
    rankIds: [42],
    grants: [],
    denies: [],
  };
  void invalid;
});
