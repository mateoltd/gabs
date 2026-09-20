import { createVaultEngine } from "./engine";
import { browserVaultStore } from "./store";
export { subscribeLocalProfiles, type LocalVault } from "./store";
export const {
  assertVaultRevision,
  listLocalProfiles,
  listRemovedLocalProfiles,
  removeLocalProfile,
  createVault,
  unlockVault,
  restoreVault,
  commitVault,
} = createVaultEngine(browserVaultStore);
