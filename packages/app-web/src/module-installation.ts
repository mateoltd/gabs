import { validateClientArtifacts } from "@suite/module-sdk/client-artifact";
import { ApiError } from "@suite/api-client";
import type { FeatureProps } from "@suite/platform";
import {
  changeModuleStorage,
  readModuleStorage,
  type InstallationAttempt,
  type ModuleStorage,
} from "@suite/platform/module-storage";
import {
  canonical,
  resolveReleases,
  storageCompatibleReleases,
  satisfies,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import type {
  InstallationSelection,
  PlatformState,
  SignedArtifact,
} from "@suite/module-sdk/platform";

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
  validateClientArtifacts(pkg.artifact);
}
const lifecycleLock = (props: FeatureProps) =>
  `suite-install:${props.scope.userId}:${props.scope.workspaceId}`;
const sameReleases = (a: InstallationSelection[], b: InstallationSelection[]) =>
  canonical([...a].sort((x, y) => x.moduleId.localeCompare(y.moduleId))) ===
  canonical([...b].sort((x, y) => x.moduleId.localeCompare(y.moduleId)));
async function recordFailure(
  props: FeatureProps,
  id: string,
  attempt: InstallationAttempt,
  error: unknown,
) {
  await changeModuleStorage(props.platform, props.scope, (s) => {
    if (s.lifecycle?.[id]?.requestId !== attempt.requestId) return;
    const message =
      error instanceof Error
        ? error.message
        : "The installation could not finish.";
    (s.lifecycleErrors ??= {})[id] = message;
    // A definite rejection cannot later commit. Transport failures retain the exact request.
    if (
      error instanceof ApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 429].includes(error.status)
    )
      delete s.lifecycle[id];
    else s.lifecycle[id].error = message;
  });
}
async function acknowledge(
  props: FeatureProps,
  id: string,
  attempt: InstallationAttempt,
) {
  const response = await props.client.request({
    operation: "platformCommand",
    params: { workspaceId: props.scope.workspaceId },
    body: {
      action: attempt.action,
      value: {
        moduleId: id,
        deviceId: attempt.deviceId,
        ...(attempt.action === "install" ? { releases: attempt.releases } : {}),
      },
    },
    idempotencyKey: attempt.requestId,
  });
  const receipt = response.installation;
  if (
    !receipt ||
    receipt.action !== attempt.action ||
    receipt.moduleId !== id ||
    receipt.deviceId !== attempt.deviceId ||
    !sameReleases(receipt.releases, attempt.releases)
  )
    throw Error(
      "The server returned a different installation receipt. Refresh and retry before opening this release.",
    );
  return receipt;
}
/** One durable request survives crashes, lost responses and local commit failures. */
export async function installModule(
  props: FeatureProps,
  state: PlatformState,
  id: string,
  repair = false,
  active: () => boolean = () => true,
) {
  return navigator.locks.request(lifecycleLock(props), async () => {
    const check = () => {
      if (!active())
        throw Error(
          "Installation paused before completion. Resume it in Modules.",
        );
    };
    check();
    // A queued caller may have waited behind another install, removal or pin change.
    state = await props.client.request({
      operation: "platformState",
      params: { workspaceId: props.scope.workspaceId },
    });
    const existing = await readModuleStorage(props.platform, props.scope);
    if (!repair && !existing.lifecycle?.[id]) {
      try {
        const verified = await verifiedInstalledModule(
          props,
          existing,
          id,
          state,
        );
        if (verified) return verified;
      } catch {
        /* The verified download path repairs corrupt local bytes. */
      }
    }
    const pins = Object.fromEntries(
      state.settings
        .filter((s) => s.key.startsWith("pin:") && s.value.version)
        .map((s) => [s.key.slice(4), String(s.value.version)]),
    );
    const plan = resolveReleases(
      id,
      storageCompatibleReleases(
        state.releases.map((r) => r.manifest as unknown as ReleaseManifest),
        new Map(
          (state.storage ?? []).map((s) => [s.module_id, s.schema_version]),
        ),
        pins,
      ),
      "1.0.0",
      "1.0.0",
      pins,
    );
    for (const release of plan) {
      const selected = state.modules.find((m) => m.id === release.id);
      if (selected?.version !== release.version)
        throw Error(
          `This release requires ${release.id}@${release.version}, but the workspace selects ${selected?.version ?? "no release"}. Ask an administrator to choose compatible version pins.`,
        );
    }
    const releases = plan.map((r) => ({
      moduleId: r.id,
      version: r.version,
      digest: state.releases.find(
        (p) => p.module_id === r.id && p.version === r.version,
      )!.digest,
    }));
    let stored = await readModuleStorage(props.platform, props.scope);
    let attempt = stored.lifecycle?.[id];
    if (attempt?.action === "uninstall")
      throw Error(
        "A removal is awaiting confirmation. Resume it in Modules before installing again.",
      );
    if (attempt && !sameReleases(attempt.releases, releases)) {
      // Settle an uncertain earlier request before replacing its identity.
      if (attempt.phase === "confirming") {
        try {
          await acknowledge(props, id, attempt);
        } catch (error) {
          await recordFailure(props, id, attempt, error);
          if (!(
            error instanceof ApiError &&
            ["INSTALLATION_POLICY_CHANGED", "INSTALLATION_SUPERSEDED"].includes(
              error.code,
            )
          ))
            throw error;
        }
      }
      attempt = undefined;
    }
    if (!attempt) {
      attempt = {
        action: "install",
        requestId: crypto.randomUUID(),
        deviceId: deviceId(),
        releases,
        startedAt: Date.now(),
        phase: "downloading",
      };
      const created = attempt;
      stored = await changeModuleStorage(props.platform, props.scope, (s) => {
        (s.lifecycle ??= {})[id] = created;
        delete s.lifecycleErrors?.[id];
        if (repair)
          for (const r of releases)
            delete s.downloads?.[`${r.moduleId}@${r.version}`];
      });
    }
    const current = attempt;
    try {
      const trust = await props.client.request({ operation: "moduleTrust" });
      const packages: SignedArtifact[] = [];
      for (const release of releases) {
        check();
        const cacheKey = `${release.moduleId}@${release.version}`;
        let pkg = stored.downloads?.[cacheKey];
        if (pkg?.digest !== release.digest) pkg = undefined;
        if (pkg)
          try {
            await verifyArtifact(pkg, trust.publicKey);
          } catch {
            pkg = undefined;
          }
        if (!pkg) {
          pkg = await props.client.request({
            operation: "moduleArtifact",
            params: {
              workspaceId: props.scope.workspaceId,
              moduleId: release.moduleId,
            },
          });
          await verifyArtifact(pkg, trust.publicKey);
          if (
            pkg.module_id !== release.moduleId ||
            pkg.version !== release.version ||
            pkg.digest !== release.digest
          )
            throw new ApiError(
              409,
              "INSTALLATION_POLICY_CHANGED",
              "The release policy changed during download. Refresh available releases and retry.",
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
      await changeModuleStorage(props.platform, props.scope, (s) => {
        s.lifecycle![id].phase = "confirming";
      });
      const receipt = await acknowledge(props, id, current);
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
        for (const release of receipt.releases)
          delete s.downloads?.[`${release.moduleId}@${release.version}`];
        delete s.lifecycle?.[id];
        delete s.lifecycleErrors?.[id];
      });
      return {
        pkg: packages.find((p) => p.module_id === id)!,
        publicKey: trust.publicKey,
      };
    } catch (error) {
      try {
        await recordFailure(props, id, current, error);
      } catch {
        /* A storage failure must not hide the original failed commit. */
      }
      throw error;
    }
  });
}
export async function uninstallModule(
  props: FeatureProps,
  id: string,
  resumeRequestId?: string,
) {
  return navigator.locks.request(lifecycleLock(props), async () => {
    let attempt = (await readModuleStorage(props.platform, props.scope))
      .lifecycle?.[id];
    // A queued Resume click must not create a new removal after background recovery finished.
    if (resumeRequestId && attempt?.requestId !== resumeRequestId) return;
    if (attempt?.action === "install" && attempt.phase === "confirming") {
      try {
        await acknowledge(props, id, attempt);
      } catch (error) {
        await recordFailure(props, id, attempt, error);
        if (!(
          error instanceof ApiError &&
          ["INSTALLATION_SUPERSEDED", "INSTALLATION_POLICY_CHANGED"].includes(
            error.code,
          )
        ))
          throw error;
      }
    }
    if (attempt?.action !== "uninstall") {
      attempt = {
        action: "uninstall",
        requestId: crypto.randomUUID(),
        deviceId: deviceId(),
        releases: [],
        startedAt: Date.now(),
        phase: "confirming",
      };
      const created = attempt;
      await changeModuleStorage(props.platform, props.scope, (s) => {
        (s.lifecycle ??= {})[id] = created;
        delete s.lifecycleErrors?.[id];
      });
    }
    const current = attempt;
    try {
      await acknowledge(props, id, current);
      await changeModuleStorage(props.platform, props.scope, (s) => {
        delete s.installed[id];
        for (const key of Object.keys(s.downloads ?? {}))
          if (key.startsWith(`${id}@`)) delete s.downloads![key];
        delete s.lifecycle?.[id];
        delete s.lifecycleErrors?.[id];
      });
    } catch (error) {
      try {
        await recordFailure(props, id, current, error);
      } catch {
        /* Keep the original error. */
      }
      throw error;
    }
  });
}
/** Verify every dependency, including offline activation and local removal intent. */
export async function verifiedInstalledModule(
  props: FeatureProps,
  storage: ModuleStorage,
  id: string,
  state?: PlatformState,
) {
  const visited = new Set<string>();
  const visit = async (moduleId: string): Promise<boolean> => {
    if (visited.has(moduleId)) return true;
    visited.add(moduleId);
    const activation = props.bootstrap.modules.find(
      (m) => m.moduleId === moduleId,
    );
    const installed = storage.installed[moduleId];
    if (
      !activation?.entitled ||
      !activation.assigned ||
      activation.state !== "enabled" ||
      storage.lifecycle?.[moduleId]?.action === "uninstall" ||
      !installed?.signed ||
      !installed.publicKey ||
      installed.version !== installed.signed.version
    )
      return false;
    if (
      state &&
      (!state.installations.some(
        (r) =>
          r.module_id === moduleId &&
          r.device_id === deviceId() &&
          r.version === installed.version &&
          r.state === "installed",
      ) ||
        state.modules.find((m) => m.id === moduleId)?.version !==
          installed.version)
    )
      return false;
    await verifyArtifact(installed.signed, installed.publicKey);
    const manifest = installed.signed.manifest as unknown as ReleaseManifest;
    for (const [dependency, range] of Object.entries(manifest.dependencies)) {
      const version = storage.installed[dependency]?.version;
      if (!version || !satisfies(version, range) || !(await visit(dependency)))
        return false;
    }
    return true;
  };
  return (await visit(id))
    ? {
        pkg: storage.installed[id].signed!,
        publicKey: storage.installed[id].publicKey!,
      }
    : false;
}
