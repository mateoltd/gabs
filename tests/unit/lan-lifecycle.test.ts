import { it, expect, vi } from "vitest";
import { connect as tcpConnect, type Socket } from "node:net";
import { connect as tlsConnect, createServer as tlsServer } from "node:tls";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import {
  LanTransport,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
import { ManagedLanSession } from "../../apps/desktop/src/main/lan/session";
import type { Bootstrap } from "../../packages/contracts/src";
import { lanFixture } from "../support/lan-fixture";
const envelope = (
  workspaceId: string,
  id: string = crypto.randomUUID(),
  payload = "Pending only",
): RelayEnvelope => ({
  workspaceId,
  id,
  payload,
  kind: "pending",
  digest: createHash("sha256").update(payload).digest("hex"),
});
it("cancels overlapping discovery and incomplete TLS connections, then restarts without leaked listeners", async () => {
  const fixture = await lanFixture(randomUUID());
  const a = new LanTransport(fixture.config("a"), async () => {});
  const b = new LanTransport(fixture.config("b"), async () => {});
  let stalled: Socket | undefined;
  try {
    await a.start();
    await b.start();
    await a.discover();
    expect(a.status().peers).toHaveLength(1);
    expect(a.status().peers[0].id).toBe(fixture.identities.b.fingerprint);
    stalled = tcpConnect({ host: "127.0.0.1", port: a.status().port! });
    await once(stalled, "connect");
    const errors: string[] = [];
    stalled.on("error", (error: NodeJS.ErrnoException) =>
      errors.push(error.code ?? "unknown"),
    );
    const closed = new Promise<void>((resolve) =>
      stalled!.once("close", () => resolve()),
    );
    const scan = a.discover();
    expect(a.discover()).toBe(scan);
    await a.stop();
    await scan;
    await closed;
    expect(errors.every((code) => code === "ECONNRESET")).toBe(true);
    expect(a.status()).toMatchObject({ enabled: false, peers: [] });
    await a.start();
    expect(a.status().port).toBe(fixture.ports[0]);
    expect(a.status().peers).toHaveLength(1);
    const stopped = a.stop();
    const restart = a.start();
    await stopped;
    await restart;
    expect(a.status().enabled).toBe(true);
    const first = a.stop();
    const cancelled = a.start();
    const last = a.stop();
    await expect(cancelled).rejects.toThrow(/cancelled/);
    await first;
    await last;
    expect(a.status().enabled).toBe(false);
  } finally {
    stalled?.destroy();
    await a.stop();
    await b.stop();
    await fixture.close();
  }
});
it("uses the third port, removes failed peers on heartbeat and rediscovers them on the scheduled rescan", async () => {
  const fixture = await lanFixture(randomUUID());
  const a = new LanTransport(fixture.config("a"), async () => {});
  const b = new LanTransport(fixture.config("b"), async () => {});
  const c = new LanTransport(fixture.config("c"), async () => {});
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  try {
    await a.start();
    await b.start();
    await c.start();
    await a.discover();
    expect(c.status().port).toBe(fixture.ports[2]);
    expect(a.status().peers).toHaveLength(2);
    await b.stop();
    await vi.advanceTimersByTimeAsync(60000);
    await a.heartbeat();
    expect(a.status().peers.map((p) => p.id)).toEqual([
      fixture.identities.c.fingerprint,
    ]);
    await b.start();
    await vi.advanceTimersByTimeAsync(540000);
    await a.discover();
    expect(
      a
        .status()
        .peers.map((p) => p.id)
        .sort(),
    ).toEqual(
      [
        fixture.identities.b.fingerprint,
        fixture.identities.c.fingerprint,
      ].sort(),
    );
  } finally {
    await a.stop();
    await b.stop();
    await c.stop();
    vi.useRealTimers();
    await fixture.close();
  }
});
it("reassembles fragmented UTF-8 and rejects corrupt, foreign and changed-identity relay traffic", async () => {
  const workspace = randomUUID();
  const fixture = await lanFixture(workspace);
  const received: RelayEnvelope[] = [];
  const a = new LanTransport(fixture.config("a"), async (value) => {
    received.push(value);
  });
  const b = new LanTransport(fixture.config("b"), async () => {});
  let c: LanTransport | undefined;
  try {
    await a.start();
    await b.start();
    await b.discover();
    const config = fixture.config("b");
    const socket = tlsConnect({
      host: "127.0.0.1",
      port: a.status().port!,
      key: config.key,
      cert: config.cert,
      ca: config.ca,
      minVersion: "TLSv1.3",
      rejectUnauthorized: true,
    });
    await once(socket, "secureConnect");
    const packet = envelope(workspace, "unicode", "Málaga 🚚 中文");
    const encoded = Buffer.from(JSON.stringify(packet) + "\n");
    const split = encoded.indexOf(Buffer.from("🚚")) + 1;
    const ack = once(socket, "data");
    socket.write(encoded.subarray(0, split));
    await new Promise((resolve) => setTimeout(resolve, 5));
    socket.write(encoded.subarray(split));
    expect(JSON.parse((await ack)[0].toString())).toEqual({ ok: true });
    socket.destroy();
    expect(received).toEqual([packet]);
    const peer = b
      .status()
      .peers.find((p) => p.id === fixture.identities.a.fingerprint)!;
    await expect(
      b.relay(peer.id, { ...packet, workspaceId: randomUUID() }),
    ).rejects.toThrow(/workspace/);
    await expect(
      b.relay(peer.id, { ...packet, digest: "0".repeat(64) }),
    ).rejects.toThrow(/envelope/);
    await a.stop();
    c = new LanTransport(fixture.config("c"), async (value) => {
      received.push(value);
    });
    await c.start();
    expect(c.status().port).toBe(peer.port);
    await expect(b.relay(peer.id, envelope(workspace))).rejects.toThrow(
      /authorized/,
    );
    expect(received).toHaveLength(1);
  } finally {
    await a.stop();
    await b.stop();
    await c?.stop();
    await fixture.close();
  }
});
it("scopes session authority, cancels late enables, serializes quarantine and revokes on fresh policy", async () => {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const fixture = await lanFixture(scope.workspaceId);
  let user: string | undefined = scope.userId;
  const policy: Bootstrap = {
    workspace: {
      id: scope.workspaceId,
      name: "LAN company",
      kind: "company",
      currency: "EUR",
    },
    permissions: ["modules.manage"],
    roleNames: ["Owner"],
    modules: [],
    offlineHours: 24,
    authorizedAt: new Date().toISOString(),
    policyRevision: "1",
    seatLimit: 1,
    memberCount: 1,
  };
  let authorize = async () => policy;
  let inbox: RelayEnvelope[] = [];
  const session = new ManagedLanSession({
    currentUser: () => user,
    authorize: () => authorize(),
    configure: async () => fixture.config("a"),
    readInbox: async () => structuredClone(inbox),
    writeInbox: async (_scope, value) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      inbox = structuredClone(value);
    },
  });
  const peer = new LanTransport(fixture.config("b"), async () => {});
  try {
    let release!: (value: Bootstrap) => void;
    authorize = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const delayed = session.enable(scope);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const stopping = session.stop();
    release(policy);
    await expect(delayed).rejects.toThrow(/authorization changed/);
    await stopping;
    expect(session.status(scope).enabled).toBe(false);
    authorize = async () => policy;
    await peer.start();
    await session.enable(scope);
    await peer.discover();
    const recipient = peer
      .status()
      .peers.find((p) => p.id === fixture.identities.a.fingerprint)!;
    expect(session.status({ ...scope, workspaceId: randomUUID() })).toEqual({
      enabled: false,
      peers: [],
    });
    const packets = Array.from({ length: 8 }, () =>
      envelope(scope.workspaceId),
    );
    await Promise.all(
      packets.map((packet) => peer.relay(recipient.id, packet)),
    );
    expect(new Set(inbox.map((item) => item.id)).size).toBe(8);
    await peer.relay(recipient.id, packets[0]);
    expect(inbox).toHaveLength(8);
    for (let index = 0; index < 2; index++)
      await peer.relay(recipient.id, envelope(scope.workspaceId));
    const overflow = envelope(scope.workspaceId);
    await expect(peer.relay(recipient.id, overflow)).rejects.toThrow(/refused/);
    expect(inbox).toHaveLength(10);
    await session.dismiss(scope, packets[1].id, packets[1].digest);
    await session.restore(scope, packets[1], () => {});
    await session.restore(scope, packets[1], () => {});
    expect(inbox).toHaveLength(10);
    await expect(session.restore(scope, overflow, () => {})).rejects.toThrow(
      /full/,
    );
    await expect(
      peer.relay(
        recipient.id,
        envelope(scope.workspaceId, packets[0].id, "Changed"),
      ),
    ).rejects.toThrow(/refused/);
    session.observe(scope, { ...policy, policyRevision: "2", offlineHours: 0 });
    session.observe(scope, policy);
    expect(session.status(scope).enabled).toBe(false);
    await session.stop();
    await expect(
      peer.relay(recipient.id, envelope(scope.workspaceId)),
    ).rejects.toThrow();
    expect(inbox).toHaveLength(10);
    await expect(session.enable(scope)).rejects.toThrow(/offline lease/);
    authorize = async () => ({ ...policy, policyRevision: "3" });
    await session.enable(scope);
    user = undefined;
    expect(session.status(scope).enabled).toBe(false);
    await expect(
      session.relay(
        scope,
        recipient.id,
        envelope(scope.workspaceId),
        async () => {},
      ),
    ).rejects.toThrow(/profile/);
  } finally {
    await session.stop();
    await peer.stop();
    await fixture.close();
  }
});

