import {
  assertSchema,
  Type,
  type ModuleDefinition,
  type Static,
} from "@suite/module-sdk";
import {
  CapabilityLeaseAuthoritySchema,
  CapabilityLeaseSchema,
  verifyCapabilityLease,
  verifyCapabilityLeaseGrant,
  verifyCapabilityLeaseAuthority,
  type CapabilityLease,
  type CapabilityLeaseAuthority,
} from "@suite/module-sdk/capability-leases";
import type { HostCapabilityCall } from "@suite/module-sdk/host-capabilities";
import type { Scope } from "../index";

const revision = Type.String({ pattern: "^(0|[1-9][0-9]{0,18})$" });
const StoredSchema = Type.Object(
  {
    version: Type.Literal(1),
    userId: Type.String(),
    workspaceId: Type.String(),
    generation: Type.String(),
    revision,
    enabled: Type.Boolean(),
    highWater: Type.Integer({ minimum: 0 }),
    clockBlocked: Type.Boolean(),
    authority: Type.Optional(CapabilityLeaseAuthoritySchema),
    authorityGeneration: Type.Optional(Type.String()),
    leases: Type.Array(CapabilityLeaseSchema, { maxItems: 256 }),
  },
  { additionalProperties: false },
);
type Stored = Static<typeof StoredSchema>;
const TrustSchema = Type.Object(
  {
    version: Type.Literal(1),
    generation: Type.String(),
    issuers: Type.Array(
      Type.Object(
        {
          authority: CapabilityLeaseAuthoritySchema,
          generation: Type.String(),
          retired: Type.Array(Type.String({ pattern: "^[a-f0-9]{64}$" })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
type Trust = Static<typeof TrustSchema>;

/** The host owns this storage and serializes all readers/writers across its processes or tabs. */
export interface CapabilityLeaseStorage {
  load(scope: Scope): Promise<unknown>;
  save(scope: Scope, value: unknown): Promise<void>;
  loadTrust(): Promise<unknown>;
  saveTrust(value: unknown): Promise<void>;
  /** One client-wide lock, shared with account/workspace purges. */
  exclusive<T>(scope: Scope, task: () => Promise<T>): Promise<T>;
}
/** Read live host state on every call. Throw when the profile/view is locked, stale or unauthorized. */
export interface CapabilityLeaseAccess {
  policyRevision: string;
  offlineEnabled: boolean;
  expiresAt: number;
}
type LiveAccess = () => CapabilityLeaseAccess;
type Clock = () => { wall: number; monotonic: number };
const scopeKey = (scope: Scope) =>
  JSON.stringify([scope.userId, scope.workspaceId]);
const sameGrant = (
  lease: CapabilityLease,
  module: ModuleDefinition,
  capability: string,
) =>
  lease.payload.moduleId === module.id &&
  lease.payload.moduleVersion === module.version &&
  lease.payload.capability === capability;

/** Corporate device leases only. This class cannot authorize business operations or LAN transport. */
export class CorporateCapabilityLeases {
  private epochs = new Map<string, number>();
  private blockedClocks = new Set<string>();
  private denied = new Set<string>();
  private trustEpoch = 0;
  private retired = new Map<string, Set<string>>();
  private clocks = new Map<string, { effective: number; monotonic: number }>();
  constructor(
    private readonly storage: CapabilityLeaseStorage,
    private readonly clock: Clock = () => ({
      wall: Date.now(),
      monotonic: performance.now(),
    }),
  ) {}

  private epoch(scope: Scope) {
    return this.epochs.get(scopeKey(scope)) ?? 0;
  }
  private invalidateLive(scope: Scope) {
    this.epochs.set(scopeKey(scope), this.epoch(scope) + 1);
  }
  private async change<T>(
    scope: Scope,
    task: (state: Stored, trust: Trust) => Promise<T>,
  ): Promise<T> {
    return this.storage.exclusive(scope, async () => {
      const value = await this.storage.load(scope);
      if (value !== undefined) assertSchema(StoredSchema, value);
      const state: Stored =
        value === undefined
          ? {
              version: 1,
              ...scope,
              generation: crypto.randomUUID(),
              revision: "0",
              enabled: true,
              highWater: 0,
              clockBlocked: false,
              leases: [],
            }
          : structuredClone(value as Stored);
      if (
        state.userId !== scope.userId ||
        state.workspaceId !== scope.workspaceId
      )
        throw Error(
          "The offline capability store belongs to another workspace or profile.",
        );
      const trusted = await this.storage.loadTrust();
      if (trusted !== undefined) assertSchema(TrustSchema, trusted);
      const trust: Trust =
        trusted === undefined
          ? { version: 1, generation: "unobserved", issuers: [] }
          : structuredClone(trusted as Trust);
      if (
        new Set(trust.issuers.map(({ authority }) => authority.issuer)).size !==
        trust.issuers.length
      )
        throw Error("The offline authority store contains duplicate issuers.");
      const previousTrust = trust.generation;
      // A failed persistence write cannot erase a key retirement already learned by this host.
      for (const entry of trust.issuers) {
        for (const key of this.retired.get(entry.authority.issuer) ?? []) {
          if (!entry.retired.includes(key)) {
            entry.retired.push(key);
            trust.generation = crypto.randomUUID();
          }
        }
      }
      // Persist clock failures as well as successful reads. A failed write must never grant an effect.
      try {
        return await task(state, trust);
      } finally {
        // Persist trust before grants. A partial write can deny access, never revive an old key.
        if (trust.generation !== previousTrust)
          await this.storage.saveTrust(trust);
        await this.storage.save(scope, state);
      }
    });
  }

  private acceptAuthority(trust: Trust, authority: CapabilityLeaseAuthority) {
    let entry = trust.issuers.find(
      (item) => item.authority.issuer === authority.issuer,
    );
    if (
      entry?.retired.includes(authority.keyId) ||
      this.retired.get(authority.issuer)?.has(authority.keyId)
    )
      throw Error(
        "This offline authority key was retired. Reconnect to the current server.",
      );
    if (entry?.authority.keyId === authority.keyId) return entry;
    if (entry) {
      const retired = this.retired.get(authority.issuer) ?? new Set<string>();
      retired.add(entry.authority.keyId);
      this.retired.set(authority.issuer, retired);
      entry.retired = [...new Set([...entry.retired, ...retired])];
      entry.authority = authority;
      entry.generation = crypto.randomUUID();
    } else {
      entry = {
        authority,
        generation: crypto.randomUUID(),
        retired: [...(this.retired.get(authority.issuer) ?? [])],
      };
      trust.issuers.push(entry);
    }
    trust.generation = crypto.randomUUID();
    this.trustEpoch++;
    return entry;
  }

  private time(scope: Scope, state: Stored, recover = false) {
    const reading = this.clock();
    if (
      !Number.isSafeInteger(reading.wall) ||
      reading.wall < 0 ||
      !Number.isFinite(reading.monotonic) ||
      reading.monotonic < 0
    )
      throw Error(
        "Invalid host clock. Reconnect before using offline device actions.",
      );
    const anchor = recover ? undefined : this.clocks.get(scopeKey(scope));
    if (
      !recover &&
      (reading.wall + 1000 < state.highWater ||
        (anchor && reading.monotonic < anchor.monotonic))
    )
      this.blockedClocks.add(scopeKey(scope));
    if (!recover && this.blockedClocks.has(scopeKey(scope)))
      state.clockBlocked = true;
    const now = Math.max(
      reading.wall,
      recover ? 0 : state.highWater,
      anchor
        ? anchor.effective + Math.floor(reading.monotonic - anchor.monotonic)
        : 0,
    );
    state.highWater = now;
    this.clocks.set(scopeKey(scope), {
      effective: now,
      monotonic: reading.monotonic,
    });
    if (!recover && state.clockBlocked)
      throw Error(
        "The device clock moved backwards. Reconnect to renew offline device access.",
      );
    return now;
  }

  private access(live: LiveAccess, state: Stored, now: number) {
    const access = live();
    assertSchema(revision, access.policyRevision);
    if (!access.offlineEnabled || !state.enabled)
      throw Error("Offline device access is disabled for this workspace.");
    if (!Number.isSafeInteger(access.expiresAt) || access.expiresAt <= now)
      throw Error("Workspace offline access expired. Reconnect to continue.");
    if (BigInt(access.policyRevision) < BigInt(state.revision))
      throw Error(
        "Workspace policy changed. Refresh this view before using a device action.",
      );
    return access;
  }

  /** Call with trusted connected policy, including updates received while another view is open. */
  observePolicy(
    scope: Scope,
    policyRevision: string,
    enabled: boolean,
  ): Promise<void> {
    scope = { ...scope };
    assertSchema(revision, policyRevision);
    // Invalidate pending checks synchronously, before waiting on durable storage.
    this.invalidateLive(scope);
    return this.change(scope, async (state) => {
      if (BigInt(policyRevision) < BigInt(state.revision)) return;
      if (
        policyRevision === state.revision &&
        (!state.enabled || state.enabled === enabled)
      )
        return;
      state.revision = policyRevision;
      state.enabled = enabled;
      state.leases = [];
      state.generation = crypto.randomUUID();
    });
  }

  /** Server denial, logout or explicit recovery invalidates pending acquisitions and retained grants. */
  invalidate(scope: Scope): Promise<void> {
    scope = { ...scope };
    this.invalidateLive(scope);
    this.denied.add(scopeKey(scope));
    return this.change(scope, async (state) => {
      state.leases = [];
      state.generation = crypto.randomUUID();
    });
  }

  /** Observe a key directly from the trusted API, even if subsequent lease issuance fails. */
  async observeAuthority(
    scope: Scope,
    fetchAuthority: () => Promise<unknown>,
    live: () => void,
  ): Promise<CapabilityLeaseAuthority> {
    scope = { ...scope };
    this.invalidateLive(scope);
    const epoch = this.epoch(scope);
    const before = await this.change(scope, async (state, trust) => {
      live();
      return { generation: state.generation, trust: trust.generation };
    });
    const authority = await verifyCapabilityLeaseAuthority(
      await fetchAuthority(),
    );
    await this.change(scope, async (state, trust) => {
      live();
      if (
        epoch !== this.epoch(scope) ||
        before.generation !== state.generation ||
        before.trust !== trust.generation
      )
        throw Error(
          "Offline device authority changed while loading its key. Retry with current permissions.",
        );
      this.acceptAuthority(trust, authority);
      if (
        state.authority?.keyId !== authority.keyId ||
        state.authority?.issuer !== authority.issuer
      ) {
        this.denied.add(scopeKey(scope));
        state.leases = [];
        state.generation = crypto.randomUUID();
      }
      state.authority = authority;
    });
    live();
    return authority;
  }

  /** Only the trusted authenticated transport may supply fetchGrant. Never feed it renderer/module tokens. */
  async refresh(
    scope: Scope,
    module: ModuleDefinition,
    capability: string,
    live: LiveAccess,
    fetchGrant: () => Promise<{
      authority: CapabilityLeaseAuthority;
      lease: CapabilityLease;
    }>,
  ): Promise<void> {
    scope = { ...scope };
    module = structuredClone(module);
    const epoch = this.epoch(scope);
    const before = await this.change(scope, async (state, trust) => {
      this.access(live, state, this.clock().wall);
      return { generation: state.generation, trust: trust.generation };
    });
    const result = structuredClone(await fetchGrant());
    assertSchema(CapabilityLeaseAuthoritySchema, result.authority);
    const origin = new URL(result.authority.issuer);
    if (
      origin.origin !== result.authority.issuer ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw Error("Invalid capability authority origin.");
    await this.change(scope, async (state, trust) => {
      const current = () => {
        if (
          epoch !== this.epoch(scope) ||
          before.generation !== state.generation ||
          before.trust !== trust.generation
        )
          throw Error(
            "Offline device authority changed during renewal. Retry with current permissions.",
          );
        return this.access(live, state, this.clock().wall);
      };
      const access = current();
      await verifyCapabilityLeaseGrant(
        result.lease,
        result.authority.publicKey,
        {
          ...scope,
          issuer: result.authority.issuer,
          module,
          capability,
          minimumPolicyRevision: access.policyRevision,
          now: this.clock().wall,
        },
      );
      if (result.lease.keyId !== result.authority.keyId)
        throw Error("The authority key fingerprint does not match this lease.");
      current();
      if (result.lease.payload.expiresAt <= this.clock().wall)
        throw Error("The offline device lease expired during renewal.");
      const trusted = this.acceptAuthority(trust, result.authority);
      const rotated =
        state.authorityGeneration !== trusted.generation ||
        state.authority?.keyId !== result.authority.keyId ||
        state.authority?.issuer !== result.authority.issuer;
      // Only a newly verified server response can recover a clock fault. Never recover from stored tokens.
      if (
        rotated ||
        this.denied.has(scopeKey(scope)) ||
        state.clockBlocked ||
        state.highWater > this.clock().wall + 1000
      )
        state.leases = [];
      const now = this.time(scope, state, true);
      state.clockBlocked = false;
      state.authority = result.authority;
      state.authorityGeneration = trusted.generation;
      state.revision = result.lease.payload.policyRevision;
      state.leases = state.leases.filter(
        (lease) =>
          lease.payload.expiresAt > now &&
          lease.payload.policyRevision === state.revision &&
          !sameGrant(lease, module, capability),
      );
      if (state.leases.length >= 256) state.leases.shift();
      state.leases.push(result.lease);
      state.generation = crypto.randomUUID();
    });
    if (epoch !== this.epoch(scope))
      throw Error(
        "Offline device authority changed during renewal. Retry with current permissions.",
      );
    live();
    this.blockedClocks.delete(scopeKey(scope));
    this.denied.delete(scopeKey(scope));
  }

  /** Prepare and recheck again immediately before the effect, especially after a file dialog. */
  async prepare(
    scope: Scope,
    module: ModuleDefinition,
    call: HostCapabilityCall,
    live: LiveAccess,
  ) {
    return this.grant(scope, module, call.capability, live, call);
  }

  /** Readiness for a declared grant without inventing input for a future device action. */
  async inspect(
    scope: Scope,
    module: ModuleDefinition,
    capability: string,
    live: LiveAccess,
  ) {
    return (await this.grant(scope, module, capability, live)).expiresAt;
  }

  private async grant(
    scope: Scope,
    module: ModuleDefinition,
    capability: string,
    live: LiveAccess,
    call?: HostCapabilityCall,
  ) {
    scope = { ...scope };
    module = structuredClone(module);
    call = structuredClone(call);
    const epoch = this.epoch(scope);
    const trustEpoch = this.trustEpoch;
    let leaseId: string | undefined;
    const recheck = () =>
      this.change(scope, async (state, trust) => {
        if (this.denied.has(scopeKey(scope))) {
          if (state.leases.length) {
            state.leases = [];
            state.generation = crypto.randomUUID();
          }
          throw Error(
            "Offline device authority was revoked. Reconnect to renew it.",
          );
        }
        const now = this.time(scope, state);
        const access = this.access(live, state, now);
        const lease = state.leases.find((lease) =>
          sameGrant(lease, module, capability),
        );
        if (!state.authority || !lease)
          throw Error(
            "No offline device lease is available. Reconnect to prepare this action.",
          );
        const issuer = trust.issuers.find(
          ({ authority }) => authority.issuer === state.authority!.issuer,
        );
        if (
          !issuer ||
          state.authorityGeneration !== issuer.generation ||
          issuer.authority.keyId !== state.authority.keyId ||
          issuer.retired.includes(state.authority.keyId) ||
          this.retired.get(state.authority.issuer)?.has(state.authority.keyId)
        ) {
          state.leases = [];
          state.generation = crypto.randomUUID();
          throw Error(
            "Offline device authority changed. Reconnect to renew this workspace's grants.",
          );
        }
        if (leaseId && lease.payload.id !== leaseId)
          throw Error(
            "The offline device lease changed. Start the action again.",
          );
        const expected = {
          ...scope,
          issuer: state.authority.issuer,
          module,
          minimumPolicyRevision: access.policyRevision,
          now,
        };
        const payload = await (call
          ? verifyCapabilityLease(lease, issuer.authority.publicKey, {
              ...expected,
              call,
            })
          : verifyCapabilityLeaseGrant(lease, issuer.authority.publicKey, {
              ...expected,
              capability,
            }));
        const finalNow = this.time(scope, state);
        this.access(live, state, finalNow);
        if (epoch !== this.epoch(scope) || trustEpoch !== this.trustEpoch)
          throw Error("Device authority changed while checking this action.");
        if (payload.expiresAt <= finalNow)
          throw Error(
            "The offline device lease expired while checking this action.",
          );
        leaseId = payload.id;
        return { payload, state };
      }).then(async ({ payload, state }) => {
        // Storage itself may be slow. Check again after its durable write, before returning authority.
        try {
          const now = this.time(scope, state);
          const access = this.access(live, state, now);
          if (
            epoch !== this.epoch(scope) ||
            trustEpoch !== this.trustEpoch ||
            payload.expiresAt <= now ||
            BigInt(access.policyRevision) > BigInt(payload.policyRevision)
          )
            throw Error(
              "Offline device access changed before the action could run.",
            );
        } catch (error) {
          // Preserve a clock fault/expiry learned after the write without restoring an older policy.
          await this.change(scope, async (current) => {
            current.highWater = Math.max(current.highWater, state.highWater);
            current.clockBlocked ||= state.clockBlocked;
          });
          throw error;
        }
        return payload;
      });
    const payload = await recheck();
    return {
      expiresAt: Math.min(payload.expiresAt, live().expiresAt),
      authorization: {
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        moduleId: payload.moduleId,
        moduleVersion: payload.moduleVersion,
        capability: payload.capability,
        kind: payload.kind,
      },
      recheck: async () => {
        await recheck();
      },
    };
  }
}
