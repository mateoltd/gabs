import { sendModuleCall } from "../modules/transport";
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
) => Promise<{ status: number; body: unknown; actorId?: string }>;
export function httpTransport(
  baseUrl = "",
  getCsrf: () => string | undefined = () => undefined,
): Transport {
  return async (request, signal) => {
    const op = operationPath(request);
    const headers: Record<string, string> = {};
    if (request.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (request.expectedUserId)
      headers["X-Suite-Actor"] = request.expectedUserId;
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
    return {
      status: response.status,
      body: await response.json(),
      actorId: response.headers.get("x-suite-actor") ?? undefined,
    };
  };
}
export interface IdentityInvalidation {
  userId: string;
  reason: "changed" | "unauthenticated";
  remote?: boolean;
}
interface SessionState {
  userId?: string;
  csrf?: string;
  generation: number;
  meSequence: number;
  lastInvalidUser?: string;
  listeners: Set<(event: IdentityInvalidation) => Promise<void>>;
}
export class SuiteClient {
  private session: SessionState = {
    generation: 0,
    meSequence: 0,
    listeners: new Set(),
  };
  private expectedUserId?: string;
  onIdentityInvalidated(
    listener: (event: IdentityInvalidation) => Promise<void>,
  ) {
    this.session.listeners.add(listener);
    return () => {
      this.session.listeners.delete(listener);
    };
  }
  async invalidateIdentity(userId = this.session.userId, remote = false) {
    if (userId && this.session.userId && userId !== this.session.userId) return;
    if (
      !this.session.userId &&
      userId &&
      this.session.lastInvalidUser === userId
    )
      return;
    this.session.lastInvalidUser = userId;
    this.session.generation++;
    this.session.userId = undefined;
    this.session.csrf = undefined;
    if (userId)
      await Promise.all(
        [...this.session.listeners].map((listener) =>
          listener({ userId, reason: "unauthenticated", remote }),
        ),
      );
  }
  isCurrentUser(userId: string) {
    return this.session.userId === userId;
  }
  forUser(userId: string): SuiteClient {
    const client = new SuiteClient(this.transport);
    client.session = this.session;
    client.expectedUserId = userId;
    return client;
  }
  private reads = new Map<AbortController, string>();
  cancelWorkspace(workspaceId: string) {
    for (const [controller, id] of this.reads)
      if (id === workspaceId) controller.abort();
  }
  private transport: Transport;
  constructor(transport?: Transport) {
    this.transport = transport ?? httpTransport("", () => this.session.csrf);
  }
  module<const M extends ModuleDefinition>(definition: M, workspaceId: string) {
    return createModuleClient(definition, (call, options) =>
      sendModuleCall(this, { workspaceId }, call, options),
    );
  }
  async request<K extends OperationId>(
    request: OperationRequest & { operation: K },
    options?: { signal?: AbortSignal },
  ): Promise<Result<K>> {
    const expected = this.expectedUserId;
    if (expected && this.session.userId && expected !== this.session.userId)
      throw new ApiError(
        401,
        "PROFILE_CHANGED",
        "This request belongs to another profile.",
      );
    const generation = this.session.generation;
    const meSequence =
      request.operation === "me" && !expected
        ? ++this.session.meSequence
        : undefined;
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
      result = await this.transport(
        expected ? { ...request, expectedUserId: expected } : request,
        signal,
      );
      signal.throwIfAborted();
    } finally {
      this.reads.delete(controller);
    }

    if (
      (meSequence !== undefined && meSequence !== this.session.meSequence) ||
      (request.operation !== "connection" &&
        generation !== this.session.generation) ||
      (expected && this.session.userId && expected !== this.session.userId)
    )
      throw new ApiError(
        401,
        "PROFILE_CHANGED",
        "The active profile changed while this request was running.",
      );
    if (expected && result.actorId && result.actorId !== expected) {
      await this.invalidateIdentity(expected);
      throw new ApiError(
        401,
        "PROFILE_CHANGED",
        "The server authenticated a different profile. Revalidate your identity.",
      );
    }
    if (result.status === 401 && (expected || this.session.userId))
      await this.invalidateIdentity(expected ?? this.session.userId);
    if (expected && result.status < 400 && !result.actorId)
      throw new ApiError(
        409,
        "IDENTITY_UNVERIFIED",
        "The server did not confirm this response's profile. Update the server before continuing.",
      );

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
    if (request.operation === "me" && !expected) {
      const body = result.body as { user: { id: string }; csrfToken?: string };
      if (result.actorId && result.actorId !== body.user.id)
        throw new ApiError(
          401,
          "PROFILE_CHANGED",
          "The identity response does not match its authenticated profile.",
        );
      const previous = this.session.userId;
      this.session.userId = body.user.id;
      this.session.csrf = body.csrfToken;
      this.session.lastInvalidUser = undefined;
      if (previous && previous !== body.user.id) {
        this.session.generation++;
        await Promise.all(
          [...this.session.listeners].map((listener) =>
            listener({ userId: previous, reason: "changed" }),
          ),
        );
      }
    }
    if (
      meSequence !== undefined &&
      (meSequence !== this.session.meSequence ||
        this.session.userId !==
          (result.body as { user: { id: string } }).user.id)
    )
      throw new ApiError(
        401,
        "PROFILE_CHANGED",
        "A newer identity observation superseded this reply.",
      );
    return result.body as Result<K>;
  }
}
export function isMutation(operation: OperationId) {
  return (
    operation !== "moduleReceipts" && OPERATIONS[operation].method !== "GET"
  );
}
