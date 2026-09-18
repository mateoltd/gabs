import { Type, type Static } from "@sinclair/typebox";
import { RequestKeySchema as key } from "./request-key";
const name = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
/** Settle an exact request: return its receipt or permanently prevent its execution. */
export const AttemptSettlementRequestSchema = Type.Object(
  {
    key,
    call: Type.Union([
      Type.Object(
        {
          action: Type.Union([
            Type.Literal("create"),
            Type.Literal("update"),
            Type.Literal("archive"),
          ]),
          resource: name,
          input: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          action: Type.Literal("operation"),
          operation: name,
          input: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
export const AttemptSettlementSchema = Type.Union([
  Type.Object(
    { key, outcome: Type.Literal("accepted"), result: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    { key, outcome: Type.Literal("cancelled") },
    { additionalProperties: false },
  ),
]);
export type AttemptSettlementRequest = Static<
  typeof AttemptSettlementRequestSchema
>;
export type AttemptSettlement = Static<typeof AttemptSettlementSchema>;
