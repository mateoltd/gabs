import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { connect, createServer, type TLSSocket } from "node:tls";
import { once } from "node:events";
import {
  ScanBudget,
  assertTopology,
  rescanInterval,
  type Topology,
} from "../../apps/desktop/src/main/lan/discovery";
import { LanTransport } from "../../apps/desktop/src/main/lan/transport";
import { lanFixture } from "../support/lan-fixture";

const address = "127.0.0.1";
const identity = (byte: string) => Array(32).fill(byte).join(":");
it("converges saturated reservations without resetting work on stale, future or rollback clocks", () => {
  let now = rescanInterval * 10;
  const a = new ScanBudget([address], identity("AA"), () => now);
  const b = new ScanBudget([address], identity("BB"), () => now);
  const first = a.claim(),
    second = b.claim();
  expect(a.grant(address, first)).toBe(true);
  expect(a.grant(address, first)).toBe(true);
  b.merge(a.snapshot());
  expect(b.grant(address, second)).toBe(true);
  a.merge(b.snapshot());
  expect(a.grant(address, a.claim())).toBe(false);
  expect(a.begin(address)).toBe(true);
  expect(a.begin(address)).toBe(true);
  expect(a.begin(address)).toBe(false);
  expect(a.begin("192.168.1.100")).toBe(false);
  for (const round of [9, 11, Number.MAX_SAFE_INTEGER])
    a.merge({ round, scans: [] });
  now -= rescanInterval;
  expect(a.status().round).toBe(10);
  expect(a.canAttempt(address)).toBe(false);
  now += rescanInterval * 2;
  expect(a.canAttempt(address)).toBe(true);
  expect(a.snapshot().scans).toEqual([]);
});
it("merges partition budgets monotonically and bounds each device without claiming global consensus", () => {
  const budgets = ["AA", "BB", "CC"].map(
    (id) => new ScanBudget([address], identity(id), () => 1),
  );
  for (const budget of budgets)
    for (let i = 0; i < 2; i++) {
      expect(budget.grant(address, budget.claim())).toBe(true);
      expect(budget.begin(address)).toBe(true);
    }
  const snapshots = budgets.map((b) => b.snapshot());
  for (const budget of budgets)
    for (const snapshot of snapshots) budget.merge(snapshot);
  expect(budgets[0].snapshot()).toEqual(budgets[1].snapshot());
  expect(budgets[1].snapshot()).toEqual(budgets[2].snapshot());
  for (const budget of budgets) {
    expect(budget.grant(address, budget.claim())).toBe(false);
    expect(budget.begin(address)).toBe(false);
    expect(budget.status().attempts).toBe(2);
  }
});
it("rejects duplicate, oversized and malformed discovery tables", () => {
  const endpoint = { id: identity("AA"), address, port: 49180 };
  const valid: Topology = {
    protocol: 2,
    port: 49180,
    peers: [endpoint],
    budget: { round: 1, scans: [] },
  };
  expect(() => assertTopology(valid)).not.toThrow();
  for (const invalid of [
    { ...valid, peers: [endpoint, endpoint] },
    { ...valid, peers: Array(257).fill(endpoint) },
    { ...valid, peers: [{ ...endpoint, id: "unprovisioned" }] },
    { ...valid, budget: { round: 1, scans: [{ address, claims: [] }] } },
    {
      ...valid,
      budget: {
        round: 1,
        scans: Array(255).fill({
          address,
          claims: [`${endpoint.id}/${randomUUID()}`],
        }),
      },
    },
    { ...valid, injected: true },
  ])
    expect(() => assertTopology(invalid)).toThrow();
});

