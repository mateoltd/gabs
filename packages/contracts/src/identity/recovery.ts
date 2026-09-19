import { Type, type Static } from "@sinclair/typebox";

/** Evidence of a recently authenticated browser session, never an access token. */
export const ProfileRecoverySchema = Type.Object(
  {
    userId: Type.String({ format: "uuid" }),
    sessionId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    authenticatedAt: Type.String({ format: "date-time" }),
    expiresAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type ProfileRecovery = Static<typeof ProfileRecoverySchema>;

/** Database clock used to order recovery intent against session issuance. No identity or credential data. */
export const ProfileRecoveryClockSchema = Type.Object(
  { now: Type.String({ format: "date-time" }) },
  { additionalProperties: false },
);
