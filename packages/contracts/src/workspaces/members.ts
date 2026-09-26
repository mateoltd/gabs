import { Type, type Static } from "@sinclair/typebox";
import { RoleSchema } from "./roles";
const Id = Type.String({ format: "uuid" });
const ModuleId = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
export const MemberRevisionSchema = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const MemberEditSchema = Type.Object(
  {
    revision: MemberRevisionSchema,
    active: Type.Boolean(),
    roleIds: Type.Array(Id, { maxItems: 20, uniqueItems: true }),
    modules: Type.Array(ModuleId, { maxItems: 100, uniqueItems: true }),
    directModules: Type.Optional(
      Type.Array(ModuleId, { maxItems: 100, uniqueItems: true }),
    ),
  },
  { additionalProperties: false },
);
export type MemberEdit = Static<typeof MemberEditSchema>;
export const MemberSchema = Type.Object({
  id: Id,
  revision: MemberRevisionSchema,
  userId: Id,
  name: Type.String(),
  email: Type.String(),
  active: Type.Boolean(),
  roles: Type.Array(RoleSchema),
  modules: Type.Array(Type.String()),
  directModules: Type.Optional(Type.Array(Type.String())),
  modulePolicies: Type.Optional(
    Type.Array(
      Type.Object({
        moduleId: ModuleId,
        sources: Type.Array(Type.String()),
        assigned: Type.Boolean(),
      }),
    ),
  ),
});

export const MemberQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Id),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    search: Type.Optional(Type.String({ maxLength: 254 })),
  },
  { additionalProperties: false },
);
export const MemberPageSchema = Type.Object({
  items: Type.Array(MemberSchema),
  nextCursor: Type.Union([Id, Type.Null()]),
  total: Type.Integer({ minimum: 0 }),
  workspaceTotal: Type.Integer({ minimum: 0 }),
  activeTotal: Type.Integer({ minimum: 0 }),
  roleCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
});
export type Member = Static<typeof MemberSchema>;
export type MemberQuery = Static<typeof MemberQuerySchema>;
export type MemberPage = Static<typeof MemberPageSchema>;
