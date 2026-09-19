import { ResourceReadMetadataSchema } from "./resource";
import { Type, type Static } from "@sinclair/typebox";
import { checkSchema } from "../authoring/validation";
import {
  assertSchema,
  hydrateSchema,
  ValidationError,
  type TSchema,
} from "../index";

export type ReferenceTarget =
  { kind: "member" } | { kind: "resource"; moduleId: string; resource: string };
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
export const ReferenceOptionSchema = Type.Object(
  { value: identifier, label: Type.String() },
  { additionalProperties: false },
);
export const ReferencePageSchema = Type.Object(
  {
    items: Type.Array(ReferenceOptionSchema, { maxItems: 100 }),
    nextCursor: Type.Union([identifier, Type.Null()]),
    selected: Type.Optional(Type.Union([ReferenceOptionSchema, Type.Null()])),
  },
  { additionalProperties: false },
);
export const ReferenceReadPageSchema = Type.Object(
  {
    ...ReferencePageSchema.properties,
    offline: Type.Optional(Type.Boolean()),
    read: Type.Optional(ResourceReadMetadataSchema),
  },
  { additionalProperties: false },
);
export type ReferenceReadPage = Static<typeof ReferenceReadPageSchema>;
export type ReferenceOption = Static<typeof ReferenceOptionSchema>;
export type ReferencePage = Static<typeof ReferencePageSchema>;
export type ReferenceLookup = (
  query: ReferenceQuery,
  options?: { signal?: AbortSignal },
) => Promise<ReferenceReadPage>;
export type ReferenceLoader = (
  target: ReferenceTarget,
  query: Omit<ReferenceQuery, "field"> & { limit: number },
  signal: AbortSignal,
) => Promise<ReferenceReadPage>;
/** Resolve only fields declared by the source contract; callers never supply a target route. */
export function referenceQueryField(
  schema: TSchema,
  input: unknown,
): ReferenceField {
  assertSchema(ReferenceQuerySchema, input);
  const query = input as ReferenceQuery;
  const field = referenceFields(schema).find(
    (field) => field.schemaPath === query.field,
  );
  if (!field)
    throw new ValidationError(
      "Choose a declared reference field in this resource.",
    );
  return field;
}
/** Adapter shared by generated and independent forms, without a React dependency. */
export function createReferenceLoader(
  schema: TSchema,
  lookup: ReferenceLookup,
): ReferenceLoader {
  let fields: ReferenceField[] | undefined;
  return async (target, query, signal) => {
    signal.throwIfAborted();
    const field = (fields ??= referenceFields(schema)).find(
      (field) =>
        referenceTargetKey(field.target) === referenceTargetKey(target),
    );
    if (!field)
      return Promise.reject(
        new ValidationError("The module does not declare this reference."),
      );
    return lookup({ ...query, field: field.schemaPath }, { signal });
  };
}
/** Deterministic local/development paging, matching the server's UUID order and literal label search. */
export function pageReferenceOptions(
  options: readonly ReferenceOption[],
  input: ReferenceQuery,
): ReferencePage {
  assertSchema(ReferenceQuerySchema, input);
  const rows = options
    .map((option) => ({ ...option, value: option.value.toLowerCase() }))
    .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const limit = input.limit ?? 25;
  const items = rows
    .filter(
      (row) =>
        (!input.cursor || row.value > input.cursor.toLowerCase()) &&
        (!input.search ||
          row.label.toLowerCase().includes(input.search.toLowerCase())),
    )
    .slice(0, limit + 1);
  return {
    items: items.slice(0, limit),
    nextCursor: items.length > limit ? items[limit - 1].value : null,
    ...(input.selected
      ? {
          selected:
            rows.find((row) => row.value === input.selected!.toLowerCase()) ??
            null,
        }
      : {}),
  };
}
export function resourceReferenceOptions(
  records: readonly import("../index").ResourceRecord[],
): ReferenceOption[] {
  return records
    .filter((row) => !row.archived)
    .map((row) => ({
      value: row.id,
      label:
        ([row.data.name, row.data.title].find(
          (value) => typeof value === "string" && value.length > 0,
        ) as string | undefined) ?? row.id,
    }));
}

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
        if (group === "allOf" || checkSchema(child, value))
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

/** Replace only schema-declared links to one resource record, preserving unrelated UUIDs and input. */
export function remapResourceReferences<S extends TSchema>(
  schema: S,
  data: unknown,
  from: { moduleId: string; resource: string; id: string },
  to: string,
): Static<S> {
  assertSchema(identifier, from.id);
  assertSchema(identifier, to);
  const references = referenceValues(schema, data);
  const matches = references.filter(
    (ref) =>
      ref.target.kind === "resource" &&
      ref.target.moduleId === from.moduleId &&
      ref.target.resource === from.resource &&
      ref.value.toLowerCase() === from.id.toLowerCase(),
  );
  let result = structuredClone(data);
  for (const reference of matches) {
    if (
      references.some(
        (other) =>
          other.path === reference.path &&
          referenceTargetKey(other.target) !==
            referenceTargetKey(reference.target),
      )
    )
      throw new ValidationError(
        "A reference matches multiple targets. Review its schema before changing the record identity.",
      );
    if (!reference.path) {
      result = to;
      continue;
    }
    const segments = reference.path
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    let parent = result;
    for (const segment of segments.slice(0, -1)) {
      if (
        !parent ||
        typeof parent !== "object" ||
        !Object.hasOwn(parent, segment)
      )
        throw new ValidationError("The reference path is no longer present.");
      parent = (parent as Record<string, unknown>)[segment];
    }
    const key = segments.at(-1)!;
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key))
      throw new ValidationError("The reference path is no longer present.");
    Object.defineProperty(parent, key, {
      value: to,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  assertSchema(schema, result);
  return result as Static<S>;
}
