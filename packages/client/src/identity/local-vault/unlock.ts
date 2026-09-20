import { createQuickUnlockEngine } from "./quick-unlock";
import { browserVaultStore } from "./store";
export type {
  LocalUnlockBinding,
  LocalUnlockProtection,
  LocalUnlockStatus,
} from "./contracts";
export const { localUnlockStatus, configureLocalUnlock, unlockLocalVault } =
  createQuickUnlockEngine(browserVaultStore);
