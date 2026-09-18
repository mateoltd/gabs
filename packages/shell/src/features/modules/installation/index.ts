import { verifyArtifact } from "@suite/module-sdk/verification";
export { verifyArtifact } from "@suite/module-sdk/verification";
import { reportInstallation } from "../../administration/installation-reporting";
export { flushInstallationReports } from "../../administration/installation-reporting";
import { supportsStorage } from "@suite/module-sdk";
import {
  assertClientHost,
  assertManifestHost,
} from "@suite/module-sdk/client-artifact";
import { viewHost } from "../views/view-host";
import { ApiError } from "@suite/client/api";
import type { FeatureProps } from "@suite/client";
import {
  changeModuleStorage,
  readModuleStorage,
  type InstallationAttempt,
  type ModuleStorage,
} from "@suite/client/module-storage";
import {
  canonical,
  resolveReleases,
  storageCompatibleReleases,
  satisfies,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import type {
  InstallationReport,
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
const lifecycleLock = (props: FeatureProps) =>
  `suite-install:${props.scope.userId}:${props.scope.workspaceId}`;
class InstallationPausedError extends Error {}
const isHostMismatch = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "code" in error &&
  error.code === "HOST_VIEW_INCOMPATIBLE";
const sameReleases = (a: InstallationSelection[], b: InstallationSelection[]) =>
  canonical([...a].sort((x, y) => x.moduleId.localeCompare(y.moduleId))) ===
  canonical([...b].sort((x, y) => x.moduleId.localeCompare(y.moduleId)));
async function recordFailure(
  props: FeatureProps,
  id: string,
  attempt: InstallationAttempt,
  error: unknown,
  failureCode: InstallationReport["errorCode"] = "unknown",
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
      isHostMismatch(error) ||
      (error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status))
    )
      delete s.lifecycle[id];
    else {
      const pending = s.lifecycle[id];
      pending.error = message;
      // Ordinary catalog invalidation must not immediately restart a failed download.
      // Canceled effects can resume immediately; explicit user retries bypass this delay.
      if (!(error instanceof InstallationPausedError)) {
        const failures = Math.min((pending.retry?.failures ?? 0) + 1, 20);
        pending.retry = {
          failures,
          nextAttemptAt:
            Date.now() + Math.min(30_000 * 2 ** (failures - 1), 300_000),
        };
      }
    }
  });
  await reportInstallation(
    props,
    id,
    attempt,
    "failed",
    isHostMismatch(error) ||
      (error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status))
      ? "policy"
      : failureCode,
  );
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
  intent: "explicit" | "background" = "explicit",
) {
  return navigator.locks.request(lifecycleLock(props), async () => {
    const check = () => {
      if (!active())
        throw new InstallationPausedError(
          "Installation paused before completion. Resume it in Modules.",
        );
    };
    check();
    const existing = await readModuleStorage(props.platform, props.scope);
    if (
      intent === "background" &&
      (existing.lifecycle?.[id]?.retry?.nextAttemptAt ?? 0) > Date.now()
    )
      return false;
    // A queued caller may have waited behind another install, removal or pin change.
    const preflightFailure = async (
      errorCode: InstallationReport["errorCode"],
    ) => {
      try {
        const previous = (await readModuleStorage(props.platform, props.scope))
          .installationReports?.[id]?.report;
        const retry =
          previous?.action === "install" &&
          !previous.version &&
          previous.phase === "failed" &&
          previous.errorCode === errorCode;
        await reportInstallation(
          props,
          id,
          {
            action: "install",
            requestId: retry ? previous.attemptId : crypto.randomUUID(),
            deviceId: deviceId(),
            releases: [],
            startedAt: Date.now(),
            phase: "downloading",
          },
          "failed",
          errorCode,
        );
      } catch {
        // Preserve the original preflight error if local reporting is unavailable.
      }
    };
    try {
      state = await props.client.request({
        operation: "platformState",
        params: { workspaceId: props.scope.workspaceId },
      });
    } catch (error) {
      await preflightFailure(
        error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![408, 429].includes(error.status)
          ? "policy"
          : "connection",
      );
      throw error;
    }
    // A background caller may have queued before a user's removal. Recheck
    // the server's current device intent while holding the lifecycle lock.
    if (
      intent === "background" &&
      state.installations.some(
        (i) =>
          i.module_id === id &&
          i.device_id === deviceId() &&
          i.state === "removed",
      ) &&
      existing.lifecycle?.[id]?.action !== "install"
    )
      return false;
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
    let plan: ReleaseManifest[];
    try {
      const pins = Object.fromEntries(
        state.settings
          .filter((s) => s.key.startsWith("pin:") && s.value.version)
          .map((s) => [s.key.slice(4), String(s.value.version)]),
      );
      plan = resolveReleases(
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
        assertManifestHost(release, viewHost.capabilities);
        const selected = state.modules.find((m) => m.id === release.id);
        if (selected?.version !== release.version)
          throw Error(
            `This release requires ${release.id}@${release.version}, but the workspace selects ${selected?.version ?? "no release"}. Ask an administrator to choose compatible version pins.`,
          );
      }
    } catch (error) {
      // No executable change exists yet. Report the failed plan without inventing a release.
      await preflightFailure("policy");
      throw error;
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
    let failureCode: InstallationReport["errorCode"] = "download";
    try {
      await reportInstallation(props, id, current, current.phase);
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
          failureCode = "download";
          const received =
            props.platform.kind === "desktop"
              ? await window.suiteDesktop?.receivedPackage(props.scope, release)
              : undefined;
          check();
          pkg =
            received?.pkg ??
            (await props.client.request({
              operation: "moduleArtifact",
              params: {
                workspaceId: props.scope.workspaceId,
                moduleId: release.moduleId,
              },
            }));
          failureCode = "verification";
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
          failureCode = "storage";
          await changeModuleStorage(props.platform, props.scope, (s) => {
            (s.downloads ??= {})[cacheKey] = verified;
          });
          check();
          if (received) {
            // Only retire the transport cache after the normal installer owns durable bytes.
            // Cleanup failure cannot invalidate a verified download or its server receipt.
            await window
              .suiteDesktop!.acknowledgePackage(
                props.scope,
                received.transferId,
              )
              .catch(() => {});
          }
        }
        failureCode = "policy";
        assertClientHost(pkg.artifact, viewHost.capabilities);
        packages.push(pkg);
      }
      check();
      failureCode = "storage";
      await changeModuleStorage(props.platform, props.scope, (s) => {
        s.lifecycle![id].phase = "confirming";
      });
      await reportInstallation(props, id, current, "confirming");
      failureCode = "connection";
      const receipt = await acknowledge(props, id, current);
      failureCode = "storage";
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
      await reportInstallation(
        props,
        id,
        current,
        "ready",
        undefined,
        receipt.id,
      );
      return {
        pkg: packages.find((p) => p.module_id === id)!,
        publicKey: trust.publicKey,
      };
    } catch (error) {
      try {
        await recordFailure(props, id, current, error, failureCode);
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
  intent: "explicit" | "background" = "explicit",
) {
  return navigator.locks.request(lifecycleLock(props), async () => {
    const stored = await readModuleStorage(props.platform, props.scope);
    let attempt = stored.lifecycle?.[id];
    if (
      intent === "background" &&
      (attempt?.retry?.nextAttemptAt ?? 0) > Date.now()
    )
      return false;
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
        reportVersion: stored.installed[id]?.version,
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
    let failureCode: InstallationReport["errorCode"] = "connection";
    try {
      await reportInstallation(props, id, current, "confirming");
      const receipt = await acknowledge(props, id, current);
      failureCode = "storage";
      await changeModuleStorage(props.platform, props.scope, (s) => {
        delete s.installed[id];
        for (const key of Object.keys(s.downloads ?? {}))
          if (key.startsWith(`${id}@`)) delete s.downloads![key];
        delete s.lifecycle?.[id];
        delete s.lifecycleErrors?.[id];
      });
      await reportInstallation(
        props,
        id,
        current,
        "removed",
        undefined,
        receipt.id,
      );
    } catch (error) {
      try {
        await recordFailure(props, id, current, error, failureCode);
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
    const selected = state?.modules.find((m) => m.id === moduleId)?.version;
    const policy = state?.settings.find(
      (s) => s.key === `pin:${moduleId}`,
    )?.value;
    const accepted =
      selected === installed.version ||
      (policy?.mandatory === false &&
        Array.isArray(policy.acceptedVersions) &&
        policy.acceptedVersions.includes(installed.version));
    if (
      state &&
      (!state.installations.some(
        (r) =>
          r.module_id === moduleId &&
          r.device_id === deviceId() &&
          r.version === installed.version &&
          r.state === "installed",
      ) ||
        !accepted ||
        !supportsStorage(
          installed.signed.manifest as unknown as ReleaseManifest,
          state.storage?.find((s) => s.module_id === moduleId)
            ?.schema_version ?? 1,
        ))
    )
      return false;
    await verifyArtifact(installed.signed, installed.publicKey);
    assertClientHost(installed.signed.artifact, viewHost.capabilities);
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
