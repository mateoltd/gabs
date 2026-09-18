import { assertSchema } from "@suite/module-sdk";
import {
  ScanBudget,
  assertTopology,
  PingSchema,
  ReservationSchema,
  DiscoveryReplySchema,
  heartbeatInterval,
  rescanInterval,
  peerLimit,
  type Topology,
  type Endpoint,
  type DiscoveryReply,
} from "./discovery";
import { createServer, connect, type Server, type TLSSocket } from "node:tls";
import { createHash, X509Certificate } from "node:crypto";
import { isIP, type Socket } from "node:net";
/** Optional managed-device transport. Certificates and fingerprints come from provisioning. */
export interface LanConfig {
  key: string;
  cert: string;
  ca: string;
  workspaceId: string;
  allowedPeers: readonly string[];
  addresses: readonly string[];
  ports: readonly [number, number, number];
}
export type RelayEnvelope = {
  kind: "artifact" | "pending";
  workspaceId: string;
  id: string;
  payload: string;
  digest: string;
};
const frameLimit = 262144;
export function validateRelayEnvelope(
  value: unknown,
  workspaceId: string,
): asserts value is RelayEnvelope {
  const envelope = value as Partial<RelayEnvelope> | null;
  if (
    !envelope ||
    !["artifact", "pending"].includes(envelope.kind ?? "") ||
    envelope.workspaceId !== workspaceId ||
    typeof envelope.id !== "string" ||
    !envelope.id.length ||
    envelope.id.length > 128 ||
    typeof envelope.payload !== "string" ||
    envelope.payload.length > 200000 ||
    typeof envelope.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(envelope.digest) ||
    createHash("sha256").update(envelope.payload).digest("hex") !==
      envelope.digest ||
    Buffer.byteLength(JSON.stringify(envelope)) + 1 > frameLimit
  )
    throw Error("Invalid relay envelope or workspace.");
}
type Peer = {
  address: string;
  port: number;
  seen: number;
  coordinated: boolean;
};
type Reply = { peer: string; discovery?: DiscoveryReply };
export class LanTransport {
  private server?: Server;
  private timers: ReturnType<typeof setInterval>[] = [];
  private peers = new Map<string, Peer>();
  private sockets = new Set<Socket>();
  private generation = 0;
  private closed = true;
  private lifecycle = Promise.resolve();
  private scanning?: Promise<void>;
  private checking?: Promise<void>;
  private readonly identity: string;
  private readonly budget: ScanBudget;
  private hints = new Map<string, Endpoint>();
  private hintAttempts = new Map<string, number>();
  private controlCount = 0;
  private controlWaiters: (() => void)[] = [];
  constructor(
    private config: LanConfig,
    private receive: (envelope: RelayEnvelope) => Promise<void>,
    private report: (message: string) => void = () => {},
    private changed: () => void = () => {},
  ) {
    this.identity = new X509Certificate(config.cert).fingerprint256;
    this.budget = new ScanBudget([...config.addresses], this.identity);
    if (
      !config.workspaceId ||
      config.workspaceId.length > 128 ||
      config.allowedPeers.length > peerLimit ||
      config.allowedPeers.some(
        (id) => !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(id),
      )
    )
      throw Error(
        "Configure a workspace and at most 256 pinned peer certificates.",
      );
    if (
      config.addresses.length > 254 ||
      config.addresses.some(
        (a) =>
          isIP(a) !== 4 ||
          !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(a),
      )
    )
      throw Error(
        "LAN discovery is limited to a configured private IPv4 subnet.",
      );
    if (
      new Set(config.ports).size !== 3 ||
      config.ports.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)
    )
      throw Error("Configure three distinct unprivileged LAN ports.");
    this.config = {
      ...config,
      addresses: [...new Set(config.addresses)],
      ports: [...config.ports],
      allowedPeers: [...config.allowedPeers],
    };
  }
  start(): Promise<void> {
    const generation = this.generation;
    const task = this.lifecycle.then(() => this.open(generation));
    this.lifecycle = task.catch(() => {});
    return task;
  }
  private async open(generation: number) {
    if (generation !== this.generation)
      throw Error("Local network start was cancelled.");
    if (this.server) return;
    this.closed = false;
    try {
      for (const port of this.config.ports) {
        const server = createServer(
          {
            key: this.config.key,
            cert: this.config.cert,
            ca: this.config.ca,
            requestCert: true,
            rejectUnauthorized: true,
            minVersion: "TLSv1.3",
          },
          (socket) => this.attach(socket, generation),
        );
        server.maxConnections = 32;
        server.on("connection", (socket) => {
          this.track(socket);
          socket.setTimeout(5000, () => socket.destroy());
          if (!this.active(generation)) socket.destroy();
        });
        server.on("tlsClientError", () => {});
        try {
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "0.0.0.0", () => {
              server.removeListener("error", reject);
              resolve();
            });
          });
          if (!this.active(generation)) {
            await this.closeListener(server);
            throw Error("Local network start was cancelled.");
          }
          server.on("error", () =>
            this.report("Local network listener failed."),
          );
          this.server = server;
          this.changed();
          break;
        } catch (error) {
          await this.closeListener(server);
          if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE")
            throw error;
        }
      }
      if (!this.server)
        throw Error("All configured local network ports are occupied.");
      this.timers.push(
        setInterval(
          () =>
            void this.discover().catch(() =>
              this.report("Local network discovery failed."),
            ),
          rescanInterval,
        ),
        setInterval(
          () =>
            void this.heartbeat().catch(() =>
              this.report("Local network heartbeat failed."),
            ),
          heartbeatInterval,
        ),
      );
      await this.discover();
      if (!this.active(generation))
        throw Error("Local network start was cancelled.");
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  private active(generation: number) {
    return !this.closed && generation === this.generation;
  }
  private trusted(socket: TLSSocket): string | undefined {
    const certificate = socket.getPeerCertificate();
    return socket.authorized &&
      certificate.fingerprint256 &&
      this.config.allowedPeers.includes(certificate.fingerprint256)
      ? certificate.fingerprint256
      : undefined;
  }
  private track(socket: Socket) {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
  }
  private attach(socket: TLSSocket, generation: number) {
    this.track(socket);
    const peerId = this.trusted(socket);
    if (!this.active(generation) || !peerId) {
      socket.destroy();
      return;
    }
    socket.setTimeout(5000, () => socket.destroy());
    const chunks: Buffer[] = [];
    let bytes = 0;
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes > frameLimit) {
        socket.destroy();
        return;
      }
      if (!chunk.includes(10)) return;
      socket.pause();
      void (async () => {
        try {
          const frame = Buffer.concat(chunks);
          if (frame.indexOf(10) !== frame.length - 1)
            throw Error("One request per connection is required.");
          const message = JSON.parse(frame.toString("utf8"));
          if (
            !this.active(generation) ||
            message?.workspaceId !== this.config.workspaceId
          )
            throw Error("Workspace is unavailable.");
          let response: unknown = { ok: true };
          if (message.kind === "ping" && message.topology !== undefined) {
            assertSchema(PingSchema, message);
            assertTopology(message.topology);
            this.observe(
              peerId,
              this.address(socket.remoteAddress),
              message.topology.port,
              message.topology,
            );
            response = { ok: true, topology: this.topology() };
          } else if (message.kind === "scan") {
            assertSchema(ReservationSchema, message);
            assertTopology(message.topology);
            if (!message.claim.startsWith(`${peerId}/`))
              throw Error("The reservation belongs to another peer.");
            this.observe(
              peerId,
              this.address(socket.remoteAddress),
              message.topology.port,
              message.topology,
            );
            const coordinator = this.coordinator();
            const granted =
              coordinator === this.identity &&
              message.topology.budget.round === this.budget.snapshot().round &&
              this.budget.grant(message.address, message.claim);
            response = {
              ok: true,
              granted,
              coordinator,
              topology: this.topology(),
            };
          } else if (message.kind !== "ping") {
            validateRelayEnvelope(message, this.config.workspaceId);
            // Transport receipt only. Consumers must independently validate package/business authority.
            await this.receive(message);
          }
          if (!this.active(generation))
            throw Error("Local network is disabled.");
          socket.end(JSON.stringify(response) + "\n");
        } catch {
          socket.end(JSON.stringify({ ok: false }) + "\n");
        }
      })();
    });
  }
  private send(
    address: string,
    port: number,
    message: unknown,
    expectedPeer?: string,
  ): Promise<Reply> {
    const generation = this.generation;
    if (!this.active(generation))
      return Promise.reject(Error("Local network is disabled."));
    return new Promise((resolve, reject) => {
      let peer: string | undefined;
      let settled = false;
      const socket = connect(
        {
          host: address,
          port,
          key: this.config.key,
          cert: this.config.cert,
          ca: this.config.ca,
          rejectUnauthorized: true,
          minVersion: "TLSv1.3",
        },
        () => {
          peer = this.trusted(socket);
          if (
            !this.active(generation) ||
            !peer ||
            (expectedPeer && peer !== expectedPeer)
          ) {
            finish(Error("Peer is not authorized."));
            return;
          }
          socket.write(JSON.stringify(message) + "\n");
        },
      );
      this.track(socket);
      const timer = setTimeout(() => finish(Error("Peer timed out.")), 2500);
      let discovery: DiscoveryReply | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else if (!this.active(generation) || !peer)
          reject(Error("Local network is disabled."));
        else resolve({ peer, discovery });
      };
      const chunks: Buffer[] = [];
      let bytes = 0;
      socket.on("error", (error) => finish(error));
      socket.on("close", () =>
        finish(Error("Peer disconnected before acknowledging the envelope.")),
      );
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes > frameLimit) return finish(Error("Invalid peer response."));
        if (!chunk.includes(10)) return;
        socket.pause();
        try {
          const data = Buffer.concat(chunks);
          if (data.indexOf(10) !== data.length - 1)
            throw Error("Invalid peer response.");
          const response = JSON.parse(data.toString("utf8"));
          if (response?.ok !== true)
            return finish(Error("Peer refused the envelope."));
          if (response.topology !== undefined) {
            assertSchema(DiscoveryReplySchema, response);
            assertTopology(response.topology);
            discovery = response;
          }
          finish();
        } catch {
          finish(Error("Invalid peer response."));
        }
      });
    });
  }
  private address(value?: string) {
    return value?.replace(/^::ffff:/, "") ?? "";
  }
  private topology(): Topology {
    return {
      protocol: 2,
      port: this.status().port!,
      peers: [...this.peers].map(([id, peer]) => ({
        id,
        address: peer.address,
        port: peer.port,
      })),
      budget: this.budget.snapshot(),
    };
  }
  private coordinator() {
    return [
      this.identity,
      ...[...this.peers]
        .filter(([, peer]) => peer.coordinated)
        .map(([id]) => id),
    ].sort()[0];
  }
  private permitted(endpoint: Endpoint) {
    return (
      endpoint.id !== this.identity &&
      this.config.allowedPeers.includes(endpoint.id) &&
      this.config.addresses.includes(endpoint.address) &&
      this.config.ports.includes(endpoint.port)
    );
  }
  private observe(
    id: string,
    address: string,
    port: number,
    topology?: Topology,
  ) {
    if (!this.permitted({ id, address, port })) return;
    const previous = this.peers.get(id);
    this.peers.set(id, {
      address,
      port,
      seen: Date.now(),
      coordinated: !!topology,
    });
    if (!previous || previous.address !== address || previous.port !== port)
      this.changed();
    this.hints.delete(id);
    if (!topology) return;
    this.budget.merge(topology.budget);
    for (const endpoint of topology.peers) {
      if (
        !this.permitted(endpoint) ||
        this.peers.has(endpoint.id) ||
        this.hints.size >= peerLimit
      )
        continue;
      this.hints.set(endpoint.id, endpoint);
    }
  }
  /** Heartbeats, reservations and hint verification share a two-probe bound with scans. */
  private async control(
    address: string,
    port: number,
    message: unknown,
    expectedPeer?: string,
  ) {
    const generation = this.generation;
    if (this.controlCount >= 2)
      await new Promise<void>((resolve) => this.controlWaiters.push(resolve));
    else this.controlCount++;
    try {
      if (!this.active(generation)) throw Error("Local network is disabled.");
      const result = await this.send(address, port, message, expectedPeer);
      if (this.active(generation))
        this.observe(result.peer, address, port, result.discovery?.topology);
      return result;
    } finally {
      const next = this.controlWaiters.shift();
      if (next) next();
      else this.controlCount--;
    }
  }
  private ping() {
    return {
      kind: "ping",
      workspaceId: this.config.workspaceId,
      topology: this.topology(),
    };
  }
  private async verifyHints(generation: number) {
    let remaining = peerLimit;
    while (this.hints.size && remaining-- > 0 && this.active(generation)) {
      const [id, endpoint] = this.hints.entries().next().value!;
      this.hints.delete(id);
      const key = JSON.stringify(endpoint),
        attempted = this.hintAttempts.get(key);
      if (
        this.peers.has(id) ||
        (attempted !== undefined && Date.now() - attempted < heartbeatInterval)
      )
        continue;
      // The map is bounded even when a trusted peer advertises changing endpoints.
      if (this.hintAttempts.size >= peerLimit)
        this.hintAttempts.delete(this.hintAttempts.keys().next().value!);
      this.hintAttempts.set(key, Date.now());
      try {
        await this.control(endpoint.address, endpoint.port, this.ping(), id);
      } catch {}
    }
  }
  private async reserve(address: string, generation: number) {
    if (!this.budget.canAttempt(address)) return false;
    const claim = this.budget.claim();
    for (
      let redirect = 0;
      redirect < 3 && this.active(generation);
      redirect++
    ) {
      const coordinator = this.coordinator();
      if (coordinator === this.identity)
        return this.budget.grant(address, claim) && this.budget.begin(address);
      const peer = this.peers.get(coordinator)!;
      try {
        const result = await this.control(
          peer.address,
          peer.port,
          {
            kind: "scan",
            workspaceId: this.config.workspaceId,
            topology: this.topology(),
            address,
            claim,
          },
          coordinator,
        );
        const reply = result.discovery;
        if (!reply) continue; // observe() already marks legacy peers as uncoordinated.
        if (reply.coordinator !== coordinator) continue;
        if (
          !reply.granted ||
          reply.topology.budget.round !== this.budget.snapshot().round ||
          !reply.topology.budget.scans.some(
            (entry) =>
              entry.address === address && entry.claims.includes(claim),
          )
        )
          return false;
        return this.budget.begin(address);
      } catch {
        if (this.peers.get(coordinator) === peer) this.forget(coordinator);
      }
    }
    return false;
  }
  discover(): Promise<void> {
    if (this.scanning) return this.scanning;
    const generation = this.generation;
    if (!this.active(generation) || !this.server) return Promise.resolve();
    const task = (async () => {
      await this.verifyHints(generation);
      const addresses = [...this.config.addresses];
      const worker = async () => {
        for (
          let address = addresses.shift();
          address && this.active(generation);
          address = addresses.shift()
        ) {
          if (!(await this.reserve(address, generation))) continue;
          for (const port of this.config.ports) {
            if (!this.active(generation)) break;
            try {
              await this.control(address, port, this.ping());
            } catch {}
          }
          if (this.active(generation)) this.budget.complete(address);
        }
      };
      await Promise.all([worker(), worker()]);
      await this.verifyHints(generation);
    })();
    this.scanning = task;
    void task.then(
      () => {
        if (this.scanning === task) this.scanning = undefined;
      },
      () => {
        if (this.scanning === task) this.scanning = undefined;
      },
    );
    return task;
  }
  heartbeat(): Promise<void> {
    if (this.checking) return this.checking;
    const generation = this.generation;
    if (!this.active(generation)) return Promise.resolve();
    const task = (async () => {
      const peers = [...this.peers];
      const worker = async () => {
        for (
          let entry = peers.shift();
          entry && this.active(generation);
          entry = peers.shift()
        ) {
          const [id, peer] = entry;
          try {
            await this.control(peer.address, peer.port, this.ping(), id);
          } catch {
            if (this.peers.get(id) === peer) this.forget(id);
          }
        }
      };
      await Promise.all([worker(), worker()]);
      await this.verifyHints(generation);
    })();
    this.checking = task;
    void task.then(
      () => {
        if (this.checking === task) this.checking = undefined;
      },
      () => {
        if (this.checking === task) this.checking = undefined;
      },
    );
    return task;
  }
  private forget(id: string) {
    if (this.peers.delete(id)) this.changed();
  }
  async relay(peerId: string, envelope: RelayEnvelope) {
    validateRelayEnvelope(envelope, this.config.workspaceId);
    const peer = this.peers.get(peerId);
    if (!peer || this.closed) throw Error("Peer or workspace is unavailable.");
    await this.send(peer.address, peer.port, envelope, peerId);
  }
  status() {
    return {
      enabled: !this.closed && !!this.server,
      peers: [...this.peers].map(([id, { address, port, seen }]) => ({
        id,
        address,
        port,
        seen,
      })),
      discovery: {
        ...this.budget.status(),
        coordinator: this.coordinator(),
        coordinatedPeers: [...this.peers.values()].filter(
          (peer) => peer.coordinated,
        ).length,
      },
      port: (this.server?.address() as { port?: number } | null)?.port,
    };
  }
  stop(): Promise<void> {
    this.closed = true;
    this.generation++;
    // Reconnection probes known endpoints without resetting the consumed subnet budget.
    // They remain hints until a fresh workspace-bound, pinned TLS exchange succeeds.
    this.hints.clear();
    for (const [id, peer] of this.peers)
      this.hints.set(id, { id, address: peer.address, port: peer.port });
    this.peers.clear();
    this.hintAttempts.clear();
    this.changed();
    for (const socket of this.sockets) socket.destroy();
    const task = this.lifecycle.then(() => this.close());
    this.lifecycle = task.catch(() => {});
    return task;
  }
  private closeListener(server: Server) {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }
  private async close() {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = undefined;
    if (server) await this.closeListener(server);
    await Promise.all([this.scanning, this.checking]);
    this.peers.clear();
  }
}
