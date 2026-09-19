import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type { JsonRecord } from "../authoring/module";

/** Host-supplied read provenance. Missing metadata means the source is unknown. */
export const ResourceReadMetadataSchema = Type.Union([
  Type.Object(
    { source: Type.Literal("server") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      source: Type.Literal("cache"),
      downloadedAt: Type.Union([
        Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        Type.Null(),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export type ResourceReadMetadata = Static<typeof ResourceReadMetadataSchema>;
export type ResourceRead<T> = T & { read?: ResourceReadMetadata };

export interface MemberPage {
  items: { id: string; name: string }[];
  nextCursor: string | null;
}
export interface ResourceRecord<T = JsonRecord> {
  id: string;
  data: T;
  version: number;
  archived: boolean;
  updatedAt: string;
}
export interface ResourcePage<T = JsonRecord> {
  items: ResourceRecord<T>[];
  nextCursor: string | null;
}
/** Metadata stays extensible; resource data obeys the module's declared schema. */
export function resourceRecordSchema<S extends TSchema>(data: S) {
  return Type.Object({
    id: Type.String({ minLength: 1 }),
    data,
    version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    archived: Type.Boolean(),
    updatedAt: Type.String({ minLength: 1 }),
  });
}
export function resourcePageSchema<S extends TSchema>(data: S) {
  return Type.Object({
    items: Type.Array(resourceRecordSchema(data)),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  });
}
export class ResourceResponseError extends Error {
  readonly code = "INVALID_RESOURCE_RESPONSE";
  constructor(
    readonly moduleId: string,
    readonly resource: string,
    readonly action: string,
    readonly idempotencyKey: string | undefined,
    cause: unknown,
  ) {
    super(
      "The module returned data that could not be verified." +
        (idempotencyKey
          ? " The request may have completed. Check the record before retrying."
          : " Refresh the records to try again."),
      { cause },
    );
  }
}
/** Structural guard also works when an independently bundled view has its own SDK copy. */
export function isResourceResponseError(
  error: unknown,
): error is Pick<
  ResourceResponseError,
  "code" | "moduleId" | "resource" | "action" | "idempotencyKey" | "message"
> {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return (
    value.code === "INVALID_RESOURCE_RESPONSE" &&
    typeof value.moduleId === "string" &&
    typeof value.resource === "string" &&
    typeof value.action === "string" &&
    typeof value.message === "string" &&
    (value.idempotencyKey === undefined ||
      typeof value.idempotencyKey === "string")
  );
}
