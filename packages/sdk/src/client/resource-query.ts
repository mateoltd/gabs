import { Type, type TSchema, type TObject } from "@sinclair/typebox";
import {
  assertSchema,
  ValidationError,
  hydrateSchema,
  type ResourcePage,
  type ResourceRecord,
} from "../index";
import type { StoreFilter } from "../contracts/store-query";
import { canonical } from "../contracts/registry";

export type ResourceRanges<T = Record<string, unknown>> = NonNullable<
  StoreFilter<T>["ranges"]
>;
type SortField<T> = string extends keyof T
  ? string
  : {
      [K in keyof T & string]-?: [NonNullable<T[K]>] extends [never]
        ? never
        : NonNullable<T[K]> extends string
          ? K
          : NonNullable<T[K]> extends number
            ? K
            : NonNullable<T[K]> extends boolean
              ? K
              : never;
    }[keyof T & string];
export type ResourceOrder<T = Record<string, unknown>> = readonly {
  field: SortField<T>;
  direction: "asc" | "desc";
}[];
export interface ResourceSort {
  field: string;
  direction: "asc" | "desc";
}
export type ResourceSortValue = string | number | boolean | null;
export type ResourceSortAnchor = { id: string; values: ResourceSortValue[] };
const uuidPattern =
  "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$";
export const resourceSortAnchorSchema = Type.Object(
  {
    id: Type.String({ pattern: uuidPattern }),
    values: Type.Array(
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
      { maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);

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
  orderBy?: ResourceOrder<T>;
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
    orderBy: Type.Optional(
      Type.Array(
        Type.Object(
          {
            field: Type.String({ minLength: 1, maxLength: 200 }),
            direction: Type.Union([Type.Literal("asc"), Type.Literal("desc")]),
          },
          { additionalProperties: false },
        ),
        { maxItems: 3 },
      ),
    ),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 24576 })),
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
  const order = input.orderBy ?? [];
  if (new Set(order.map((item) => item.field)).size !== order.length)
    throw new ValidationError("Sort fields must be distinct.");
  for (const item of order) {
    const field = Object.hasOwn(hydrated.properties, item.field)
      ? hydrated.properties[item.field]
      : undefined;
    if (!field || !resourceSortKind(field))
      throw new ValidationError(
        `The ${item.field} field does not support sorting.`,
      );
  }
  if (
    input.cursor &&
    (order.length
      ? !/^(rq1\.[A-Za-z0-9_-]{43}|lr1)\.[A-Za-z0-9_-]+$/.test(input.cursor)
      : !new RegExp(uuidPattern).test(input.cursor))
  )
    throw new ValidationError(
      "This pagination cursor does not match the selected sort. Return to the first page.",
    );
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

