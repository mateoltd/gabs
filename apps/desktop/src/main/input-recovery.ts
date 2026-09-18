import { BootstrapSchema, type OperationRequest } from "@suite/contracts";
import { assertSchema, hydrateModule, Type } from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import {
  SignedArtifactSchema,
  type ModuleInputRecovery,
} from "@suite/module-sdk/platform";
import {
  checkRecoveryPolicy,
  validateRecoveryInput,
} from "@suite/client/input-recovery";
import type { Scope } from "@suite/client";
import { CapabilityTransportUnavailable } from "./capability-authority";

const StoredSchema = Type.Object({
  issuer: Type.String(),
  userId: Type.String(),
  workspaceId: Type.String(),
  enabled: Type.Boolean(),
  denied: Type.Boolean(),
  seenAt: Type.Number(),
  policy: Type.Optional(BootstrapSchema),
  dependencies: Type.Record(Type.String(), Type.Array(Type.String())),
});
type Stored = typeof StoredSchema.static;
interface Host {
  issuer: string;
  currentUser(): string | undefined;
  available(): boolean;
  request(
    request: OperationRequest,
  ): Promise<{ status: number; body: unknown }>;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  purge(prefix: string): Promise<void>;
}
const key = (scope: Scope) =>
  `input-recovery/${scope.userId}/${scope.workspaceId}`;

/** Policy and dependency metadata come only from authenticated main-process responses. */
export class NativeInputRecovery {
  private states = new Map<string, Stored>();
  private generation = 0;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private host: Host) {}
  clear() {
    this.generation++;
    this.states.clear();
  }
  private check(scope: Scope, generation = this.generation) {
    if (
      generation !== this.generation ||
      scope.userId !== this.host.currentUser()
    )
      throw Error("This recovery profile is no longer active.");
  }
  private serial<T>(task: () => Promise<T>) {
    const next = this.pending.catch(() => {}).then(task);
    this.pending = next.catch(() => {});
    return next;
  }
  private async state(scope: Scope) {
    this.check(scope);
    const known = this.states.get(key(scope));
    if (known) return known;
    const generation = this.generation;
    const saved = this.host.available()
      ? await this.host.read(`${key(scope)}/context`)
      : undefined;
    this.check(scope, generation);
    if (saved !== undefined) assertSchema(StoredSchema, saved);
    const value: Stored =
      saved &&
      saved.issuer === this.host.issuer &&
      saved.userId === scope.userId &&
      saved.workspaceId === scope.workspaceId
        ? saved
        : {
            ...scope,
            issuer: this.host.issuer,
            enabled: false,
            denied: true,
            seenAt: Date.now(),
            dependencies: {},
          };
    this.states.set(key(scope), value);
    return value;
  }
  private async save(scope: Scope, state: Stored) {
    if (state.enabled && this.host.available())
      await this.host.write(`${key(scope)}/context`, structuredClone(state));
  }
  revision(scope: Scope) {
    return this.states.get(key(scope))?.policy?.policyRevision;
  }
  observe(scope: Scope, policy: unknown) {
    const generation = this.generation;
    return this.serial(async () => {
      this.check(scope, generation);
      assertSchema(BootstrapSchema, policy);
      if (policy.workspace.id !== scope.workspaceId)
        throw Error("Invalid recovery policy scope.");
      const state = await this.state(scope);
      if (
        BigInt(policy.policyRevision ?? "0") <
        BigInt(state.policy?.policyRevision ?? "0")
      )
        return;
      if (state.policy?.policyRevision !== policy.policyRevision)
        state.dependencies = {};
      state.policy = structuredClone(policy);
      state.denied = false;
      state.seenAt = Date.now();
      await this.save(scope, state);
    });
  }
  observeArtifact(scope: Scope, value: unknown, revision?: string) {
    const generation = this.generation;
    return this.serial(async () => {
      this.check(scope, generation);
      assertSchema(SignedArtifactSchema, value);
      const module = hydrateModule(moduleContract(value.artifact));
      if (module.id !== value.module_id || module.version !== value.version)
        throw Error("Invalid recovery module identity.");
      const state = await this.state(scope);
      if (revision !== undefined && state.policy?.policyRevision !== revision)
        throw Error("Recovery policy changed while verifying dependencies.");
      state.dependencies[module.id] = Object.keys(module.dependencies ?? {});
      await this.save(scope, state);
    });
  }
  setOffline(scope: Scope, enabled: boolean) {
    const generation = this.generation;
    return this.serial(async () => {
      this.check(scope, generation);
      const state = await this.state(scope);
      state.enabled = enabled;
      if (!enabled) await this.host.purge(key(scope));
      else await this.save(scope, state);
    });
  }
  revoke(scope: Scope) {
    return this.serial(async () => {
      const state = await this.state(scope);
      state.denied = true;
      await this.save(scope, state);
    });
  }
  purge(scope: { userId: string; workspaceId?: string }) {
    this.clear();
    return this.serial(() =>
      this.host.purge(
        `input-recovery/${scope.userId}${scope.workspaceId ? `/${scope.workspaceId}` : ""}`,
      ),
    );
  }
  async authorize(
    scope: Scope,
    input: ModuleInputRecovery,
    current: () => void,
  ) {
    validateRecoveryInput(input, scope, input.moduleId);
    const generation = this.generation;
    const check = () => {
      this.check(scope, generation);
      current();
    };
    const request = async (request: OperationRequest) => {
      check();
      const reply = await this.host.request(request);
      check();
      if (reply.status !== 200) {
        await this.revoke(scope);
        throw Error("Current server access does not allow recovery export.");
      }
      return reply.body;
    };
    check();
    let offline = false;
    try {
      const policy = await request({
        operation: "bootstrap",
        params: { workspaceId: scope.workspaceId },
      });
      await this.observe(scope, policy);
      const revision = this.revision(scope);
      // Authenticate the current dependency closure. Older input may outlive its original schema.
      const waiting = [input.moduleId],
        seen = new Set<string>();
      for (let i = 0; i < waiting.length; i++) {
        const id = waiting[i];
        if (seen.has(id)) continue;
        if (seen.size >= 64)
          throw Error("Recovery module dependency limit exceeded.");
        seen.add(id);
        const pkg = await request({
          operation: "moduleArtifact",
          params: { workspaceId: scope.workspaceId, moduleId: id },
        });
        await this.observeArtifact(scope, pkg, revision);
        waiting.push(...(await this.state(scope)).dependencies[id]);
      }
    } catch (error) {
      if (!(error instanceof CapabilityTransportUnavailable)) throw error;
      offline = true;
    }
    await this.serial(async () => {
      check();
      const state = await this.state(scope),
        now = Date.now();
      if (
        !state.policy ||
        state.denied ||
        (offline &&
          (!state.enabled || !this.host.available() || now < state.seenAt))
      )
        throw Error("Reconnect to authorize recovery export.");
      const dependencies = new Set<string>(),
        waiting = [input.moduleId];
      for (let i = 0; i < waiting.length; i++) {
        const id = waiting[i];
        if (dependencies.has(id)) continue;
        if (dependencies.size >= 64 || !Object.hasOwn(state.dependencies, id))
          throw Error("Reconnect to verify recovery module dependencies.");
        dependencies.add(id);
        waiting.push(...state.dependencies[id]);
      }
      checkRecoveryPolicy(state.policy, input, [...dependencies], offline, now);
      state.seenAt = Math.max(state.seenAt, now);
      await this.save(scope, state);
      check();
    });
  }
}
