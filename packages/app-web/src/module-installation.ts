import type { FeatureProps } from "@suite/platform";
import {
  changeModuleStorage,
  readModuleStorage,
} from "@suite/platform/module-storage";
import {
  canonical,
  resolveReleases,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import type { PlatformState, SignedArtifact } from "@suite/module-sdk/platform";

export function deviceId() {
  let id = localStorage.getItem("suite-device");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("suite-device", id);
  }
  return id;
}
export async function verifyArtifact(pkg: SignedArtifact, pem: string) {
  const hex = (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const bytes = new TextEncoder().encode(canonical(pkg.artifact));
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== pkg.digest)
    throw Error("Module checksum verification failed.");
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  if (hex(await crypto.subtle.digest("SHA-256", der)) !== pkg.key_id)
    throw Error("Untrusted module signing key.");
  const key = await crypto.subtle.importKey(
    "spki",
    der,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(atob(pkg.signature), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(
        canonical({ manifest: pkg.manifest, digest: pkg.digest }),
      ),
    ))
  )
    throw Error("Module signature verification failed.");
  if (
    pkg.manifest.id !== pkg.module_id ||
    pkg.manifest.version !== pkg.version ||
    pkg.artifact.id !== pkg.module_id ||
    pkg.artifact.version !== pkg.version ||
    pkg.manifest.publisher !== "suite" ||
    pkg.artifact.publisher !== pkg.manifest.publisher
  )
    throw Error("Module identity verification failed.");
}
/** Verified downloads survive interruption. Installed versions switch only after every dependency verifies. */
export async function installModule(
  props: FeatureProps,
  state: PlatformState,
  id: string,
  repair = false,
  active: () => boolean = () => true,
) {
  return navigator.locks.request(
    `suite-install:${props.scope.userId}:${props.scope.workspaceId}`,
    async () => {
      const check = () => {
        if (!active())
          throw new Error(
            "Installation cancelled because the active workspace changed.",
          );
      };
      check();
      const pins = Object.fromEntries(
        state.settings
          .filter((s) => s.key.startsWith("pin:") && s.value.version)
          .map((s) => [s.key.slice(4), String(s.value.version)]),
      );
      const plan = resolveReleases(
        id,
        state.releases.map((r) => r.manifest as unknown as ReleaseManifest),
        "1.0.0",
        "1.0.0",
        pins,
      );
      const trust = await props.client.request({ operation: "moduleTrust" });
      const stored = await readModuleStorage(props.platform, props.scope);
      const packages: SignedArtifact[] = [];
      for (const release of plan) {
        check();
        const cacheKey = `${release.id}@${release.version}`;
        const expected = state.releases.find(
          (r) => r.module_id === release.id && r.version === release.version,
        )!;
        let pkg = repair ? undefined : stored.downloads?.[cacheKey];
        if (pkg?.digest !== expected.digest) pkg = undefined;
        if (pkg) {
          try {
            await verifyArtifact(pkg, trust.publicKey);
          } catch {
            pkg = undefined;
          }
        }
        if (!pkg) {
          pkg = await props.client.request({
            operation: "moduleArtifact",
            params: {
              workspaceId: props.scope.workspaceId,
              moduleId: release.id,
            },
          });
          await verifyArtifact(pkg, trust.publicKey);
          if (pkg.version !== release.version)
            throw Error(
              "The release policy changed during installation. Retry to use the current policy.",
            );
          check();
          const verified = pkg;
          await changeModuleStorage(props.platform, props.scope, (s) => {
            (s.downloads ??= {})[cacheKey] = verified;
          });
        }
        packages.push(pkg);
      }
      check();
      await props.client.request({
        operation: "platformCommand",
        params: { workspaceId: props.scope.workspaceId },
        body: {
          action: "install",
          value: { moduleId: id, deviceId: deviceId() },
        },
        idempotencyKey: crypto.randomUUID(),
      });
      check();
      await changeModuleStorage(props.platform, props.scope, (s) => {
        check();
        for (const pkg of packages)
          s.installed[pkg.module_id] = {
            version: pkg.version,
            artifact: pkg.artifact,
            signed: pkg,
            publicKey: trust.publicKey,
            verifiedAt: Date.now(),
          };
        s.downloads = {};
      });
      return packages.find((p) => p.module_id === id)!;
    },
  );
}
