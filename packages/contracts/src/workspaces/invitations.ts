import { Type, type Static } from "@sinclair/typebox";

const id = Type.String({ format: "uuid" });

export const InvitationSchema = Type.Object({
  id,
  email: Type.String(),
  state: Type.String(),
  expiresAt: Type.String(),
  roleId: id,
});

export const InvitationQuerySchema = Type.Object(
  {
    cursor: Type.Optional(id),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    search: Type.Optional(Type.String({ maxLength: 254 })),
  },
  { additionalProperties: false },
);

export const InvitationPageSchema = Type.Object({
  items: Type.Array(InvitationSchema),
  nextCursor: Type.Union([id, Type.Null()]),
  total: Type.Integer({ minimum: 0 }),
  workspaceTotal: Type.Integer({ minimum: 0 }),
  pendingTotal: Type.Integer({ minimum: 0 }),
});

export type InvitationQuery = Static<typeof InvitationQuerySchema>;
export type InvitationPage = Static<typeof InvitationPageSchema>;
