import { ownSchemaValue } from "./schema-value";
import { Value } from "@sinclair/typebox/value";
import {
  assertSchema,
  hydrateSchema,
  type Static,
  type TSchema,
} from "./index";

/** Partial values remain drafts until the complete schema accepts them. */
export type SchemaDraft<T> = T extends readonly unknown[]
  ? number extends T["length"]
    ? SchemaDraft<T[number]>[]
    : { [K in keyof T]?: SchemaDraft<T[K]> }
  : T extends object
    ? { [K in keyof T]?: SchemaDraft<T[K]> }
    : T | undefined;
export interface SchemaIssue {
  path: string;
  message: string;
}
export type SchemaResult<S extends TSchema> =
  { ok: true; value: Static<S> } | { ok: false; issues: SchemaIssue[] };

/** Uses the same schema validation as operation handlers, including transported contracts. */
export function parseSchemaInput<S extends TSchema>(
  schema: S,
  value: unknown,
): SchemaResult<S> {
  const hydrated = hydrateSchema(schema);
  const issues = [...Value.Errors(hydrated, ownSchemaValue(value))]
    .slice(0, 100)
    .map(({ path, message }) => ({ path, message }));
  return issues.length
    ? { ok: false, issues }
    : { ok: true, value: structuredClone(value) as Static<S> };
}

/** Start editors without inventing business quantities, references or dates. */
export function createSchemaDraft<S extends TSchema>(
  schema: S,
): SchemaDraft<Static<S>> {
  const create = (current: TSchema): unknown => {
    if (Object.hasOwn(current, "default")) {
      assertSchema(hydrateSchema(current), current.default);
      return structuredClone(current.default);
    }
    if (Object.hasOwn(current, "const")) return structuredClone(current.const);
    if (current.type === "object" && current.properties) {
      const result: Record<string, unknown> = {};
      for (const [name, field] of Object.entries(
        current.properties as Record<string, TSchema>,
      )) {
        if (
          !(current.required ?? []).includes(name) &&
          !Object.hasOwn(field, "default")
        )
          continue;
        const value = create(field);
        if (value !== undefined)
          Object.defineProperty(result, name, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
      }
      return result;
    }
    if (current.type === "array") return [];
    if (current.type === "boolean") return false;
    if (current.type === "null") return null;
    return undefined;
  };
  return create(schema) as SchemaDraft<Static<S>>;
}
