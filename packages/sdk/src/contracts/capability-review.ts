import { Type, type Static } from "@sinclair/typebox";
import {
  hostCapabilitySchemas,
  type HostCapabilityKind,
} from "./host-capabilities";
const object = <P extends Parameters<typeof Type.Object>[0]>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
const decision = object({
  allowed: Type.Boolean(),
  grants: Type.Array(Type.String()),
  denies: Type.Array(Type.String()),
});
export const CapabilityReviewSchema = object({
  moduleId: Type.String(),
  version: Type.String(),
  digest: Type.String(),
  reviewedAt: Type.String(),
  offlineHours: Type.Number({ minimum: 0, maximum: 24 }),
  canReviewRoles: Type.Boolean(),
  capabilities: Type.Array(
    object({
      name: Type.String(),
      kind: Type.Union(
        (Object.keys(hostCapabilitySchemas) as HostCapabilityKind[]).map(
          (kind) => Type.Literal(kind),
        ),
      ),
      permission: Type.String(),
      offline: Type.Boolean(),
    }),
  ),
  roles: Type.Array(
    object({
      id: Type.String(),
      name: Type.String(),
      protected: Type.Boolean(),
      decisions: Type.Record(Type.String(), decision),
    }),
  ),
});
export type CapabilityReview = Static<typeof CapabilityReviewSchema>;
