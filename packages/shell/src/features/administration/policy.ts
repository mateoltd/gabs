import type { Bootstrap } from "@suite/contracts";
import {
  canUse,
  type Platform,
  type Scope,
  type Snapshot,
} from "@suite/client";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";

/** An older reply may arrive after a newer notification or explicit refresh. */
export function newerPolicy(
  current: Bootstrap | undefined,
  candidate: Bootstrap,
): Bootstrap {
  if (!current) return candidate;
  const previous = BigInt(current.policyRevision ?? "0");
  const next = BigInt(candidate.policyRevision ?? "0");
  return next < previous ||
    (next === previous && candidate.authorizedAt < current.authorizedAt)
    ? current
    : candidate;
}

export function snapshotWithPolicy(
  snapshot: Snapshot,
  catalog: ModuleCatalog,
  policy?: Bootstrap,
): Snapshot {
  if (!policy) return snapshot;
  const bootstrap = newerPolicy(snapshot.bootstrap, policy);
  return {
    ...snapshot,
    bootstrap,
    expiresAt:
      Date.parse(bootstrap.authorizedAt) + bootstrap.offlineHours * 3600000,
    products: !bootstrap.offlineHours
      ? []
      : canUse(bootstrap, "inventory", "inventory.read", catalog)
        ? snapshot.products
        : canUse(bootstrap, "inventory", "inventory.availability.read", catalog)
          ? snapshot.products.map(({ onHand, reserved, ...product }) => product)
          : [],
    orders:
      bootstrap.offlineHours &&
      canUse(bootstrap, "orders", "orders.read", catalog)
        ? snapshot.orders
        : [],
  };
}

interface Authority {
  generation: string;
  denied: boolean;
}
export interface PolicyRequest extends Readonly<Scope> {
  readonly generation: string;
  readonly epoch: number;
}
const expired = (snapshot: Snapshot): Snapshot => ({
  ...snapshot,
  expiresAt: 0,
  products: [],
  orders: [],
});
const obsolete = () =>
  new DOMException(
    "Workspace authorization changed. Connect to revalidate access.",
    "AbortError",
  );

/** Owns the authorization generation and snapshot under one account/workspace lock. */
export class WorkspacePolicy {
  private currentPolicy: Bootstrap | undefined;
  private accessDenied = false;
  get policy() {
    return this.currentPolicy;
  }
  get denied() {
    return this.accessDenied;
  }
  private epoch = 0;
  private accepted: PolicyRequest | undefined;
  private channel: BroadcastChannel | undefined;
  private listeners = new Set<() => void>();
  constructor(
    private platform: Platform,
    private scope: Scope,
    private catalog: ModuleCatalog,
  ) {}

  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    return navigator.locks.request(
      `suite-snapshot:${this.scope.userId}:${this.scope.workspaceId}`,
      run,
    );
  }
  private async authority(): Promise<Authority> {
    const stored = await this.platform.load<Authority>(
      this.scope,
      "workspace-authority",
    );
    if (stored) {
      if (
        typeof stored.generation !== "string" ||
        typeof stored.denied !== "boolean"
      )
        throw Error(
          "Saved workspace authorization is invalid. Reauthenticate before recovery.",
        );
      return stored;
    }
    // A session-only device needs no persistent write before online authentication.
    return { generation: "initial", denied: false };
  }
  private check(
    authority: Authority,
    request: PolicyRequest,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (
      request.userId !== this.scope.userId ||
      request.workspaceId !== this.scope.workspaceId ||
      request.epoch !== this.epoch ||
      request.generation !== authority.generation
    )
      throw obsolete();
  }
  private async snapshot(): Promise<Snapshot | undefined> {
    const value = await this.platform.load<Snapshot>(this.scope, "snapshot");
    if (value && value.bootstrap?.workspace?.id !== this.scope.workspaceId)
      throw Error("Offline snapshot belongs to a different workspace.");
    return value ?? undefined;
  }
  private revokeMemory() {
    this.epoch++;
    this.accessDenied = true;
    this.accepted = undefined;
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (!this.channel && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(
        `suite-policy:${this.scope.userId}:${this.scope.workspaceId}`,
      );
      this.channel.onmessage = (event) => {
        if (event.data === "revoked") this.revokeMemory();
      };
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.channel?.close();
        this.channel = undefined;
      }
    };
  }
  async begin(signal?: AbortSignal): Promise<PolicyRequest> {
    const epoch = this.epoch;
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      const authority = await this.authority();
      return { ...this.scope, generation: authority.generation, epoch };
    });
  }
  async load(): Promise<Snapshot | undefined> {
    return this.exclusive(async () => {
      const authority = await this.authority();
      const snapshot = await this.snapshot();
      if (authority.denied) {
        this.accessDenied = true;
        return snapshot ? expired(snapshot) : undefined;
      }
      return snapshot
        ? snapshotWithPolicy(snapshot, this.catalog, this.currentPolicy)
        : undefined;
    });
  }
  /** Only an explicit request begun in the current generation can restore denied access. */
  async accept(
    candidate: Bootstrap,
    request?: PolicyRequest,
    signal?: AbortSignal,
  ): Promise<Bootstrap> {
    const ticket = request ?? this.accepted;
    if (!ticket) throw obsolete();
    return this.exclusive(async () => {
      const authority = await this.authority();
      this.check(authority, ticket, signal);
      if (authority.denied && !request) throw obsolete();
      if (candidate.workspace.id !== this.scope.workspaceId)
        throw Error("Offline policy belongs to a different workspace.");
      const snapshot = await this.snapshot();
      const current = this.currentPolicy
        ? newerPolicy(snapshot?.bootstrap, this.currentPolicy)
        : snapshot?.bootstrap;
      const next = newerPolicy(current, candidate);
      this.check(authority, ticket, signal);
      if (snapshot)
        await this.platform.save(
          this.scope,
          "snapshot",
          snapshotWithPolicy(snapshot, this.catalog, next),
        );
      this.check(authority, ticket, signal);
      if (authority.denied)
        await this.platform.save(this.scope, "workspace-authority", {
          ...authority,
          denied: false,
        });
      this.check(authority, ticket, signal);
      this.currentPolicy = next;
      this.accessDenied = false;
      this.accepted = ticket;
      return next;
    });
  }
  async save(snapshot: Snapshot): Promise<Snapshot> {
    const ticket = this.accepted;
    if (!ticket || this.accessDenied) throw obsolete();
    return this.exclusive(async () => {
      const authority = await this.authority();
      this.check(authority, ticket);
      if (
        authority.denied ||
        snapshot.bootstrap.workspace.id !== this.scope.workspaceId
      )
        throw obsolete();
      const stored = await this.snapshot();
      const result = snapshotWithPolicy(
        snapshotWithPolicy(snapshot, this.catalog, stored?.bootstrap),
        this.catalog,
        this.currentPolicy,
      );
      this.check(authority, ticket);
      await this.platform.save(this.scope, "snapshot", result);
      this.check(authority, ticket);
      return result;
    });
  }
  revoke(): Promise<void> {
    this.revokeMemory();
    return this.exclusive(async () => {
      await this.platform.save(this.scope, "workspace-authority", {
        generation: crypto.randomUUID(),
        denied: true,
      });
      this.channel?.postMessage("revoked");
      const snapshot = await this.snapshot();
      if (snapshot)
        await this.platform.save(this.scope, "snapshot", expired(snapshot));
    });
  }
}
