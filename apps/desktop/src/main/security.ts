import { assertSchema } from "@suite/module-sdk";
import { ReferenceQuerySchema } from "@suite/module-sdk/references";
import {
  OPERATIONS,
  operationPath,
  type OperationRequest,
  type LoginOptions,
} from "@suite/contracts";
export function validateLogin(value: unknown): LoginOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid sign-in options");
  const options = value as LoginOptions;
  if (
    Object.keys(options).some(
      (key) => !["loginHint", "screenHint"].includes(key),
    ) ||
    (options.loginHint !== undefined &&
      (typeof options.loginHint !== "string" ||
        options.loginHint.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.loginHint))) ||
    (options.screenHint !== undefined && options.screenHint !== "signup")
  )
    throw Error("Invalid sign-in options");
  return options;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateScope(
  value: unknown,
  currentUserId?: string,
): asserts value is { userId: string; workspaceId?: string } {
  const v = value as { userId?: unknown; workspaceId?: unknown };
  if (
    !v ||
    typeof v.userId !== "string" ||
    !uuid.test(v.userId) ||
    v.userId !== currentUserId ||
    (v.workspaceId !== undefined &&
      (typeof v.workspaceId !== "string" || !uuid.test(v.workspaceId)))
  )
    throw Error("Invalid cache scope");
}
export function validateOperation(value: unknown): OperationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid operation");
  const r = value as OperationRequest;
  if (
    !Object.hasOwn(OPERATIONS, r.operation) ||
    Object.keys(r).some(
      (k) =>
        ![
          "operation",
          "params",
          "query",
          "body",
          "idempotencyKey",
          "version",
          "moduleVersion",
        ].includes(k),
    )
  )
    throw Error("Operation not allowed");
  if (JSON.stringify(value).length > 262144) throw Error("Request too large");
  if (
    r.version !== undefined &&
    (!Number.isSafeInteger(r.version) || r.version < 1)
  )
    throw Error("Invalid version");
  if (
    r.moduleVersion !== undefined &&
    (typeof r.moduleVersion !== "string" ||
      !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(r.moduleVersion) ||
      ![
        "moduleRequest",
        "moduleAttemptSettle",
        "moduleOperation",
        "moduleQuery",
        "moduleMembers",
        "moduleReferences",
        "moduleCapabilityAuthorize",
        "moduleCapabilityLease",
      ].includes(r.operation))
  )
    throw Error("Invalid module version");
  if (
    r.idempotencyKey !== undefined &&
    (typeof r.idempotencyKey !== "string" ||
      !/^[\w-]{8,128}$/.test(r.idempotencyKey))
  )
    throw Error("Invalid request key");
  if (
    r.query &&
    Object.keys(r.query).some(
      (k) =>
        !["cursor", "limit", "search", "status", "stock"].includes(k) &&
        !(
          r.operation === "moduleReferences" &&
          ["field", "selected"].includes(k)
        ) &&
        !(r.operation === "moduleFleet" && k === "offset") &&
        !(
          ["moduleCapabilityReview", "moduleReceiptArtifact"].includes(
            r.operation,
          ) && k === "version"
        ) &&
        !(r.operation === "workspacePolicy" && k === "since"),
    )
  )
    throw Error("Invalid query");
  if (
    r.query?.version !== undefined &&
    (typeof r.query.version !== "string" ||
      !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(r.query.version))
  )
    throw Error("Invalid review release");
  if (
    r.query?.offset !== undefined &&
    (!Number.isSafeInteger(r.query.offset) ||
      Number(r.query.offset) < 0 ||
      Number(r.query.offset) > 1000000)
  )
    throw Error("Invalid device page");
  if (
    r.query?.since !== undefined &&
    !/^[0-9]{1,20}$/.test(String(r.query.since))
  )
    throw Error("Invalid policy revision");
  if (r.operation === "moduleReferences")
    assertSchema(ReferenceQuerySchema, r.query);
  operationPath(r);
  return r;
}
export function trustedSender(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "suite:" && u.hostname === "app";
  } catch {
    return false;
  }
}
