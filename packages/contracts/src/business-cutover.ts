import { Type, type Static } from "@sinclair/typebox";
const id = Type.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
const version = Type.String({ minLength: 1, maxLength: 40 });
const permission = Type.String({ minLength: 1, maxLength: 100 });
export const BusinessCutoverSelectionSchema = Type.Object(
  {
    inventory: version,
    orders: version,
    roleGrants: Type.Array(
      Type.Object(
        {
          roleId: id,
          permissions: Type.Array(permission, {
            maxItems: 50,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    grantServices: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type BusinessCutoverSelection = Static<
  typeof BusinessCutoverSelectionSchema
>;
export const BusinessCutoverCommandSchema = Type.Object(
  {
    ...BusinessCutoverSelectionSchema.properties,
    reviewToken: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
export type BusinessCutoverCommand = Static<
  typeof BusinessCutoverCommandSchema
>;
export const BusinessCutoverReviewSchema = Type.Object({
  token: Type.String(),
  ready: Type.Boolean(),
  completed: Type.Boolean(),
  issues: Type.Array(
    Type.Object({ code: Type.String(), message: Type.String() }),
  ),
  releases: Type.Array(
    Type.Object({
      moduleId: Type.String(),
      version,
      digest: Type.String(),
      permissions: Type.Array(permission),
      newPermissions: Type.Array(permission),
    }),
  ),
  roles: Type.Array(
    Type.Object({
      id,
      name: Type.String(),
      permissions: Type.Array(permission),
      additions: Type.Array(permission),
    }),
  ),
  services: Type.Array(
    Type.Object({
      operation: Type.String(),
      permission,
      granted: Type.Boolean(),
    }),
  ),
  restrictedMembers: Type.Array(
    Type.Object({ id, name: Type.String(), missing: Type.Array(permission) }),
  ),
  restrictedCount: Type.Integer(),
  counts: Type.Object({
    products: Type.Integer(),
    orders: Type.Integer(),
    movements: Type.Integer(),
  }),
});
export type BusinessCutoverReview = Static<typeof BusinessCutoverReviewSchema>;
