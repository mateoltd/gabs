import type { Bootstrap } from "@suite/contracts";
import type { LanModuleGrant } from "@suite/client";
import type { ModuleDefinition } from "@suite/module-sdk";
import type { PendingRelay } from "@suite/module-sdk/relay";
type Call = PendingRelay["call"];

/** Main-owned authority for one receipt action. Never supplied through renderer IPC. */
export interface RecoveryAccess {
  administrative: boolean;
  online: boolean;
  allows(call: Call): Promise<boolean>;
  check(): Promise<void>;
}
interface Host {
  online: boolean;
  policy: Bootstrap;
  current(): void;
  refreshPolicy(): Promise<Bootstrap>;
  loadModule(id: string): Promise<ModuleDefinition>;
  verifyGrant(module: ModuleDefinition, grant: LanModuleGrant): Promise<void>;
}
/** Share verified contracts within one bounded read/action, never across policy contexts. */
export function createRecoveryAccess(host: Host): RecoveryAccess {
  let policy = host.policy;
  const administrative =
    host.online && policy.permissions.includes("modules.manage");
  const permitted = (module: ModuleDefinition, call: Call) => {
    const required = [module.id, ...Object.keys(module.dependencies ?? {})];
    const view = module.navigation?.view
      ? module.views?.[module.navigation.view]
      : undefined;
    if (
      required.some(
        (id) =>
          !policy.modules.some(
            (item) =>
              item.moduleId === id &&
              item.state === "enabled" &&
              item.assigned &&
              item.entitled,
          ),
      ) ||
      (view && !policy.permissions.includes(view.permission))
    )
      return false;
    if (call.action === "operation") {
      const operation =
        call.operation && Object.hasOwn(module.operations, call.operation)
          ? module.operations[call.operation]
          : undefined;
      return (
        !call.resource &&
        !!operation &&
        operation.policy === "queued" &&
        operation.kind !== "query" &&
        policy.permissions.includes(operation.permission)
      );
    }
    return (
      !call.operation &&
      !!call.resource &&
      Object.hasOwn(module.resources, call.resource) &&
      policy.permissions.includes(`${module.id}.${call.resource}.read`)
    );
  };
  const loaded = new Map<string, Promise<ModuleDefinition>>();
  const used = new Map<
    string,
    { module: ModuleDefinition; grant: LanModuleGrant; calls: Call[] }
  >();
  return {
    administrative,
    online: host.online,
    allows: async (call) => {
      host.current();
      if (administrative) return true;
      if (
        !policy.modules.some(
          (item) =>
            item.moduleId === call.moduleId &&
            item.state === "enabled" &&
            item.assigned &&
            item.entitled,
        )
      )
        return false;
      try {
        let loading = loaded.get(call.moduleId);
        if (!loading) {
          loading = host.loadModule(call.moduleId);
          loaded.set(call.moduleId, loading);
        }
        const module = await loading;
        host.current();
        if (!permitted(module, call)) return false;
        const known = used.get(module.id);
        if (known) {
          known.calls.push(call);
          return true;
        }
        for (const [capability, declaration] of Object.entries(
          module.capabilities ?? {},
        )) {
          if (
            declaration.kind !== "lan.relay" ||
            !policy.permissions.includes(declaration.permission) ||
            (!host.online && declaration.offline !== "lease")
          )
            continue;
          const grant = {
            moduleId: module.id,
            moduleVersion: module.version,
            capability,
          };
          try {
            await host.verifyGrant(module, grant);
          } catch {
            host.current();
            continue;
          }
          host.current();
          used.set(module.id, { module, grant, calls: [call] });
          return true;
        }
        return false;
      } catch {
        host.current();
        return false;
      }
    },
    check: async () => {
      host.current();
      policy = await host.refreshPolicy();
      host.current();
      if (administrative && !policy.permissions.includes("modules.manage"))
        throw Error("Workspace administration access was revoked.");
      for (const { module, grant, calls } of used.values()) {
        const declaration = module.capabilities?.[grant.capability];
        if (
          !declaration ||
          declaration.kind !== "lan.relay" ||
          !policy.permissions.includes(declaration.permission) ||
          calls.some((call) => !permitted(module, call))
        )
          throw Error(
            "Current module permissions do not allow this receipt action.",
          );
        await host.verifyGrant(module, grant);
      }
      host.current();
    },
  };
}
