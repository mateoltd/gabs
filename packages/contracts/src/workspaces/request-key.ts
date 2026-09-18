import { Type } from "@sinclair/typebox";

/** Opaque server receipt identity. Preserve punctuation, case and internal spaces. */
export const RequestKeySchema = Type.String({
  minLength: 8,
  maxLength: 128,
  // PostgreSQL text cannot represent NUL, including in JSON receipt lookups.
  pattern: "^[^\u0000]*$",
});
