import type { FeatureProps } from "@suite/client";
import { canDispatchQueuedCall } from "@suite/client/module-dispatch";
import { responseContract } from "@suite/client/module-response";
import type { ModuleStorage } from "@suite/client/module-storage";
import {
  hydrateModule,
  type ModuleCall,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { verifiedInstalledModule } from "../installation";
import type { ReleaseManifest } from "@suite/module-sdk/registry";

export const continuationKey = (call: ModuleCall) =>
  JSON.stringify([
    call.moduleId,
    call.moduleVersion,
    call.action,
    call.operation,
    call.resource,
  ]);

export interface ContinuationAccess {
  original: ModuleDefinition;
  installed: ModuleDefinition;
  releases: {
    id: string;
    version: string;
    signature: string;
    publicKey: string;
  }[];
}

/** Verify the actual installed graph before exposing another module's saved input. */
export async function prepareContinuation(
  props: FeatureProps,
  storage: ModuleStorage,
  call: ModuleCall,
): Promise<ContinuationAccess | undefined> {
  const verified = await verifiedInstalledModule(props, storage, call.moduleId);
  if (!verified) return;
  const original = await responseContract(storage, call);
  const releases: ContinuationAccess["releases"] = [];
  const visit = (id: string) => {
    if (releases.some((release) => release.id === id)) return;
    const installed = storage.installed[id];
    releases.push({
      id,
      version: installed.version,
      signature: installed.signed!.signature,
      publicKey: installed.publicKey!,
    });
    for (const dependency of Object.keys(
      (installed.signed!.manifest as unknown as ReleaseManifest).dependencies,
    ))
      visit(dependency);
  };
  visit(call.moduleId);
  return {
    original: original.module,
    installed: hydrateModule(
      verified.pkg.artifact as unknown as ModuleDefinition,
    ),
    releases,
  };
}

/** Transaction callers supply current storage so removal or updates invalidate a stale review. */
export function canContinue(
  props: FeatureProps,
  call: ModuleCall,
  access: ContinuationAccess | undefined,
  storage?: ModuleStorage,
) {
  return !!(
    access &&
    access.releases.every((release) => {
      const installed = storage?.installed[release.id];
      return (
        props.bootstrap.modules.some(
          (module) =>
            module.moduleId === release.id &&
            module.state === "enabled" &&
            module.entitled &&
            module.assigned,
        ) &&
        (!storage ||
          (installed?.version === release.version &&
            installed.signed?.signature === release.signature &&
            installed.publicKey === release.publicKey &&
            storage.lifecycle?.[release.id]?.action !== "uninstall"))
      );
    }) &&
    canDispatchQueuedCall(
      call,
      access.installed,
      access.original,
      (permission) => props.bootstrap.permissions.includes(permission),
    )
  );
}
