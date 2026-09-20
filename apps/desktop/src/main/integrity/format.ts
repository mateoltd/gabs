import {
  IntegrityFailureCodeSchema,
  IntegrityScopeSchema,
  type IntegrityScope,
} from "@suite/contracts";
import { assertSchema } from "@suite/module-sdk";
import { valid as validVersion } from "semver";

export const integrityFailureCodes = IntegrityFailureCodeSchema.anyOf.map(
  (value) => value.const,
);
export type IntegrityFailure = {
  code: (typeof integrityFailureCodes)[number];
  asset?: string;
};

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw Error("Invalid integrity record.");
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw Error("Invalid integrity record.");
  return value;
}
export const integrityId = (value: unknown) =>
  text(
    value,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
function timestamp(value: unknown) {
  const result = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    throw Error("Invalid integrity record.");
  return result;
}
export function parseIntegrityRelease(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    validVersion(value) === null
  )
    throw Error("Invalid integrity record.");
  return value;
}
export function parseIntegrityFailure(value: unknown): IntegrityFailure {
  const item = object(value, ["code", "asset"]);
  const code = integrityFailureCodes.find((code) => code === item.code);
  if (!code) throw Error("Invalid integrity record.");
  if (item.asset === undefined) return { code };
  if (typeof item.asset !== "string" || item.asset.length > 512)
    throw Error("Invalid integrity record.");
  const asset = text(item.asset, /^[a-zA-Z0-9_@.+-]+(?:\/[a-zA-Z0-9_@.+-]+)*$/);
  if (asset.split("/").some((part) => part === "." || part === ".."))
    throw Error("Invalid integrity record.");
  return { code, asset };
}
export function parseIntegrityIncident(value: unknown) {
  const item = object(value, ["id", "at", "release", "failure", "scope"]);
  let scope: IntegrityScope | undefined;
  if (item.scope !== undefined) {
    assertSchema(IntegrityScopeSchema, item.scope);
    scope = {
      accountId: item.scope.accountId.toLowerCase(),
      workspaceId: item.scope.workspaceId.toLowerCase(),
      deviceId: item.scope.deviceId.toLowerCase(),
    };
  }
  return {
    id: integrityId(item.id),
    at: timestamp(item.at),
    release: parseIntegrityRelease(item.release),
    failure: parseIntegrityFailure(item.failure),
    ...(scope ? { scope } : {}),
  };
}
export type IntegrityIncident = ReturnType<typeof parseIntegrityIncident>;
export function parseIntegrityEvent(value: unknown) {
  const item = object(value, ["event", "incident", "at", "release"]);
  if (item.event !== "locked" && item.event !== "recovered")
    throw Error("Invalid integrity record.");
  return {
    event: item.event,
    incident: parseIntegrityIncident(item.incident),
    at: timestamp(item.at),
    release: parseIntegrityRelease(item.release),
  } as const;
}
export type IntegrityEvent = ReturnType<typeof parseIntegrityEvent>;

export function parseIntegrityRepair(value: unknown) {
  const item = object(value, ["version", "kind", "id", "at", "release"]);
  if (item.version !== 1 || item.kind !== "audit-repair")
    throw Error("Invalid integrity repair.");
  return {
    version: 1 as const,
    kind: "audit-repair" as const,
    id: integrityId(item.id),
    at: timestamp(item.at),
    release: parseIntegrityRelease(item.release),
  };
}
export type IntegrityRepair = ReturnType<typeof parseIntegrityRepair>;
