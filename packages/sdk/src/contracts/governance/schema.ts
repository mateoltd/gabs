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
