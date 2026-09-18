import type { FeatureProps } from "@suite/client";
import { synchronizeWorkspace as synchronizeClientWorkspace } from "@suite/client/module-synchronization";
import { verifiedInstalledModule } from "../installation";
import { canReadSavedWork } from "../recovery/access";

/** Bind client synchronization to the shell's current access and installed-host policy. */
export function synchronizeWorkspace(
  current: () => FeatureProps | undefined,
  signal?: AbortSignal,
) {
  return synchronizeClientWorkspace(
    {
      current,
      canSynchronize: (props) => canReadSavedWork(props, true),
      verifyInstalledModule: async (props, storage, moduleId, state) => {
        const verified = await verifiedInstalledModule(
          props,
          storage,
          moduleId,
          state,
        );
        return verified ? { signature: verified.pkg.signature } : false;
      },
    },
    signal,
  );
}
