import { createServer, connect, type Server, type TLSSocket } from "node:tls";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
/** Optional managed-device transport. Certificates and allowed fingerprints come from deployment provisioning. */
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
export class LanTransport {
  private server?: Server;
  private timers: ReturnType<typeof setInterval>[] = [];
  private peers = new Map<
    string,
    { address: string; port: number; seen: number }
  >();
  private scanned = new Map<string, number>();
  private closed = false;
  private scanning = false;
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
      config.ports.some((p) => p < 1024 || p > 65535)
    )
      throw Error("Configure three distinct unprivileged LAN ports.");
  }
  async start() {
    this.closed = false;
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
        (socket) => this.attach(socket),
      );
      server.maxConnections = 32;
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, "0.0.0.0", () => {
            server.removeListener("error", reject);
            resolve();
          });
        });
        server.on("tlsClientError", () => {});
        server.on("error", () => this.report("Local network listener failed."));
        this.server = server;
        break;
      } catch (error) {
        server.close();
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }
    if (!this.server)
      throw Error("All configured local network ports are occupied.");
    this.timers.push(
      setInterval(() => void this.discover(), 600000),
      setInterval(() => void this.heartbeat(), 60000),
    );
    await this.discover();
  }
  private trusted(socket: TLSSocket) {
    const cert = socket.getPeerCertificate();
    return (
      socket.authorized &&
      !!cert.fingerprint256 &&
      this.config.allowedPeers.includes(cert.fingerprint256)
    );
  }
  private attach(socket: TLSSocket) {
    if (!this.trusted(socket)) {
      socket.destroy();
      return;
    }
    socket.setTimeout(5000, () => socket.destroy());
    let input = "";
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 262144) {
        socket.destroy();
        return;
      }
      const end = input.indexOf("\n");
      if (end < 0) return;
      socket.pause();
      void (async () => {
        try {
          const message = JSON.parse(input.slice(0, end)) as
            RelayEnvelope | { kind: "ping"; workspaceId: string };
          if (message.workspaceId !== this.config.workspaceId)
            throw Error("Workspace mismatch.");
          if (message.kind !== "ping") {
            if (
              !["artifact", "pending"].includes(message.kind) ||
              typeof message.id !== "string" ||
              message.id.length > 128 ||
              typeof message.payload !== "string" ||
              message.payload.length > 200000
            )
              throw Error("Invalid relay envelope.");
            const digest = createHash("sha256")
              .update(message.payload)
              .digest("hex");
            if (digest !== message.digest)
              throw Error("Relay checksum mismatch.");
            // Receipt is transport-only. Pending envelopes still require server authorization and acceptance.
            await this.receive(message);
          }
          socket.end(JSON.stringify({ ok: true }) + "\n");
        } catch {
          socket.end(JSON.stringify({ ok: false }) + "\n");
        }
      })();
    });
  }
  private send(address: string, port: number, message: unknown) {
    return new Promise<void>((resolve, reject) => {
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
          if (!this.trusted(socket)) {
            socket.destroy();
            reject(Error("Peer is not authorized."));
            return;
          }
          socket.write(JSON.stringify(message) + "\n");
        },
      );
      let data = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(Error("Peer timed out."));
      }, 2500);
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.length > 1000) {
          socket.destroy();
          clearTimeout(timer);
          reject(Error("Invalid peer response."));
        } else if (data.includes("\n")) {
          clearTimeout(timer);
          socket.end();
          try {
            if (JSON.parse(data).ok) resolve();
            else reject(Error("Peer refused the envelope."));
          } catch {
            reject(Error("Invalid peer response."));
          }
        }
      });
    });
  }
  async discover() {
    if (this.scanning) return;
    this.scanning = true;
    this.scanned.clear();
    const addresses = [...this.config.addresses];
    const worker = async () => {
      for (
        let address = addresses.shift();
        address && !this.closed;
        address = addresses.shift()
      ) {
        if ((this.scanned.get(address) ?? 0) >= 2) continue;
        this.scanned.set(address, (this.scanned.get(address) ?? 0) + 1);
        for (const port of this.config.ports) {
          try {
            await this.send(address, port, {
              kind: "ping",
              workspaceId: this.config.workspaceId,
            });
            this.peers.set(address, { address, port, seen: Date.now() });
            break;
          } catch {}
        }
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      this.scanning = false;
    }
  }
  async heartbeat() {
    for (const [id, peer] of this.peers) {
      try {
        await this.send(peer.address, peer.port, {
          kind: "ping",
          workspaceId: this.config.workspaceId,
        });
        peer.seen = Date.now();
      } catch {
        this.peers.delete(id);
      }
    }
  }
  async relay(peerId: string, envelope: RelayEnvelope) {
    const peer = this.peers.get(peerId);
    if (!peer || envelope.workspaceId !== this.config.workspaceId)
      throw Error("Peer or workspace is unavailable.");
    await this.send(peer.address, peer.port, envelope);
  }
  status() {
    return {
      enabled: !!this.server,
      peers: [...this.peers].map(([id, peer]) => ({ id, ...peer })),
      port: (this.server?.address() as { port?: number } | null)?.port,
    };
  }
  async stop() {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.peers.clear();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
  }
}
