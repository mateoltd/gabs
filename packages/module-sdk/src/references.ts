import { ownSchemaValue } from "./schema-value";
import { Value } from "@sinclair/typebox/value";
import {
  assertSchema,
  Type,
  type Static,
  hydrateSchema,
  ValidationError,
  type TSchema,
} from "./index";

export type ReferenceTarget =
  { kind: "member" } | { kind: "resource"; moduleId: string; resource: string };
export interface ReferenceOption {
  value: string;
  label: string;
}
export interface ReferencePage {
  items: ReferenceOption[];
  nextCursor: string | null;
  /** Resolved separately so an existing value remains visible while searching. */
  selected?: ReferenceOption | null;
}
const identifier = Type.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
export const ReferenceQuerySchema = Type.Object(
  {
    field: Type.String({ minLength: 1, maxLength: 2000 }),
    search: Type.Optional(Type.String({ maxLength: 100 })),
    cursor: Type.Optional(identifier),
    selected: Type.Optional(identifier),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export type ReferenceQuery = Static<typeof ReferenceQuerySchema>;
export interface ReferenceField {
  /** JSON pointer into the resource schema, independent of array indices in a record. */
  schemaPath: string;
  schema: TSchema;
  target: ReferenceTarget;
}
export interface ReferenceValue extends ReferenceField {
  /** JSON pointer into the submitted record. */
  path: string;
  value: string;
}
export const referencePointer = (path: string, key: string | number) =>
  `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
export function referenceTarget(
  schema:
    | TSchema
    | {
        "x-reference"?: unknown;
        "x-membership"?: unknown;
      },
): ReferenceTarget | undefined {
  const reference = schema["x-reference"];
  if (schema["x-membership"] !== undefined && schema["x-membership"] !== true)
    throw new ValidationError("A workspace-member annotation must be true.");
  if (reference !== undefined) {
    const object = reference as Record<string, unknown>;
    const slug = /^[a-z][a-z0-9-]{0,63}$/;
    if (
      !object ||
      typeof object !== "object" ||
      Array.isArray(object) ||
      typeof object.module !== "string" ||
      !slug.test(object.module) ||
      typeof object.resource !== "string" ||
      !slug.test(object.resource) ||
      Object.keys(object).some(
        (key) => !["module", "resource"].includes(key),
      ) ||
      schema["x-membership"]
    )
      throw new ValidationError(
        "A reference must declare one module and resource.",
      );
    return {
      kind: "resource",
      moduleId: object.module,
      resource: object.resource,
    };
  }
  return schema["x-membership"] ? { kind: "member" } : undefined;
}
export function referenceTargetKey(target: ReferenceTarget): string {
  return target.kind === "member"
    ? "member"
    : `resource:${target.moduleId}/${target.resource}`;
}
/** Enumerate declarations, including inactive union branches and collection items. */
export function referenceFields(schema: TSchema): ReferenceField[] {
  const result: ReferenceField[] = [];
  function visit(schema: TSchema, schemaPath: string) {
    const target = referenceTarget(schema);
    if (target) result.push({ schemaPath, schema, target });
    for (const group of ["properties", "patternProperties"])
      for (const [key, child] of Object.entries(schema[group] ?? {}))
        visit(
          child as TSchema,
          referencePointer(referencePointer(schemaPath, group), key),
        );
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    )
      visit(
        schema.additionalProperties,
        referencePointer(schemaPath, "additionalProperties"),
      );
    if (Array.isArray(schema.items))
      schema.items.forEach((child: TSchema, index: number) =>
        visit(
          child,
          referencePointer(referencePointer(schemaPath, "items"), index),
        ),
      );
    else if (schema.items)
      visit(schema.items, referencePointer(schemaPath, "items"));
    for (const group of ["anyOf", "allOf"])
      schema[group]?.forEach((child: TSchema, index: number) =>
        visit(
          child,
          referencePointer(referencePointer(schemaPath, group), index),
        ),
      );
  }
  visit(hydrateSchema(schema), "");
  return result;
}
/** Validate the record shape and visit only present values and matching union branches. */
export function referenceValues(
  schema: TSchema,
  value: unknown,
): ReferenceValue[] {
  const root = hydrateSchema(schema);
  assertSchema(root, value);
  const result: ReferenceValue[] = [];
  function visit(
    schema: TSchema,
    value: unknown,
    path: string,
    schemaPath: string,
  ) {
    if (value === undefined || value === null) return;
    const target = referenceTarget(schema);
    if (target) {
      if (
        typeof value !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          value,
        )
      )
        throw new ValidationError(
          `Reference ${path || "/"} must be a record identifier.`,
        );
      result.push({ schema, schemaPath, target, path, value });
    }
    for (const group of ["anyOf", "allOf"])
      schema[group]?.forEach((child: TSchema, index: number) => {
        if (group === "allOf" || Value.Check(child, ownSchemaValue(value)))
          visit(
            child,
            value,
            path,
            referencePointer(referencePointer(schemaPath, group), index),
          );
      });
    if (Array.isArray(value) && schema.items)
      value.forEach((item, index) => {
        const child = Array.isArray(schema.items)
          ? schema.items[index]
          : schema.items;
        if (child)
          visit(
            child,
            item,
            referencePointer(path, index),
            Array.isArray(schema.items)
              ? referencePointer(referencePointer(schemaPath, "items"), index)
              : referencePointer(schemaPath, "items"),
          );
      });
    if (typeof value === "object" && !Array.isArray(value))
      for (const [key, item] of Object.entries(value)) {
        let declared = false;
        if (Object.hasOwn(schema.properties ?? {}, key)) {
          declared = true;
          visit(
            schema.properties[key],
            item,
            referencePointer(path, key),
            referencePointer(referencePointer(schemaPath, "properties"), key),
          );
        }
        for (const [pattern, child] of Object.entries(
          schema.patternProperties ?? {},
        ))
          if (new RegExp(pattern).test(key)) {
            declared = true;
            visit(
              child as TSchema,
              item,
              referencePointer(path, key),
              referencePointer(
                referencePointer(schemaPath, "patternProperties"),
                pattern,
              ),
            );
          }
        if (
          !declared &&
          schema.additionalProperties &&
          typeof schema.additionalProperties === "object"
        )
          visit(
            schema.additionalProperties,
            item,
            referencePointer(path, key),
            referencePointer(schemaPath, "additionalProperties"),
          );
      }
  }
  visit(root, value, "", "");
  return result;
}
