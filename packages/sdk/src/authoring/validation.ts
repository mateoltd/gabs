import { ownSchemaValue } from "./schema-value";
import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";

export function assertSchema<S extends TSchema>(
  schema: S,
  value: unknown,
): asserts value is Static<S> {
  const candidate = ownSchemaValue(value);
  if (!Value.Check(schema, candidate)) {
    const errors = [...Value.Errors(schema, candidate)]
      .slice(0, 5)
      .map((e) => `${e.path || "/"}: ${e.message}`);
    throw new ValidationError(errors.join("; "));
  }
}
export class ValidationError extends Error {
  readonly code = "INVALID_INPUT";
}
