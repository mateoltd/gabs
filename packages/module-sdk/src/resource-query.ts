import { Type, type TSchema, type TObject } from "@sinclair/typebox";
import {
  assertSchema,
  ValidationError,
  hydrateSchema,
  type ResourcePage,
  type ResourceRecord,
} from "./index";
import type { StoreFilter } from "./store-query";
import { canonical } from "./registry";

export type ResourceRanges<T = Record<string, unknown>> = NonNullable<
  StoreFilter<T>["ranges"]
>;
export type ResourceRangeBounds = {
  gt?: string | number;
  gte?: string | number;
  lt?: string | number;
  lte?: string | number;
};

/** Exact field equality, combined with AND. Objects and arrays are compared in full. */
export interface ResourceListOptions<T = Record<string, unknown>> {
  where?: Partial<T>;
  ranges?: ResourceRanges<T>;
  search?: string;
  cursor?: string;
  limit?: number;
  archived?: boolean;
}

export const resourceListSchema = Type.Object(
  {
    where: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), { maxProperties: 16 }),
    ),
    ranges: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Object(
          {
            gt: Type.Optional(Type.Union([Type.String(), Type.Number()])),
            gte: Type.Optional(Type.Union([Type.String(), Type.Number()])),
            lt: Type.Optional(Type.Union([Type.String(), Type.Number()])),
            lte: Type.Optional(Type.Union([Type.String(), Type.Number()])),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        { maxProperties: 8 },
      ),
    ),
    search: Type.Optional(Type.String({ maxLength: 100 })),
    cursor: Type.Optional(
      Type.String({
        pattern:
          "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    archived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** Shared by the corporate host, standalone workers and development simulator. */
export function validateResourceList(
  schema: TSchema,
  input: unknown,
): asserts input is ResourceListOptions {
  assertSchema(resourceListSchema, input);
  const hydrated = hydrateSchema(schema) as TObject;
  if (input.where) {
    assertSchema(
      Type.Partial(hydrated, {
        additionalProperties: false,
      }),
      input.where,
    );
    for (const [key, value] of Object.entries(input.where))
      assertSchema(hydrated.properties[key], value);
  }
  for (const [key, bounds] of Object.entries(input.ranges ?? {}) as [
    string,
    ResourceRangeBounds,
  ][]) {
    const field = Object.hasOwn(hydrated.properties, key)
      ? hydrated.properties[key]
      : undefined;
    if (!field || !resourceRangeKind(field))
      throw new ValidationError(
        `The ${key} field does not support range filters.`,
      );
    for (const value of Object.values(bounds)) assertSchema(field, value);
    if (
      (Object.hasOwn(bounds, "gt") && Object.hasOwn(bounds, "gte")) ||
      (Object.hasOwn(bounds, "lt") && Object.hasOwn(bounds, "lte"))
    )
      throw new ValidationError(
        "Choose one lower bound and one upper bound per field.",
      );
    const lower = bounds.gt ?? bounds.gte;
    const upper = bounds.lt ?? bounds.lte;
    if (lower !== undefined && upper !== undefined) {
      const order = compareResourceScalars(lower, upper);
      if (
        order > 0 ||
        (order === 0 && (bounds.gt !== undefined || bounds.lt !== undefined))
      )
        throw new ValidationError("The range must include at least one value.");
    }
  }
}

/** Supported scalar ranges; nullable/optional fields retain their non-null kind. */
export function resourceRangeKind(
  schema: TSchema,
): "string" | "number" | undefined {
  if (schema.type === "string") return "string";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (Array.isArray(schema.anyOf)) {
    const kinds = schema.anyOf
      .filter((s: TSchema) => s.type !== "null")
      .map((s: TSchema) => resourceRangeKind(s));
    if (kinds.length && kinds.every((kind: unknown) => kind === kinds[0]))
      return kinds[0];
  }
  return undefined;
}
/** Unicode code-point order matches PostgreSQL UTF-8 C collation, including astral text. */
export function compareResourceScalars(
  a: string | number,
  b: string | number,
): number {
  if (typeof a === "number" && typeof b === "number")
    return a < b ? -1 : a > b ? 1 : 0;
  const left = Array.from(String(a)),
    right = Array.from(String(b));
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (delta) return Math.sign(delta);
  }
  return Math.sign(left.length - right.length);
}
export function matchesResourceRanges(
  data: Record<string, unknown>,
  ranges: Record<string, ResourceRangeBounds>,
): boolean {
  return Object.entries(ranges).every(([key, bounds]) => {
    if (!Object.hasOwn(data, key)) return false;
    const value = data[key];
    if (typeof value !== "string" && typeof value !== "number") return false;
    return Object.entries(bounds).every(([op, bound]) => {
      if (typeof value !== typeof bound) return false;
      const compared = compareResourceScalars(value, bound);
      return op === "gt"
        ? compared > 0
        : op === "gte"
          ? compared >= 0
          : op === "lt"
            ? compared < 0
            : compared <= 0;
    });
  });
}

export function listResourceRecords<T extends Record<string, unknown>>(
  schema: TSchema,
  rows: readonly ResourceRecord<T>[],
  input: ResourceListOptions<T>,
): ResourcePage<T> {
  validateResourceList(schema, input);
  const cursor = input.cursor?.toLowerCase();
  const matches = rows
    .filter(
      (row) =>
        row.archived === (input.archived ?? false) &&
        matchesResourceRanges(
          row.data,
          (input.ranges ?? {}) as Record<string, ResourceRangeBounds>,
        ) &&
        (!cursor || row.id.toLowerCase() > cursor) &&
        (!input.search ||
          JSON.stringify(row.data)
            .toLowerCase()
            .includes(input.search.toLowerCase())) &&
        Object.entries(input.where ?? {}).every(
          ([key, value]) =>
            Object.hasOwn(row.data, key) &&
            canonical(row.data[key]) === canonical(value),
        ),
    )
    .sort((a, b) =>
      a.id.toLowerCase() < b.id.toLowerCase()
        ? -1
        : a.id.toLowerCase() > b.id.toLowerCase()
          ? 1
          : 0,
    );
  const limit = input.limit ?? 50;
  return structuredClone({
    items: matches.slice(0, limit),
    nextCursor: matches.length > limit ? matches[limit - 1].id : null,
  });
}