it("exchanges hints over real TLS and verifies pins before advertising learned peers", async () => {
  const workspace = randomUUID();
  const fixture = await lanFixture(workspace);
  const a = new LanTransport(fixture.config("a"), async () => {});
  const sockets = new Set<TLSSocket>();
  const cConfig = fixture.config("c");
  const budget = new ScanBudget([address], fixture.identities.b.fingerprint);
  const topology = (peers: Topology["peers"]): Topology => ({
    protocol: 2,
    port: fixture.ports[1],
    peers,
    budget: budget.snapshot(),
  });
  let probes = 0;
  const c = createServer(
    { ...cConfig, requestCert: true, rejectUnauthorized: true },
    (socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
      socket.on("data", () => {
        probes++;
        socket.end(
          JSON.stringify({
            ok: true,
            topology: { ...topology([]), port: fixture.ports[2] },
          }) + "\n",
        );
      });
    },
  );
  c.on("tlsClientError", () => {});
  const exchange = async (message: unknown) => {
    const socket = connect({
      ...fixture.config("b"),
      host: address,
      port: a.status().port!,
      rejectUnauthorized: true,
    });
    socket.on("error", () => {});
    try {
      await once(socket, "secureConnect");
      const reply = once(socket, "data");
      socket.write(JSON.stringify(message) + "\n");
      return JSON.parse((await reply)[0].toString());
    } finally {
      socket.destroy();
    }
  };
  try {
    await a.start();
    await a.discover(); // Exhaust the independent subnet allowance before learning c.
    expect(a.status().discovery.attempts).toBe(2);
    await new Promise<void>((resolve) =>
      c.listen(fixture.ports[2], address, resolve),
    );
    const endpoint = {
      id: fixture.identities.c.fingerprint,
      address,
      port: fixture.ports[2],
    };
    for (const rejectedHint of [
      { ...endpoint, id: identity("AA") },
      { ...endpoint, address: "192.168.1.77" },
      { ...endpoint, port: 65535 },
      { ...endpoint, port: a.status().port! }, // Allowed endpoint, wrong pinned identity.
    ]) {
      expect(
        (
          await exchange({
            kind: "ping",
            workspaceId: workspace,
            topology: topology([rejectedHint]),
          })
        ).ok,
      ).toBe(true);
      await a.discover();
      expect(a.status().peers.map((p) => p.id)).not.toContain(endpoint.id);
      expect(probes).toBe(0);
    }
    const reply = await exchange({
      kind: "ping",
      workspaceId: workspace,
      topology: topology([endpoint]),
    });
    expect(reply.ok).toBe(true);
    expect(a.status().peers.map((p) => p.id)).not.toContain(endpoint.id);
    await a.discover();
    expect(probes).toBe(1);
    expect(a.status().discovery.attempts).toBe(2);
    expect(a.status().peers.map((p) => p.id)).toContain(endpoint.id);
    const invalid = await exchange({
      kind: "ping",
      workspaceId: randomUUID(),
      topology: topology([]),
    });
    expect(invalid).toEqual({ ok: false });
    const spoofed = await exchange({
      kind: "scan",
      workspaceId: workspace,
      topology: topology([]),
      address,
      claim: `${fixture.identities.c.fingerprint}/${randomUUID()}`,
    });
    expect(spoofed).toEqual({ ok: false });
  } finally {
    await a.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => c.close(() => resolve()));
    await fixture.close();
  }
});

it("bounds connected rescans across an elected coordinator and survives leader loss", async () => {
  const fixture = await lanFixture(randomUUID());
  const peers = ["a", "b", "c"].map((name) => ({
    name,
    transport: new LanTransport(fixture.config(name), async () => {}),
  }));
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    for (const peer of peers) await peer.transport.start();
    for (const peer of peers) await peer.transport.heartbeat();
    const coordinator = Object.values(fixture.identities)
      .map((i) => i.fingerprint)
      .sort()[0];
    for (const peer of peers) {
      expect(peer.transport.status().peers).toHaveLength(2);
      expect(peer.transport.status().discovery.coordinator).toBe(coordinator);
    }
    vi.setSystemTime(Date.now() + rescanInterval);
    await Promise.all(peers.map((p) => p.transport.discover()));
    expect(
      peers.reduce(
        (total, p) => total + p.transport.status().discovery.attempts,
        0,
      ),
    ).toBe(2);
    const leader = peers.find(
      (p) => fixture.identities[p.name].fingerprint === coordinator,
    )!;
    await leader.transport.stop();
    const survivors = peers.filter((p) => p !== leader);
    for (const peer of survivors) await peer.transport.heartbeat();
    const before = survivors.map(
      (p) => p.transport.status().discovery.attempts,
    );
    await Promise.all(survivors.map((p) => p.transport.discover()));
    expect(
      survivors.map((p) => p.transport.status().discovery.attempts),
    ).toEqual(before);
    expect(survivors[0].transport.status().discovery.coordinator).toBe(
      survivors[1].transport.status().discovery.coordinator,
    );
    vi.setSystemTime(Date.now() + rescanInterval);
    await Promise.all(survivors.map((p) => p.transport.discover()));
    expect(
      survivors.reduce(
        (total, p) => total + p.transport.status().discovery.attempts,
        0,
      ),
    ).toBe(2);
  } finally {
    for (const peer of peers) await peer.transport.stop();
    vi.useRealTimers();
    await fixture.close();
  }
});
