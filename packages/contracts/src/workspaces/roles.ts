import { Type, type Static } from "@sinclair/typebox";
const Id = Type.String({ format: "uuid" });
const Text = (max = 200) => Type.String({ minLength: 1, maxLength: max });
export const RoleSchema = Type.Object({
  id: Id,
  name: Type.String(),
  permissions: Type.Array(Type.String()),
  protected: Type.Boolean(),
});
export const RoleDetailsSchema = Type.Object({
  ...RoleSchema.properties,
  revision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
});
export const RoleCreateSchema = Type.Object(
  {
    name: Text(60),
    permissions: Type.Array(Type.String(), {
      maxItems: 100,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export const RoleEditSchema = Type.Object(
  {
    ...RoleCreateSchema.properties,
    revision: RoleDetailsSchema.properties.revision,
  },
  { additionalProperties: false },
);
export type RoleDetails = Static<typeof RoleDetailsSchema>;
export type RoleCreate = Static<typeof RoleCreateSchema>;
export type RoleEdit = Static<typeof RoleEditSchema>;
