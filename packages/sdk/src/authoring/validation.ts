import { ownSchemaValue } from "./schema-value";
import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";
import { withSchemaFormats } from "./formats";

/** Shared by generated forms and runtime assertions; fully consumes errors in scope. */
export function schemaIssues(
  schema: TSchema,
  value: unknown,
  limit = 100,
): { path: string; message: string }[] {
  const candidate = ownSchemaValue(value);
  return withSchemaFormats(schema, () => {
    if (Value.Check(schema, candidate)) return [];
    const issues: { path: string; message: string }[] = [];
    for (const { path, message } of Value.Errors(schema, candidate)) {
      issues.push({ path, message });
      if (issues.length >= limit) break;
    }
    return issues;
  });
}

export function checkSchema(schema: TSchema, value: unknown): boolean {
  const candidate = ownSchemaValue(value);
  return withSchemaFormats(schema, () => Value.Check(schema, candidate));
}

export function assertSchema<S extends TSchema>(
  schema: S,
  value: unknown,
): asserts value is Static<S> {
  const issues = schemaIssues(schema, value, 5);
  if (issues.length) {
    const errors = issues.map((e) => `${e.path || "/"}: ${e.message}`);
    throw new ValidationError(errors.join("; "));
  }
}
export class ValidationError extends Error {
  readonly code = "INVALID_INPUT";
}
