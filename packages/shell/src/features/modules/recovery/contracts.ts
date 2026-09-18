import type { ModuleStorage } from "@suite/client/module-storage";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { verifyArtifact } from "@suite/module-sdk/verification";

/** Only downloaded, signed contracts can describe recovery while disconnected. */
export async function offlineRecoveryContracts(state: ModuleStorage) {
  const modules: ModuleDefinition[] = [];
  const failures: Error[] = [];
  const ids = new Set([
    ...Object.keys(state.installed),
    ...Object.keys(state.recoveryVersions ?? {}),
  ]);
  for (const id of ids) {
    const installed = state.installed[id];
    const version = installed?.version ?? state.recoveryVersions?.[id];
    const contract = installed
      ? installed
      : state.responseContracts?.[`${id}@${version}`];
    try {
      if (!contract?.signed || !contract.publicKey) {
        if (
          state.journal.some(
            (entry) => entry.call.moduleId === id && !entry.supersededBy,
          )
        )
          throw Error("The saved recovery contract is missing.");
        continue;
      }
      if (
        contract.signed.module_id !== id ||
        contract.signed.version !== version
      )
        throw Error(
          "The saved recovery contract belongs to a different release.",
        );
      await verifyArtifact(contract.signed, contract.publicKey);
      modules.push(hydrateModule(moduleContract(contract.signed.artifact)));
    } catch {
      failures.push(
        Error(
          `The signed recovery contract for ${id} could not be verified. Connect to restore current module information.`,
        ),
      );
    }
  }
  return { modules, failures };
}
