import { randomUUID } from "node:crypto";
import { BootstrapSchema, type OperationRequest } from "@suite/contracts";
import {
  assertSchema,
  hydrateModule,
  Type,
  type ModuleDefinition,
  type Static,
} from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { verifyArtifact } from "@suite/module-sdk/verification";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import {
  CapabilityLeaseAuthoritySchema,
  type CapabilityLease,
} from "@suite/module-sdk/capability-leases";
import type { HostCapabilityCall } from "@suite/module-sdk/host-capabilities";
import { CorporateCapabilityLeases } from "@suite/client/capability-leases";
import type { Scope } from "@suite/client";

/** Only the main transport may classify a failure as disconnected. HTTP failures never use this path. */
export class CapabilityTransportUnavailable extends Error {}

export function isCapabilityTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return true;
  const cause = error.cause as
    { code?: string; errors?: unknown[] } | undefined;
  return (
    error.message === "fetch failed" &&
    !!cause &&
    ([
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(cause.code ?? "") ||
      (!!cause.errors?.length &&
        cause.errors.every((entry) => {
          const code = (entry as { code?: string })?.code;
          return ["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(
            code ?? "",
          );
        })))
  );
}

const ArtifactSchema = Type.Object({
  module_id: Type.String(),
  version: Type.String(),
  manifest: Type.Record(Type.String(), Type.Unknown()),
  digest: Type.String(),
  signature: Type.String(),
  key_id: Type.String(),
  artifact: Type.Record(Type.String(), Type.Unknown()),
});
// TypeBox's portable validator has no ambient UUID-format registry.
const NativeBootstrapSchema = Type.Object({
  ...BootstrapSchema.properties,
  workspace: Type.Object({
    ...BootstrapSchema.properties.workspace.properties,
    id: Type.String({
      pattern:
        "^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
    }),
  }),
});
const StoredSchema = Type.Object({
  issuer: Type.Optional(Type.String()),
  userId: Type.String(),
  workspaceId: Type.String(),
  enabled: Type.Boolean(),
  denied: Type.Boolean(),
  bootstrap: Type.Optional(NativeBootstrapSchema),
  packages: Type.Record(
    Type.String(),
    Type.Object({ pkg: ArtifactSchema, publicKey: Type.String() }),
  ),
});
type Stored = Static<typeof StoredSchema>;
type Reply = { status: number; body: unknown };
interface Host {
  issuer: string;
  currentUser(): string | undefined;
  available(): boolean;
  request(request: OperationRequest): Promise<Reply>;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  purge(prefix: string): Promise<void>;
}
const prefix = (scope: Scope) =>
  `capabilities/${scope.userId}/${scope.workspaceId}`;

