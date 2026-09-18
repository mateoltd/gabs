import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createHash } from "node:crypto";
import {
  LanTransport,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
describe("Managed local transport", () => {
  it("uses mutual TLS, falls back to a second port, and only relays matching-workspace envelopes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "suite-lan-"));
    const run = (args: string[]) =>
      execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
    let first: LanTransport | undefined, second: LanTransport | undefined;
    try {
      run([
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "ca.key",
        "-out",
        "ca.crt",
        "-days",
        "1",
        "-subj",
        "/CN=Suite test CA",
      ]);
      await writeFile(
        join(dir, "extensions"),
        "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\n",
      );
      for (const name of ["a", "b"]) {
        run([
          "req",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          name + ".key",
          "-out",
          name + ".csr",
          "-subj",
          "/CN=" + name,
        ]);
        run([
          "x509",
          "-req",
          "-in",
          name + ".csr",
          "-CA",
          "ca.crt",
          "-CAkey",
          "ca.key",
          "-CAcreateserial",
          "-out",
          name + ".crt",
          "-days",
          "1",
          "-extfile",
          "extensions",
        ]);
      }
      const ca = await readFile(join(dir, "ca.crt"), "utf8"),
        a = await readFile(join(dir, "a.crt"), "utf8"),
        b = await readFile(join(dir, "b.crt"), "utf8");
      const messages: RelayEnvelope[] = [];
      const ports = [50280, 50281, 50282] as const;
      first = new LanTransport(
        {
          cert: a,
          key: await readFile(join(dir, "a.key"), "utf8"),
          ca,
          workspaceId: "test-workspace",
          allowedPeers: [new X509Certificate(b).fingerprint256],
          addresses: ["127.0.0.1"],
          ports,
        },
        async () => {},
      );
      second = new LanTransport(
        {
          cert: b,
          key: await readFile(join(dir, "b.key"), "utf8"),
          ca,
          workspaceId: "test-workspace",
          allowedPeers: [new X509Certificate(a).fingerprint256],
          addresses: ["127.0.0.1"],
          ports,
        },
        async (e) => {
          messages.push(e);
        },
      );
      await first.start();
      await second.start();
      await first.discover();
      expect(first.status().port).toBe(ports[0]);
      expect(second.status().port).toBe(ports[1]);
      const peer = first.status().peers.find((peer) => peer.port === ports[1]);
      expect(peer).toMatchObject({ address: "127.0.0.1", port: ports[1] });
      const payload = JSON.stringify({
        operation: "draft",
        data: "pending only",
      });
      await first.relay(peer!.id, {
        kind: "pending",
        workspaceId: "test-workspace",
        id: "message-1",
        payload,
        digest: createHash("sha256").update(payload).digest("hex"),
      });
      expect(messages).toHaveLength(1);
      await expect(
        first.relay(peer!.id, {
          kind: "pending",
          workspaceId: "foreign",
          id: "message-2",
          payload,
          digest: "",
        }),
      ).rejects.toThrow();
      expect(messages).toHaveLength(1);
    } finally {
      await first?.stop();
      await second?.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);
});