/** Null and missing values sort last in either direction; UUID ascending breaks ties. */
export function resourceSortKind(
  schema: TSchema,
): "string" | "number" | "boolean" | undefined {
  if (schema.type === "boolean") return "boolean";
  const comparable = resourceRangeKind(schema);
  if (comparable) return comparable;
  if (Array.isArray(schema.anyOf)) {
    const kinds = schema.anyOf
      .filter((s: TSchema) => s.type !== "null")
      .map((s: TSchema) => resourceSortKind(s));
    if (kinds.length && kinds.every((kind: unknown) => kind === kinds[0]))
      return kinds[0];
  }
}
export function resourceSortValues(
  schema: TSchema,
  data: Record<string, unknown>,
  order: readonly ResourceSort[],
): ResourceSortValue[] {
  return order.map(({ field }) => {
    const value = Object.hasOwn(data, field) ? data[field] : null;
    const kind = resourceSortKind(schema.properties[field]);
    return typeof value === kind &&
      (typeof value !== "number" || Number.isFinite(value))
      ? (value as ResourceSortValue)
      : null;
  });
}
export function compareResourceAnchors(
  a: ResourceSortAnchor,
  b: ResourceSortAnchor,
  order: readonly ResourceSort[],
): number {
  for (const [index, sort] of order.entries()) {
    const left = a.values[index],
      right = b.values[index];
    const comparison =
      left === null
        ? right === null
          ? 0
          : 1
        : right === null
          ? -1
          : (typeof left === "boolean" && typeof right === "boolean"
              ? Number(left) - Number(right)
              : compareResourceScalars(
                  left as string | number,
                  right as string | number,
                )) * (sort.direction === "desc" ? -1 : 1);
    if (comparison) return comparison;
  }
  return compareResourceScalars(a.id.toLowerCase(), b.id.toLowerCase());
}
export function validateResourceSortAnchor(
  schema: TSchema,
  order: readonly ResourceSort[],
  value: unknown,
): asserts value is ResourceSortAnchor {
  assertSchema(resourceSortAnchorSchema, value);
  if (
    value.values.length !== order.length ||
    value.values.some(
      (v, i) =>
        v !== null &&
        typeof v !== resourceSortKind(schema.properties[order[i].field]),
    )
  )
    throw new ValidationError(
      "The pagination cursor has incompatible sort values. Return to the first page.",
    );
}
/** Cache identity only. The server still authenticates the complete opaque cursor. */
export function resourceCursorCacheKey(
  cursor: string | undefined,
): string | null {
  if (!cursor) return null;
  const match = /^rq1\.([A-Za-z0-9_-]{43})\.[A-Za-z0-9_-]+$/.exec(cursor);
  return match ? `rq1.${match[1]}` : cursor;
}
export function resourceListScope(
  input: ResourceListOptions,
  namespace = "",
): string {
  return canonical({
    namespace,
    where: input.where ?? {},
    ranges: input.ranges ?? {},
    search: input.search ?? "",
    archived: input.archived ?? false,
    orderBy: input.orderBy ?? [],
  });
}
function localSortCursor(scope: string, value?: string) {
  if (!value) return undefined;
  try {
    if (!value.startsWith("lr1.")) throw Error();
    const base64 = value.slice(4).replaceAll("-", "+").replaceAll("_", "/");
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    );
    if (parsed.scope !== scope) throw Error();
    return parsed.anchor as unknown;
  } catch {
    throw new ValidationError(
      "This cursor belongs to another query or local workspace. Return to the first page.",
    );
  }
}
function encodeLocalSortCursor(
  scope: string,
  anchor: ResourceSortAnchor,
): string {
  const json = JSON.stringify({ scope, anchor });
  if (json.length > 18000)
    throw new ValidationError(
      "The pagination cursor is too large. Sort by shorter fields or narrow the query.",
    );
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > 18000)
    throw new ValidationError(
      "The pagination cursor is too large. Sort by shorter fields or narrow the query.",
    );
  return (
    "lr1." +
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "")
  );
}

export function listResourceRecords<T extends Record<string, unknown>>(
  schema: TSchema,
  rows: readonly ResourceRecord<T>[],
  input: ResourceListOptions<T>,
  namespace = "",
): ResourcePage<T> {
  validateResourceList(schema, input);
  const order = input.orderBy ?? [];
  const scope = resourceListScope(input, namespace);
  let after: ResourceSortAnchor | undefined;
  if (order.length && input.cursor) {
    const decoded = localSortCursor(scope, input.cursor);
    validateResourceSortAnchor(schema, order, decoded);
    after = decoded;
  }
  const anchor = (row: ResourceRecord<T>): ResourceSortAnchor => ({
    id: row.id,
    values: resourceSortValues(schema, row.data, order),
  });
  const cursor = order.length ? undefined : input.cursor?.toLowerCase();
  const matches = rows
    .filter(
      (row) =>
        row.archived === (input.archived ?? false) &&
        matchesResourceRanges(
          row.data,
          (input.ranges ?? {}) as Record<string, ResourceRangeBounds>,
        ) &&
        (!cursor || row.id.toLowerCase() > cursor) &&
        (!after || compareResourceAnchors(anchor(row), after, order) > 0) &&
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
    .sort((a, b) => compareResourceAnchors(anchor(a), anchor(b), order));
  const limit = input.limit ?? 50;
  return structuredClone({
    items: matches.slice(0, limit),
    nextCursor:
      matches.length > limit
        ? order.length
          ? encodeLocalSortCursor(scope, anchor(matches[limit - 1]))
          : matches[limit - 1].id
        : null,
  });
}
