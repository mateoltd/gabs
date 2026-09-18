import { Type, assertSchema, type Static } from "@suite/module-sdk";
import { randomUUID } from "node:crypto";
export const heartbeatInterval = 60000;
export const rescanInterval = 600000;
export const peerLimit = 256;
const fingerprint = Type.String({
  pattern: "^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$",
});
const claim = Type.String({
  pattern: "^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}/[a-f0-9-]{36}$",
});
const endpoint = Type.Object(
  {
    id: fingerprint,
    address: Type.String({ maxLength: 15 }),
    port: Type.Integer({ minimum: 1024, maximum: 65535 }),
  },
  { additionalProperties: false },
);
const budget = Type.Object(
  {
    round: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    scans: Type.Array(
      Type.Object(
        {
          address: Type.String({ maxLength: 15 }),
          claims: Type.Array(claim, {
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 254 },
    ),
  },
  { additionalProperties: false },
);
export const TopologySchema = Type.Object(
  {
    protocol: Type.Literal(2),
    port: Type.Integer({ minimum: 1024, maximum: 65535 }),
    peers: Type.Array(endpoint, { maxItems: peerLimit }),
    budget,
  },
  { additionalProperties: false },
);
export type Endpoint = Static<typeof endpoint>;
export type Topology = Static<typeof TopologySchema>;
export type BudgetSnapshot = Static<typeof budget>;
export function assertTopology(value: unknown): asserts value is Topology {
  assertSchema(TopologySchema, value);
  if (
    new Set(value.peers.map((peer) => peer.id)).size !== value.peers.length ||
    new Set(value.budget.scans.map((scan) => scan.address)).size !==
      value.budget.scans.length
  )
    throw Error("Invalid discovery table.");
}
export const PingSchema = Type.Object(
  {
    kind: Type.Literal("ping"),
    workspaceId: Type.String({ minLength: 1, maxLength: 128 }),
    topology: TopologySchema,
  },
  { additionalProperties: false },
);
export const ReservationSchema = Type.Object(
  {
    kind: Type.Literal("scan"),
    workspaceId: PingSchema.properties.workspaceId,
    topology: TopologySchema,
    address: Type.String({ maxLength: 15 }),
    claim,
  },
  { additionalProperties: false },
);
export const DiscoveryReplySchema = Type.Object(
  {
    ok: Type.Literal(true),
    topology: TopologySchema,
    granted: Type.Optional(Type.Boolean()),
    coordinator: Type.Optional(fingerprint),
  },
  { additionalProperties: false },
);
export type DiscoveryReply = Static<typeof DiscoveryReplySchema>;
/** Saturating, mergeable reservations. A common coordinator serializes grants; partitions do not provide consensus. */
export class ScanBudget {
  private epoch = 0;
  private scans = new Map<string, Set<string>>();
  private attempts = new Map<string, number>();
  private completed = new Set<string>();
  constructor(
    private addresses: readonly string[],
    private identity: string,
    private now = () => Date.now(),
  ) {}
  private refresh() {
    // A clock rollback cannot reset a consumed budget. Remote clocks never advance this epoch.
    const round = Math.max(0, Math.floor(this.now() / rescanInterval));
    if (round > this.epoch) {
      this.epoch = round;
      this.scans.clear();
      this.attempts.clear();
      this.completed.clear();
    }
  }
  snapshot(): BudgetSnapshot {
    this.refresh();
    return {
      round: this.epoch,
      scans: [...this.scans].map(([address, claims]) => ({
        address,
        claims: [...claims],
      })),
    };
  }
  merge(value: BudgetSnapshot) {
    this.refresh();
    if (value.round !== this.epoch) return;
    for (const entry of value.scans) {
      if (!this.addresses.includes(entry.address)) continue;
      const combined = [
        ...new Set([...(this.scans.get(entry.address) ?? []), ...entry.claims]),
      ]
        .sort()
        .slice(0, 2);
      this.scans.set(entry.address, new Set(combined));
    }
  }
  claim() {
    return `${this.identity}/${randomUUID()}`;
  }
  grant(address: string, claim: string) {
    this.refresh();
    if (!this.addresses.includes(address)) return false;
    const claims = this.scans.get(address) ?? new Set<string>();
    if (claims.has(claim)) return true;
    if (claims.size >= 2) return false;
    claims.add(claim);
    this.scans.set(address, claims);
    return true;
  }
  canAttempt(address: string) {
    this.refresh();
    return (
      this.addresses.includes(address) && (this.attempts.get(address) ?? 0) < 2
    );
  }
  begin(address: string) {
    if (!this.canAttempt(address)) return false;
    this.attempts.set(address, (this.attempts.get(address) ?? 0) + 1);
    return true;
  }
  complete(address: string) {
    this.refresh();
    this.completed.add(address);
  }
  status() {
    this.refresh();
    return {
      round: this.epoch,
      attemptedAddresses: this.attempts.size,
      completedAddresses: this.completed.size,
      attempts: [...this.attempts.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
  }
}
