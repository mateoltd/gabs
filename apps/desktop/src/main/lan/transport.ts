import { createServer, connect, type Server, type TLSSocket } from "node:tls";
import { createHash } from "node:crypto";
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
type Peer = { address: string; port: number; seen: number };
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
  constructor(
    private config: LanConfig,
    private receive: (envelope: RelayEnvelope) => Promise<void>,
    private report: (message: string) => void = () => {},
  ) {
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
          600000,
        ),
        setInterval(
          () =>
            void this.heartbeat().catch(() =>
              this.report("Local network heartbeat failed."),
            ),
          60000,
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
    if (!this.active(generation) || !this.trusted(socket)) {
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
          if (message.kind !== "ping") {
            validateRelayEnvelope(message, this.config.workspaceId);
            // Transport receipt only. Consumers must independently validate package/business authority.
            await this.receive(message);
          }
          if (!this.active(generation))
            throw Error("Local network is disabled.");
          socket.end(JSON.stringify({ ok: true }) + "\n");
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
  ): Promise<string> {
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
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else if (!this.active(generation) || !peer)
          reject(Error("Local network is disabled."));
        else resolve(peer);
      };
      let data = "";
      socket.on("error", (error) => finish(error));
      socket.on("close", () =>
        finish(Error("Peer disconnected before acknowledging the envelope.")),
      );
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.length > 1000) {
          finish(Error("Invalid peer response."));
          return;
        }
        if (data.includes("\n")) {
          try {
            if (JSON.parse(data).ok === true) finish();
            else finish(Error("Peer refused the envelope."));
          } catch {
            finish(Error("Invalid peer response."));
          }
        }
      });
    });
  }
  discover(): Promise<void> {
    if (this.scanning) return this.scanning;
    const generation = this.generation;
    if (!this.active(generation) || !this.server) return Promise.resolve();
    const addresses = [...this.config.addresses];
    const worker = async () => {
      for (
        let address = addresses.shift();
        address && this.active(generation);
        address = addresses.shift()
      ) {
        for (const port of this.config.ports) {
          if (!this.active(generation)) break;
          try {
            const peer = await this.send(address, port, {
              kind: "ping",
              workspaceId: this.config.workspaceId,
            });
            if (this.active(generation))
              this.peers.set(peer, { address, port, seen: Date.now() });
            // A provisioned address can host more than one managed peer on the fallback ports.
          } catch {}
        }
      }
    };
    const task = Promise.all([worker(), worker()]).then(() => {});
    this.scanning = task;
    void task.finally(() => {
      if (this.scanning === task) this.scanning = undefined;
    });
    return task;
  }
  heartbeat(): Promise<void> {
    if (this.checking) return this.checking;
    const generation = this.generation;
    if (!this.active(generation)) return Promise.resolve();
    const task = (async () => {
      for (const [id, peer] of this.peers) {
        if (!this.active(generation)) break;
        try {
          await this.send(
            peer.address,
            peer.port,
            { kind: "ping", workspaceId: this.config.workspaceId },
            id,
          );
          if (this.active(generation) && this.peers.get(id) === peer)
            peer.seen = Date.now();
        } catch {
          if (this.peers.get(id) === peer) this.peers.delete(id);
        }
      }
    })();
    this.checking = task;
    void task.finally(() => {
      if (this.checking === task) this.checking = undefined;
    });
    return task;
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
      peers: [...this.peers].map(([id, peer]) => ({ id, ...peer })),
      port: (this.server?.address() as { port?: number } | null)?.port,
    };
  }
  stop(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.peers.clear();
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
