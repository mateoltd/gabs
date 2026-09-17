import { Type, type Static } from "@suite/module-sdk";
import type {
  SignedPackage,
  ServerPackage,
} from "@suite/module-sdk/release-packages";
export const ReviewAction = Type.Union([
  Type.Object(
    {
      action: Type.Literal("approve"),
      reason: Type.String({ minLength: 1, maxLength: 4000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("reject"),
      reason: Type.String({ minLength: 1, maxLength: 4000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("stage") },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("publish") },
    { additionalProperties: false },
  ),
]);
export type ReviewAction = Static<typeof ReviewAction>;
export interface SubmissionSummary {
  id: string;
  module_id: string;
  version: string;
  publisher_id: string;
  state: "pending" | "approved" | "rejected" | "published";
  backend_kind: "none" | "builtin" | "bundled";
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  staged_at: string | null;
  staged_by: string | null;
  client_digest: string;
  server_digest: string | null;
}
export interface SubmissionDetail extends SubmissionSummary {
  client_package: SignedPackage;
  server_package: ServerPackage | null;
  events: {
    id: string;
    actor: string;
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
  }[];
}
export interface ConsoleSession {
  actor: string;
  csrf: string;
}
export interface SubmissionPage {
  items: SubmissionSummary[];
  next: number | null;
}
