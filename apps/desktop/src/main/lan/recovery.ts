import { createHash } from "node:crypto";
import { BootstrapSchema, type OperationRequest } from "@suite/contracts";
import {
  Type,
  assertSchema,
  hydrateModule,
  resourceRecordSchema,
  type Static,
  type TSchema,
} from "@suite/module-sdk";
import { assertPendingRelay } from "@suite/module-sdk/relay";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { verifyArtifact } from "@suite/module-sdk/verification";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import type { Scope, LanReceipt } from "@suite/client";
import { validateRelayEnvelope, type RelayEnvelope } from "./transport";
const uuid = Type.String({ format: "uuid" });
const Outcome = Type.Object(
  {
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("accepted"),
      Type.Literal("rejected"),
      Type.Literal("conflict"),
    ]),
    attempts: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Number(),
    message: Type.String(),
  },
  { additionalProperties: false },
);
type Outcome = Static<typeof Outcome>;
interface Host {
  currentUser(): string | undefined;
  request(
    request: OperationRequest,
  ): Promise<{ status: number; body: unknown }>;
  inbox(scope: Scope): Promise<RelayEnvelope[]>;
  read(scope: Scope, key: string): Promise<unknown>;
  write(scope: Scope, key: string, value: Outcome): Promise<void>;
  dismiss(scope: Scope, id: string, digest: string): Promise<void>;
}
function transfer(envelope: RelayEnvelope, scope: Scope) {
  validateRelayEnvelope(envelope, scope.workspaceId);
  if (envelope.kind !== "pending")
    throw Error("This receipt is a package, not a draft.");
  const entry: unknown = JSON.parse(envelope.payload);
  assertPendingRelay(entry);
  if (
    entry.id !== envelope.id ||
    entry.userId !== scope.userId ||
    entry.workspaceId !== scope.workspaceId ||
    (entry.call.key && entry.call.key !== entry.id) ||
    entry.dependencies.includes(entry.id)
  )
    throw Error(
      "This draft does not belong to the current account and workspace, or its retry identity is invalid.",
    );
  return entry;
}
const key = (id: string) => createHash("sha256").update(id).digest("hex");
/** Protected receipt journal. Only an explicit host action can submit a pending envelope. */
export class LanRecovery {
  private generation = 0;
  private pending = Promise.resolve();
  constructor(private readonly host: Host) {}
  invalidate() {
    this.generation++;
  }
  private check(scope: Scope, generation: number) {
    if (
      generation !== this.generation ||
      scope.userId !== this.host.currentUser()
    )
      throw Error("This profile is no longer active.");
  }
  private async authorize(scope: Scope, generation: number) {
    this.check(scope, generation);
    const result = await this.host.request({
      operation: "bootstrap",
      params: { workspaceId: scope.workspaceId },
    });
    this.check(scope, generation);
    if (result.status !== 200)
      throw Error(
        "Sign in with current workspace administrator access to recover received work.",
      );
    assertSchema(BootstrapSchema, result.body);
    if (
      result.body.workspace.id !== scope.workspaceId ||
      !result.body.permissions.includes("modules.manage")
    )
      throw Error("Current workspace administrator access is required.");
  }
  private async outcome(
    scope: Scope,
    id: string,
  ): Promise<Outcome | undefined> {
    const value = await this.host.read(scope, key(id));
    if (value === undefined) return;
    assertSchema(Outcome, value);
    return value;
  }
  async list(scope: Scope): Promise<LanReceipt[]> {
    const generation = this.generation;
    await this.authorize(scope, generation);
    const inbox = await this.host.inbox(scope);
    const items: LanReceipt[] = [];
    for (const envelope of inbox) {
      const base = {
        id: envelope.id,
        digest: envelope.digest,
        kind: envelope.kind,
      };
      if (envelope.kind === "artifact") continue; // Package adoption is separate from draft recovery.
      try {
        const entry = transfer(envelope, scope);
        const outcome = await this.outcome(scope, entry.id);
        if (outcome && outcome.digest !== envelope.digest)
          throw Error(
            "This retry identity already belongs to different content.",
          );
        items.push({
          ...base,
          moduleId: entry.call.moduleId,
          action: entry.call.action,
          target: entry.call.resource ?? entry.call.operation ?? "",
          input: entry.call.input,
          dependencies: entry.dependencies.length,
          state: outcome?.state ?? "received",
          message:
            outcome?.message ??
            "Received from a managed peer. Review before submitting to the server.",
        });
      } catch {
        items.push({
          ...base,
          state: "invalid",
          message:
            "This receipt has invalid draft data or belongs to another account. It cannot be submitted.",
        });
      }
    }
    this.check(scope, generation);
    return items;
  }
  private exclusive<T>(task: () => Promise<T>) {
    const next = this.pending.then(task);
    this.pending = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async submit(scope: Scope, id: string, digest: string) {
    const generation = this.generation;
    return this.exclusive(async () => {
      await this.authorize(scope, generation);
      const envelope = (await this.host.inbox(scope)).find(
        (e) => e.id === id && e.digest === digest,
      );
      if (!envelope)
        throw Error(
          "The received draft changed or was removed. Refresh the inbox.",
        );
      const entry = transfer(envelope, scope);
      const previous = await this.outcome(scope, id);
      if (previous && previous.digest !== digest)
        throw Error(
          "This retry identity already belongs to different content.",
        );
      if (previous?.state === "accepted") return;
      for (const dependency of entry.dependencies) {
        if ((await this.outcome(scope, dependency))?.state !== "accepted")
          throw Error(
            "Submit and confirm this draft's dependencies before retrying. Unrelated drafts can still be submitted.",
          );
      }
      const trust = await this.host.request({ operation: "moduleTrust" });
      const release = await this.host.request({
        operation: "moduleArtifact",
        params: {
          workspaceId: scope.workspaceId,
          moduleId: entry.call.moduleId,
        },
      });
      this.check(scope, generation);
      if (trust.status !== 200 || release.status !== 200)
        throw Error(
          "Current module access and its signed release are required before submission.",
        );
      assertSchema(Type.Object({ publicKey: Type.String() }), trust.body);
      const pkg = release.body as SignedArtifact;
      await verifyArtifact(pkg, trust.body.publicKey);
      if (
        pkg.module_id !== entry.call.moduleId ||
        pkg.version !== entry.call.moduleVersion
      )
        throw Error(
          "The draft's original module release is not active. Restore a compatible authorized release before submitting.",
        );
      const module = hydrateModule(moduleContract(pkg.artifact));
      const call = entry.call;
      let output: TSchema;
      if (call.action === "operation") {
        const operation =
          call.operation && Object.hasOwn(module.operations, call.operation)
            ? module.operations[call.operation]
            : undefined;
        if (
          call.resource ||
          !operation ||
          operation.policy !== "queued" ||
          operation.kind === "query"
        )
          throw Error(
            "Only declared queued operations can be recovered through LAN.",
          );
        assertSchema(operation.input, call.input);
        output = operation.output;
      } else {
        const resource =
          call.resource && Object.hasOwn(module.resources, call.resource)
            ? module.resources[call.resource]
            : undefined;
        if (call.operation || !resource || resource.policy !== "queued")
          throw Error(
            "Only declared queued resource changes can be recovered through LAN.",
          );
        const properties: Record<string, TSchema> =
          call.action === "create"
            ? { id: Type.Optional(uuid), data: resource.schema }
            : call.action === "update"
              ? {
                  id: uuid,
                  data: resource.schema,
                  baseVersion: Type.Integer({ minimum: 1 }),
                  baseData: Type.Optional(resource.schema),
                }
              : { id: uuid, baseVersion: Type.Integer({ minimum: 1 }) };
        assertSchema(
          Type.Object(properties, { additionalProperties: false }),
          call.input,
        );
        output = resourceRecordSchema(resource.schema);
      }
      const outcome: Outcome = {
        digest,
        state: "pending",
        attempts: (previous?.attempts ?? 0) + 1,
        updatedAt: Date.now(),
        message:
          "Awaiting server confirmation. Retrying preserves the original request identity.",
      };
      this.check(scope, generation);
      await this.host.write(scope, key(id), outcome);
      this.check(scope, generation);
      try {
        const result = await this.host.request(
          call.action === "operation"
            ? {
                operation: "moduleOperation",
                params: {
                  workspaceId: scope.workspaceId,
                  moduleId: call.moduleId,
                  operationName: call.operation!,
                },
                body: call.input,
                moduleVersion: call.moduleVersion,
                idempotencyKey: entry.id,
              }
            : {
                operation: "moduleRequest",
                params: {
                  workspaceId: scope.workspaceId,
                  moduleId: call.moduleId,
                },
                body: {
                  resource: call.resource,
                  action: call.action,
                  input: call.input,
                },
                moduleVersion: call.moduleVersion,
                idempotencyKey: entry.id,
              },
        );
        this.check(scope, generation);
        if (result.status >= 200 && result.status < 300) {
          assertSchema(output, result.body);
          outcome.state = "accepted";
          outcome.message = "Accepted by the authoritative server.";
        } else if (
          result.status >= 400 &&
          result.status < 500 &&
          ![401, 408, 429].includes(result.status)
        ) {
          outcome.state = [409, 412].includes(result.status)
            ? "conflict"
            : "rejected";
          const body = result.body as { message?: unknown };
          outcome.message =
            typeof body?.message === "string"
              ? body.message.slice(0, 1000)
              : "The server rejected this draft.";
        }
      } catch {
        // A missing or unverifiable response cannot establish whether the server committed.
        // The persisted pending receipt and original idempotency key survive a crash/retry.
      }
      this.check(scope, generation);
      outcome.updatedAt = Date.now();
      await this.host.write(scope, key(id), outcome);
    });
  }
  async dismiss(scope: Scope, id: string, digest: string) {
    const generation = this.generation;
    return this.exclusive(async () => {
      await this.authorize(scope, generation);
      this.check(scope, generation);
      const outcome = await this.outcome(scope, id);
      if (!outcome || outcome.digest !== digest || outcome.state !== "accepted")
        throw Error(
          "Only a server-accepted receipt can be dismissed. Unconfirmed work is retained for recovery.",
        );
      this.check(scope, generation);
      await this.host.dismiss(scope, id, digest);
    });
  }
}