/** Main-process-owned authority. None of these storage keys are in the renderer cache allowlist. */
export class NativeCapabilityAuthority {
  private pending: Promise<unknown> = Promise.resolve();
  private states = new Map<string, Stored>();
  private generation = 0;
  private epochs = new Map<string, number>();
  private retryKeys = new Map<string, string>();
  private blocked = new Set<string>();
  private readonly leases: CorporateCapabilityLeases;
  constructor(private readonly host: Host) {
    this.leases = new CorporateCapabilityLeases({
      load: (scope) => host.read(`${prefix(scope)}/leases`),
      save: (scope, value) => host.write(`${prefix(scope)}/leases`, value),
      loadTrust: () => host.read("capabilities/issuers/trust"),
      saveTrust: (value) => host.write("capabilities/issuers/trust", value),
      exclusive: (_scope, task) => this.exclusive(task),
    });
  }
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => {}).then(task);
    this.pending = next.catch(() => {});
    return next;
  }
  clear() {
    this.generation++;
    this.states.clear();
    this.retryKeys.clear();
  }
  private check(scope: Scope) {
    if (this.host.currentUser() !== scope.userId)
      throw Error("This profile is no longer active.");
    if (!this.host.available())
      throw Error("Protected storage is required for offline device actions.");
  }
  private stamp(scope: Scope) {
    return `${this.generation}/${this.epochs.get(prefix(scope)) ?? 0}`;
  }
  private invalidate(scope: Scope) {
    const key = prefix(scope);
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
  }
  private async state(scope: Scope) {
    this.check(scope);
    const key = prefix(scope);
    const generation = this.generation;
    return this.exclusive(async () => {
      this.check(scope);
      if (generation !== this.generation)
        throw Error("This native profile changed while loading authority.");
      const known = this.states.get(key);
      if (known) return known;
      const value = await this.host.read(`${key}/context`);
      if (value !== undefined) assertSchema(StoredSchema, value);
      const state: Stored =
        value === undefined || (value as Stored).issuer !== this.host.issuer
          ? {
              ...scope,
              issuer: this.host.issuer,
              enabled: false,
              denied: true,
              packages: {},
            }
          : structuredClone(value as Stored);
      if (
        state.userId !== scope.userId ||
        state.workspaceId !== scope.workspaceId
      )
        throw Error(
          "The native authority belongs to another profile or workspace.",
        );
      this.check(scope);
      if (generation !== this.generation)
        throw Error("This native profile changed while loading authority.");
      this.states.set(key, state);
      return state;
    });
  }
  private save(scope: Scope, state: Stored) {
    return this.exclusive(() =>
      this.host.write(`${prefix(scope)}/context`, state),
    );
  }
  async revoke(scope: Scope) {
    this.invalidate(scope);
    this.blocked.add(prefix(scope));
    for (const key of this.retryKeys.keys())
      if (key.startsWith(prefix(scope) + "/")) this.retryKeys.delete(key);
    const state = await this.state(scope);
    state.denied = true;
    await this.save(scope, state);
    await this.leases.invalidate(scope);
  }
  async purge(scope: { userId: string; workspaceId?: string }) {
    this.clear();
    await this.exclusive(() =>
      this.host.purge(
        `capabilities/${scope.userId}${scope.workspaceId ? `/${scope.workspaceId}` : ""}`,
      ),
    );
  }
  /** Only successful authenticated API responses call this, never renderer-supplied snapshots. */
  async observe(scope: Scope, value: unknown) {
    const generation = this.generation;
    assertSchema(NativeBootstrapSchema, value);
    if (value.workspace.id !== scope.workspaceId)
      throw Error("The server policy belongs to another workspace.");
    const state = await this.state(scope);
    if (generation !== this.generation)
      throw Error("This native profile changed while receiving policy.");
    const revision = BigInt(value.policyRevision ?? "0");
    const previous = BigInt(state.bootstrap?.policyRevision ?? "0");
    if (revision < previous) return;
    const changed =
      !state.bootstrap ||
      revision !== previous ||
      state.bootstrap.offlineHours !== value.offlineHours;
    if (changed) this.invalidate(scope);
    state.bootstrap = structuredClone(value);
    if (state.enabled) await this.save(scope, state);
    if (changed)
      await this.leases.observePolicy(
        scope,
        value.policyRevision ?? "0",
        value.offlineHours > 0,
      );
  }
  private live(
    scope: Scope,
    module: ModuleDefinition,
    capability: string,
    stamp: string,
    renewing = false,
  ) {
    this.check(scope);
    if (stamp !== this.stamp(scope))
      throw Error("Native device authority changed. Retry this action.");
    const state = this.states.get(prefix(scope));
    const bootstrap = state?.bootstrap;
    const declaration = module.capabilities?.[capability];
    const view = module.navigation?.view
      ? module.views?.[module.navigation.view]
      : undefined;
    const required = [module.id, ...Object.keys(module.dependencies ?? {})];
    if (
      !state?.enabled ||
      state.issuer !== this.host.issuer ||
      (!renewing && (state.denied || this.blocked.has(prefix(scope)))) ||
      !bootstrap ||
      !declaration ||
      !bootstrap.permissions.includes(declaration.permission) ||
      (view && !bootstrap.permissions.includes(view.permission)) ||
      required.some(
        (id) =>
          !bootstrap.modules.some(
            (item) =>
              item.moduleId === id &&
              item.state === "enabled" &&
              item.entitled &&
              item.assigned,
          ),
      )
    )
      throw Error(
        "Current native permissions do not allow this offline device action.",
      );
    return {
      policyRevision: bootstrap.policyRevision ?? "0",
      offlineEnabled: bootstrap.offlineHours > 0,
      expiresAt:
        Date.parse(bootstrap.authorizedAt) + bootstrap.offlineHours * 3600000,
    };
  }
  private async request(scope: Scope, request: OperationRequest) {
    if (this.host.currentUser() !== scope.userId)
      throw Error("This profile is no longer active.");
    const result = await this.host.request(request);
    if (this.host.currentUser() !== scope.userId)
      throw Error("This profile is no longer active.");
    if (result.status !== 200) {
      if (result.status >= 400 && result.status < 500 && this.host.available())
        await this.revoke(scope);
      throw Error(
        (result.body as { message?: string })?.message ??
          "This host action is not authorized.",
      );
    }
    return result.body;
  }
  private async module(scope: Scope, id: string, version: string) {
    const state = await this.state(scope);
    const retained = state.packages[id];
    if (!retained || retained.pkg.version !== version)
      throw Error(
        "Reconnect to verify this module release for offline device actions.",
      );
    await verifyArtifact(retained.pkg as SignedArtifact, retained.publicKey);
    const module = hydrateModule(moduleContract(retained.pkg.artifact));
    if (module.id !== id || module.version !== version)
      throw Error("The native module contract does not match this release.");
    return module;
  }
  async prepare(scope: Scope, id: string, version: string, enabled: boolean) {
    const generation = this.generation;
    const state = await this.state(scope);
    state.enabled = enabled;
    if (!enabled) {
      this.invalidate(scope);
      await this.save(scope, state);
      await this.leases.invalidate(scope);
      return {};
    }
    try {
      const policy = await this.request(scope, {
        operation: "bootstrap",
        params: { workspaceId: scope.workspaceId },
      });
      await this.observe(scope, policy);
    } catch (error) {
      if (!(error instanceof CapabilityTransportUnavailable)) throw error;
      if (generation !== this.generation)
        throw Error("This native profile changed during preparation.");
      const module = await this.module(scope, id, version);
      return this.inspect(scope, module);
    }
    if (generation !== this.generation)
      throw Error("This native profile changed during preparation.");
    const stamp = this.stamp(scope);
    const current = () => {
      this.check(scope);
      if (this.stamp(scope) !== stamp)
        throw Error("Native authority changed during preparation.");
    };
    const trust = (await this.request(scope, { operation: "moduleTrust" })) as {
      publicKey: string;
    };
    const pkg = await this.request(scope, {
      operation: "moduleArtifact",
      params: { workspaceId: scope.workspaceId, moduleId: id },
    });
    assertSchema(ArtifactSchema, pkg);
    if (pkg.module_id !== id || pkg.version !== version)
      throw Error(
        "The selected module release changed. Refresh this view before preparing offline access.",
      );
    await verifyArtifact(pkg as SignedArtifact, trust.publicKey);
    current();
    const module = hydrateModule(moduleContract(pkg.artifact));
    state.packages[id] = { pkg, publicKey: trust.publicKey };
    await this.save(scope, state);
    const authority = await this.leases.observeAuthority(
      scope,
      async () => {
        const value = await this.request(scope, {
          operation: "capabilityLeaseKey",
        });
        assertSchema(CapabilityLeaseAuthoritySchema, value);
        if (value.issuer !== this.host.issuer)
          throw Error(
            "The capability authority does not match the configured API server.",
          );
        return value;
      },
      current,
    );
    for (const [alias, declaration] of Object.entries(
      module.capabilities ?? {},
    )) {
      if (
        declaration.offline !== "lease" ||
        !state.bootstrap?.permissions.includes(declaration.permission)
      )
        continue;
      const key = `${prefix(scope)}/${id}/${version}/${alias}`;
      const idempotencyKey = this.retryKeys.get(key) ?? randomUUID();
      this.retryKeys.set(key, idempotencyKey);
      await this.leases.refresh(
        scope,
        module,
        alias,
        () => this.live(scope, module, alias, stamp, true),
        async () => {
          const lease = (await this.request(scope, {
            operation: "moduleCapabilityLease",
            params: { workspaceId: scope.workspaceId, moduleId: id },
            moduleVersion: version,
            body: { capability: alias },
            idempotencyKey,
          })) as CapabilityLease;
          return { authority, lease };
        },
      );
      this.retryKeys.delete(key);
    }
    current();
    state.denied = false;
    await this.save(scope, state);
    current();
    this.blocked.delete(prefix(scope));
    return this.inspect(scope, module);
  }
  private async inspect(scope: Scope, module: ModuleDefinition) {
    const stamp = this.stamp(scope);
    let expiresAt = Infinity;
    const capabilities: string[] = [];
    for (const [alias, declaration] of Object.entries(
      module.capabilities ?? {},
    )) {
      if (
        declaration.offline !== "lease" ||
        !this.states
          .get(prefix(scope))
          ?.bootstrap?.permissions.includes(declaration.permission)
      )
        continue;
      expiresAt = Math.min(
        expiresAt,
        await this.leases.inspect(scope, module, alias, () =>
          this.live(scope, module, alias, stamp),
        ),
      );
      capabilities.push(alias);
    }
    return Number.isFinite(expiresAt) ? { expiresAt, capabilities } : {};
  }
  async authorize(
    scope: Scope,
    call: HostCapabilityCall,
  ): Promise<{ authorization: unknown; recheck: () => Promise<unknown> }> {
    try {
      const authorization = await this.request(scope, {
        operation: "moduleCapabilityAuthorize",
        params: { workspaceId: scope.workspaceId, moduleId: call.moduleId },
        moduleVersion: call.moduleVersion,
        body: { capability: call.capability },
      });
      return {
        authorization,
        recheck: async () => (await this.authorize(scope, call)).authorization,
      };
    } catch (error) {
      if (!(error instanceof CapabilityTransportUnavailable)) throw error;
    }
    const module = await this.module(scope, call.moduleId, call.moduleVersion);
    const stamp = this.stamp(scope);
    const grant = await this.leases.prepare(scope, module, call, () =>
      this.live(scope, module, call.capability, stamp),
    );
    return {
      authorization: grant.authorization,
      recheck: async () => {
        try {
          return await this.request(scope, {
            operation: "moduleCapabilityAuthorize",
            params: { workspaceId: scope.workspaceId, moduleId: call.moduleId },
            moduleVersion: call.moduleVersion,
            body: { capability: call.capability },
          });
        } catch (error) {
          if (!(error instanceof CapabilityTransportUnavailable)) throw error;
        }
        await grant.recheck();
        return grant.authorization;
      },
    };
  }
}
