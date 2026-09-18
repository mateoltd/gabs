import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { X509Certificate } from "node:crypto";
import type { LanConfig } from "../../apps/desktop/src/main/lan/transport";
/** Test-only CA and managed device identities. Keys never leave the temporary directory. */
export async function lanFixture(
  workspaceId: string,
  selectedPorts?: readonly [number, number, number],
) {
  const directory = await mkdtemp(join(tmpdir(), "suite-lan-fixture-"));
  const run = (args: string[]) =>
    execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
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
      "/CN=Suite LAN test CA",
    ]);
    await writeFile(
      join(directory, "extensions"),
      "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\n",
    );
    for (const name of ["a", "b", "c"]) {
      run([
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        `${name}.key`,
        "-out",
        `${name}.csr`,
        "-subj",
        `/CN=${name}`,
      ]);
      run([
        "x509",
        "-req",
        "-in",
        `${name}.csr`,
        "-CA",
        "ca.crt",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        `${name}.crt`,
        "-days",
        "1",
        "-extfile",
        "extensions",
      ]);
    }
    const reservations = [createServer(), createServer(), createServer()];
    let ports: readonly [number, number, number];
    try {
      if (selectedPorts) ports = selectedPorts;
      else {
        await Promise.all(
          reservations.map(
            (server) =>
              new Promise<void>((resolve, reject) =>
                server
                  .once("error", reject)
                  .listen(0, "127.0.0.1", () => resolve()),
              ),
          ),
        );
        ports = reservations.map(
          (server) => (server.address() as { port: number }).port,
        ) as [number, number, number];
      }
    } finally {
      await Promise.all(
        reservations.map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    }
    const ca = await readFile(join(directory, "ca.crt"), "utf8");
    const identities = Object.fromEntries(
      await Promise.all(
        ["a", "b", "c"].map(async (name) => {
          const cert = await readFile(join(directory, `${name}.crt`), "utf8");
          return [
            name,
            {
              cert,
              key: await readFile(join(directory, `${name}.key`), "utf8"),
              fingerprint: new X509Certificate(cert).fingerprint256,
            },
          ] as const;
        }),
      ),
    );
    return {
      directory,
      ports,
      identities,
      config(name: string, scope = workspaceId): LanConfig {
        const identity = identities[name];
        return {
          ...identity,
          ca,
          workspaceId: scope,
          allowedPeers: Object.entries(identities)
            .filter(([id]) => id !== name)
            .map(([, identity]) => identity.fingerprint),
          addresses: ["127.0.0.1"],
          ports,
        };
      },
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