it("expires an administrator lease while authenticated peer discovery is still waiting", async () => {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const fixture = await lanFixture(scope.workspaceId);
  const sockets = new Set<Socket>();
  // A correctly provisioned but unresponsive peer holds the discovery request open.
  const peer = tlsServer(
    { ...fixture.config("b"), requestCert: true, rejectUnauthorized: true },
    () => {},
  );
  peer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  peer.on("tlsClientError", () => {});
  const session = new ManagedLanSession({
    currentUser: () => scope.userId,
    authorize: async () => ({
      workspace: {
        id: scope.workspaceId,
        name: "Expiring company",
        kind: "company",
        currency: "EUR",
      },
      permissions: ["modules.manage"],
      roleNames: [],
      modules: [],
      offlineHours: 1,
      authorizedAt: new Date(Date.now() - 3600000 + 400).toISOString(),
      policyRevision: "1",
      seatLimit: 1,
      memberCount: 1,
    }),
    configure: async () => fixture.config("a"),
    readInbox: async () => [],
    writeInbox: async () => {},
  });
  try {
    await new Promise<void>((resolve, reject) =>
      peer.once("error", reject).listen(fixture.ports[0], "127.0.0.1", resolve),
    );
    await expect(session.enable(scope)).rejects.toThrow(
      /cancelled|authorization changed/,
    );
    expect(session.status(scope)).toEqual({ enabled: false, peers: [] });
  } finally {
    await session.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
    await fixture.close();
  }
});

