import { BootstrapSchema, type Bootstrap } from "@suite/contracts";
import { assertSchema } from "@suite/module-sdk";
import type { Scope } from "@suite/client";
import {
  LanTransport,
  validateRelayEnvelope,
  type LanConfig,
  type RelayEnvelope,
} from "./transport";
interface Host {
  receiveArtifact?(
    scope: Scope,
    envelope: RelayEnvelope,
    check: () => void,
  ): Promise<void>;
  currentUser(): string | undefined;
  authorize(scope: Scope): Promise<unknown>;
  configure(scope: Scope): Promise<LanConfig>;
  readInbox(scope: Scope): Promise<unknown>;
  writeInbox(scope: Scope, inbox: RelayEnvelope[]): Promise<void>;
}
const same = (a: Scope | undefined, b: Scope) =>
  a?.userId === b.userId && a.workspaceId === b.workspaceId;
interface Session {
  scope: Scope;
  generation: number;
  transport: LanTransport;
  expiresAt: number;
}
/** Main-owned workspace lifecycle and quarantine. A receipt never accepts a business change. */
export class ManagedLanSession {
  private current?: Session;
  private target?: Scope;
  private generation = 0;
  private transition = Promise.resolve();
  private writes = Promise.resolve();
  private expiry?: ReturnType<typeof setTimeout>;
  private policies = new Map<string, Bootstrap>();
  private key(scope: Scope) {
    return JSON.stringify([scope.userId, scope.workspaceId]);
  }
  constructor(private host: Host) {}
  private identity(scope: Scope) {
    if (scope.userId !== this.host.currentUser())
      throw Error("This profile is no longer active.");
  }
  private check(scope: Scope, generation: number) {
    this.identity(scope);
    if (generation !== this.generation || !same(this.target, scope))
      throw Error("Local network authorization changed.");
  }
  private lease(scope: Scope, policy: unknown): Bootstrap {
    assertSchema(BootstrapSchema, policy);
    if (policy.workspace.id !== scope.workspaceId)
      throw Error("The local network policy belongs to another workspace.");
    return policy;
  }
  private expires(policy: Bootstrap) {
    const issued = Date.parse(policy.authorizedAt);
    if (
      !Number.isFinite(issued) ||
      issued > Date.now() + 60000 ||
      !policy.permissions.includes("modules.manage") ||
      policy.offlineHours <= 0
    )
      throw Error(
        "Workspace administrator access and an offline lease are required.",
      );
    const expiry = issued + Math.min(policy.offlineHours, 24) * 3600000;
    if (expiry <= Date.now())
      throw Error("Local network authorization expired.");
    return expiry;
  }
  private expireAt(session: Session) {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => {
        if (this.current === session)
          void this.stop(session.scope).catch(() => {});
      },
      Math.max(1, session.expiresAt - Date.now()),
    );
  }
  private remember(scope: Scope, received: Bootstrap) {
    const key = this.key(scope);
    const previous = this.policies.get(key);
    const revision = BigInt(received.policyRevision ?? "0");
    const prior = BigInt(previous?.policyRevision ?? "0");
    if (
      previous &&
      (revision < prior ||
        (revision === prior &&
          Date.parse(received.authorizedAt) <
            Date.parse(previous.authorizedAt)))
    )
      return previous;
    const policy = structuredClone(received);
    this.policies.set(key, policy);
    return policy;
  }
  /** Called only for authenticated policy responses, never renderer snapshots. */
  observe(scope: Scope, value: unknown) {
    const key = this.key(scope);
    if (!same(this.target, scope) && !this.policies.has(key)) return;
    const policy = this.remember(scope, this.lease(scope, value));
    if (!same(this.target, scope)) return;
    try {
      const expiry = this.expires(policy);
      if (this.current) {
        this.current.expiresAt = expiry;
        this.expireAt(this.current);
      }
    } catch {
      void this.stop(scope).catch(() => {});
    }
  }
  async enable(scope: Scope) {
    this.identity(scope);
    const stopped = this.stop();
    const generation = this.generation;
    this.target = { ...scope };
    const task = this.transition.then(async () => {
      await stopped;
      this.check(scope, generation);
      const received = this.lease(scope, await this.host.authorize(scope));
      this.check(scope, generation);
      const policy = this.remember(scope, received);
      this.expires(policy);
      const config = await this.host.configure(scope);
      this.check(scope, generation);
      if (config.workspaceId !== scope.workspaceId)
        throw Error("The peer configuration belongs to another workspace.");
      const session: Session = {
        scope: { ...scope },
        generation,
        expiresAt: this.expires(this.remember(scope, policy)),
        transport: new LanTransport(config, (envelope) =>
          this.receive(session, envelope),
        ),
      };
      this.current = session;
      // The lease also bounds discovery, which may outlast a short remaining lease.
      this.expireAt(session);
      try {
        await session.transport.start();
        this.check(scope, generation);
        // Discovery may overlap a newer authenticated policy observation.
        session.expiresAt = this.expires(this.remember(scope, policy));
        this.expireAt(session);
      } catch (error) {
        if (this.current === session) {
          this.current = undefined;
          clearTimeout(this.expiry);
          this.expiry = undefined;
        }
        await session.transport.stop();
        throw error;
      }
    });
    this.transition = task.catch(() => {});
    await task;
    return this.status(scope);
  }
  stop(scope?: Scope): Promise<void> {
    if (scope && !same(this.target, scope)) return Promise.resolve();
    this.generation++;
    this.target = undefined;
    clearTimeout(this.expiry);
    this.expiry = undefined;
    const previous = this.current;
    this.current = undefined;
    // Cancel sockets immediately, even while a prior enable is still awaiting discovery.
    const stopped = previous?.transport.stop() ?? Promise.resolve();
    const task = this.transition.then(async () => {
      await stopped;
      await this.writes;
    });
    this.transition = task.catch(() => {});
    return task;
  }
  private active(scope: Scope) {
    const session = this.current;
    this.identity(scope);
    if (
      !session ||
      !same(session.scope, scope) ||
      session.generation !== this.generation ||
      Date.now() >= session.expiresAt
    )
      throw Error(
        "Enable the authorized local network for this workspace before using this capability.",
      );
    return session;
  }
  status(scope: Scope) {
    const session = this.current;
    if (
      !session ||
      !same(session.scope, scope) ||
      scope.userId !== this.host.currentUser() ||
      Date.now() >= session.expiresAt
    )
      return { enabled: false, peers: [] };
    return { ...session.transport.status(), workspaceId: scope.workspaceId };
  }
  async relay(
    scope: Scope,
    peerId: string,
    envelope: RelayEnvelope,
    recheck: () => Promise<void>,
  ) {
    const session = this.active(scope);
    validateRelayEnvelope(envelope, scope.workspaceId);
    await recheck();
    if (this.active(scope) !== session)
      throw Error("Local network authorization changed.");
    await session.transport.relay(peerId, envelope);
  }
  async inbox(scope: Scope): Promise<RelayEnvelope[]> {
    this.identity(scope);
    await this.writes;
    const value = await this.host.readInbox(scope);
    this.identity(scope);
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10)
      throw Error("The relay quarantine needs recovery.");
    for (const envelope of value)
      validateRelayEnvelope(envelope, scope.workspaceId);
    return value;
  }
  dismiss(scope: Scope, id: string, digest: string) {
    const task = this.writes.then(async () => {
      this.identity(scope);
      const stored = await this.host.readInbox(scope);
      this.identity(scope);
      if (stored === undefined) return;
      if (!Array.isArray(stored) || stored.length > 10)
        throw Error("The relay quarantine needs recovery.");
      for (const envelope of stored)
        validateRelayEnvelope(envelope, scope.workspaceId);
      await this.host.writeInbox(
        scope,
        stored.filter(
          (envelope) => envelope.id !== id || envelope.digest !== digest,
        ),
      );
    });
    this.writes = task.catch(() => {});
    return task;
  }
  private receive(session: Session, envelope: RelayEnvelope): Promise<void> {
    const task = this.writes.then(async () => {
      if (this.active(session.scope) !== session)
        throw Error("Local network authorization changed.");
      validateRelayEnvelope(envelope, session.scope.workspaceId);
      if (envelope.kind === "artifact" && this.host.receiveArtifact) {
        return this.host.receiveArtifact(session.scope, envelope, () => {
          if (this.active(session.scope) !== session)
            throw Error("Local network authorization changed.");
        });
      }
      const stored = await this.host.readInbox(session.scope);
      if (this.active(session.scope) !== session)
        throw Error("Local network authorization changed.");
      if (
        stored !== undefined &&
        (!Array.isArray(stored) || stored.length > 10)
      )
        throw Error("The relay quarantine needs recovery.");
      const inbox = (stored ?? []) as RelayEnvelope[];
      for (const item of inbox)
        validateRelayEnvelope(item, session.scope.workspaceId);
      const previous = inbox.find((item) => item.id === envelope.id);
      if (previous) {
        if (
          previous.kind !== envelope.kind ||
          previous.digest !== envelope.digest
        )
          throw Error(
            "This relay identifier already belongs to different content.",
          );
        return;
      }
      if (inbox.length >= 10) throw Error("Relay inbox is full.");
      await this.host.writeInbox(session.scope, [...inbox, envelope]);
    });
    this.writes = task.catch(() => {});
    return task;
  }
}
