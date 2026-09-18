import { Type, type Static } from "@sinclair/typebox";
import { RequestKeySchema as key } from "./request-key";
/** A read-only lookup. Unknown and currently inaccessible keys are indistinguishable. */
export const ReceiptLookupSchema = Type.Object(
  {
    keys: Type.Array(key, { maxItems: 100, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export const ReceiptLookupResultSchema = Type.Object(
  {
    accepted: Type.Array(key, { maxItems: 100, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type ReceiptLookup = Static<typeof ReceiptLookupSchema>;
export type ReceiptLookupResult = Static<typeof ReceiptLookupResultSchema>;
