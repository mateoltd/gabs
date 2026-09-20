import { Type, type Static } from "@sinclair/typebox";

const id = Type.String({ format: "uuid" });
const timestamp = Type.String({ format: "date-time", maxLength: 40 });
const release = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$",
});
export const IntegrityFailureCodeSchema = Type.Union([
  Type.Literal("invalid-manifest"),
  Type.Literal("unexpected-asset"),
  Type.Literal("missing-asset"),
  Type.Literal("changed-asset"),
  Type.Literal("unreadable-assets"),
  Type.Literal("invalid-signature"),
  Type.Literal("unreadable-audit"),
]);
export const IntegrityScopeSchema = Type.Object(
  { accountId: id, workspaceId: id, deviceId: id },
  { additionalProperties: false },
);
export type IntegrityScope = Static<typeof IntegrityScopeSchema>;
/** An authenticated client's observation. Never proof of device trust or business authority. */
export const IntegrityReportSchema = Type.Object(
  {
    accountId: id,
    deviceId: id,
    incidentId: id,
    event: Type.Union([Type.Literal("locked"), Type.Literal("recovered")]),
    occurredAt: timestamp,
    incidentAt: timestamp,
    release,
    incidentRelease: release,
    failureCode: IntegrityFailureCodeSchema,
    asset: Type.Optional(
      Type.String({
        maxLength: 512,
        pattern:
          "^(?!.*(?:^|/)\\.{1,2}(?:/|$))[a-zA-Z0-9_@.+-]+(?:/[a-zA-Z0-9_@.+-]+)*$",
      }),
    ),
  },
  { additionalProperties: false },
);
export type IntegrityReport = Static<typeof IntegrityReportSchema>;
export const IntegrityReceiptSchema = Type.Object(
  { id, receivedAt: timestamp },
  { additionalProperties: false },
);
export type IntegrityReceipt = Static<typeof IntegrityReceiptSchema>;
export const IntegritySummarySchema = Type.Object(
  {
    reports: Type.Integer({ minimum: 0 }),
    unresolvedReportedIncidents: Type.Integer({ minimum: 0 }),
    receivedLastDay: Type.Integer({ minimum: 0 }),
    maximumDeliveryDelaySeconds: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const IntegrityPageSchema = Type.Object(
  {
    summary: IntegritySummarySchema,
    items: Type.Array(
      Type.Object(
        {
          id,
          receivedAt: timestamp,
          reporterName: Type.String(),
          report: IntegrityReportSchema,
          source: Type.Literal("client-report"),
        },
        { additionalProperties: false },
      ),
    ),
    nextCursor: Type.Union([id, Type.Null()]),
  },
  { additionalProperties: false },
);
export type IntegrityPage = Static<typeof IntegrityPageSchema>;
