import { createModuleClient, type ModuleDefinition } from "@suite/module-sdk";
import type { PlatformState, SignedArtifact } from "@suite/module-sdk/platform";
import {
  OPERATIONS,
  operationPath,
  type OperationId,
  type OperationRequest,
} from "@suite/contracts";
import type { operations } from "./schema";
export type { paths, operations } from "./schema";
type Result<K extends OperationId> = K extends "businessCutoverReview"
  ? import("@suite/contracts").BusinessCutoverReview
  : K extends "moduleFleet"
    ? import("@suite/module-sdk/platform").ModuleFleet
    : K extends "installationReport"
      ? { ok: boolean }
      : K extends "moduleReferences"
        ? import("@suite/module-sdk/references").ReferencePage
        : K extends "moduleMembers"
          ? import("@suite/module-sdk").MemberPage
          : K extends "billingState"
            ? {
                configured: boolean;
                modules: string[];
                status: string;
                subscribed: boolean;
              }
            : K extends "billingCommand"
              ? { url?: string; ok?: boolean }
              : K extends "moduleTrust"
                ? { publicKey: string }
                : K extends "platformState"
                  ? PlatformState
                  : K extends "moduleArtifactMetadata"
                    ? import("@suite/module-sdk/platform").ArtifactMetadata
                    : K extends "moduleArtifact" | "moduleReceiptArtifact"
                      ? SignedArtifact
                      : K extends "platformCommand"
                        ? {
                            ok: boolean;
                            installation?: import("@suite/module-sdk/platform").InstallationReceipt;
                          }
                        : K extends
                              | "moduleRequest"
                              | "moduleOperation"
                              | "moduleQuery"
                          ? unknown
                          : K extends keyof operations
                            ? operations[K] extends {
                                responses: {
                                  200: {
                                    content: { "application/json": infer R };
                                  };
                                };
                              }
                              ? R
                              : never
                            : unknown;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
export type Transport = (
  request: OperationRequest,
  signal?: AbortSignal,
) => Promise<{ status: number; body: unknown }>;
export function httpTransport(
  baseUrl = "",
  getCsrf: () => string | undefined = () => undefined,
): Transport {
  return async (request, signal) => {
    const op = operationPath(request);
    const headers: Record<string, string> = {};
    if (request.body !== undefined)
      headers["Content-Type"] = "application/json";
    const csrf = getCsrf();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (request.idempotencyKey)
      headers["Idempotency-Key"] = request.idempotencyKey;
    if (request.moduleVersion !== undefined)
      headers["X-Module-Version"] = request.moduleVersion;
    if (request.version !== undefined)
      headers["If-Match"] = `"${request.version}"`;
    const timeout = request.operation === "installationReport" ? 2000 : 20000;
    const response = await fetch(baseUrl + op.path, {
      method: op.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: "include",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
    });
    return { status: response.status, body: await response.json() };
  };
}
export class SuiteClient {
  private csrf?: string;
  private reads = new Map<AbortController, string>();
  cancelWorkspace(workspaceId: string) {
    for (const [controller, id] of this.reads)
      if (id === workspaceId) controller.abort();
  }
  private transport: Transport;
  constructor(transport?: Transport) {
    this.transport = transport ?? httpTransport("", () => this.csrf);
  }
  module<const M extends ModuleDefinition>(definition: M, workspaceId: string) {
    return createModuleClient(definition, (call, options) =>
      call.action === "references"
        ? this.request(
            {
              operation: "moduleReferences",
              params: {
                workspaceId,
                moduleId: definition.id,
                resource: call.resource!,
              },
              query:
                call.input as import("@suite/module-sdk/references").ReferenceQuery,
              moduleVersion: call.moduleVersion,
            },
            options,
          )
        : call.action === "operation"
          ? this.request({
              operation:
                call.kind === "query" ? "moduleQuery" : "moduleOperation",
              params: {
                workspaceId,
                moduleId: definition.id,
                operationName: call.operation!,
              },
              body: call.input,
              idempotencyKey: call.key,
              moduleVersion: call.moduleVersion,
            })
          : this.request({
              operation: "moduleRequest",
              params: { workspaceId, moduleId: definition.id },
              body: {
                action: call.action,
                resource: call.resource,
                input: call.input,
              },
              idempotencyKey: call.key,
              moduleVersion: call.moduleVersion,
            }),
    );
  }
  async request<K extends OperationId>(
    request: OperationRequest & { operation: K },
    options?: { signal?: AbortSignal },
  ): Promise<Result<K>> {
    const controller = new AbortController();
    if (
      (OPERATIONS[request.operation].method === "GET" ||
        request.operation === "moduleReceipts" ||
        request.operation === "moduleQuery" ||
        request.operation === "businessCutoverReview") &&
      request.params?.workspaceId
    )
      this.reads.set(controller, request.params.workspaceId);
    let result;
    try {
      const signal = options?.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      signal.throwIfAborted();
      result = await this.transport(request, signal);
      signal.throwIfAborted();
    } finally {
      this.reads.delete(controller);
    }

    if (result.status >= 400) {
      const body = result.body as {
        code?: string;
        message?: string;
        requestId?: string;
        detail?: unknown;
      };
      throw new ApiError(
        result.status,
        body.code ?? "REQUEST_FAILED",
        body.message ?? "The request failed.",
        body.requestId,
        body.detail,
      );
    }
    if (request.operation === "me")
      this.csrf = (result.body as { csrfToken?: string }).csrfToken;
    return result.body as Result<K>;
  }
}
export function isMutation(operation: OperationId) {
  return (
    operation !== "moduleReceipts" && OPERATIONS[operation].method !== "GET"
  );
}