it("uses employee relay grants, limits receipts to their module and stops on authority loss", async () => {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const fixture = await lanFixture(scope.workspaceId);
  const grant = {
    moduleId: "notes",
    moduleVersion: "1.0.0",
    capability: "relay",
  };
  let authorized = true;
  let checks = 0;
  let inbox: RelayEnvelope[] = [];
  const session = new ManagedLanSession({
    currentUser: () => scope.userId,
    authorize: async () => {
      throw Error("No administrator permission");
    },
    authorizeModule: async (_scope, selected) => {
      expect(selected).toEqual(grant);
      checks++;
      if (!authorized) throw Error("Module grant revoked");
      return Date.now() + 60000;
    },
    configure: async () => fixture.config("a"),
    readInbox: async () => structuredClone(inbox),
    writeInbox: async (_scope, value) => {
      inbox = structuredClone(value);
    },
  });
  const peer = new LanTransport(fixture.config("b"), async () => {});
  const packet = (moduleId: string) =>
    envelope(
      scope.workspaceId,
      randomUUID(),
      JSON.stringify({ call: { moduleId } }),
    );
  try {
    await expect(session.enable(scope)).rejects.toThrow(/administrator/);
    await peer.start();
    await session.enable(scope, grant);
    await peer.discover();
    const recipient = fixture.identities.a.fingerprint;
    await peer.relay(recipient, packet("notes"));
    expect(inbox).toHaveLength(1);
    await expect(peer.relay(recipient, packet("foreign"))).rejects.toThrow(
      /refused/,
    );
    expect(inbox).toHaveLength(1);
    expect(checks).toBeGreaterThanOrEqual(4);
    authorized = false;
    await expect(session.refresh(scope)).rejects.toThrow(/revoked/);
    expect(session.status(scope).enabled).toBe(false);
    await expect(session.enable(scope, grant)).rejects.toThrow(/revoked/);
    expect(inbox).toHaveLength(1);
  } finally {
    await session.stop();
    await peer.stop();
    await fixture.close();
  }
});

it("does not bind a listener when module authority expires during certificate loading", async () => {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const fixture = await lanFixture(scope.workspaceId);
  const now = Date.now();
  let changes = 0;
  const session = new ManagedLanSession({
    currentUser: () => scope.userId,
    authorize: async () => {
      throw Error("No administrator permission");
    },
    authorizeModule: async () => now + 1000,
    configure: async () => {
      vi.spyOn(Date, "now").mockReturnValue(now + 2000);
      return fixture.config("a");
    },
    changed: () => {
      changes++;
    },
    readInbox: async () => [],
    writeInbox: async () => {},
  });
  try {
    await expect(
      session.enable(scope, {
        moduleId: "notes",
        moduleVersion: "1.0.0",
        capability: "relay",
      }),
    ).rejects.toThrow(/expired during configuration/);
    expect(changes).toBe(0);
    expect(session.status(scope).enabled).toBe(false);
  } finally {
    vi.restoreAllMocks();
    await session.stop();
    await fixture.close();
  }
});
