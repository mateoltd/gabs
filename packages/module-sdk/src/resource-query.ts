import { Type, type TSchema, type TObject } from "@sinclair/typebox";
import {
  assertSchema,
  hydrateSchema,
  type ResourcePage,
  type ResourceRecord,
} from "./index";
import { canonical } from "./registry";

/** Exact field equality, combined with AND. Objects and arrays are compared in full. */
export interface ResourceListOptions<T = Record<string, unknown>> {
  where?: Partial<T>;
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
  if (input.where) {
    const hydrated = hydrateSchema(schema) as TObject;
    assertSchema(
      Type.Partial(hydrated, {
        additionalProperties: false,
      }),
      input.where,
    );
    for (const [key, value] of Object.entries(input.where))
      assertSchema(hydrated.properties[key], value);
  }
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
