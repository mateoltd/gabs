/** Portable state exposed by a profile-lock adapter. */
export interface ProfileLockStatus {
  revision: number;
  userId?: string;
  enabled: boolean;
  locked: boolean;
  available: boolean;
  biometric: boolean;
  biometricAvailable: boolean;
  retryAt: number;
  canRecover: boolean;
  recoveryExpiresAt: number;
  error?: string;
}

/** Shared UI contract; each platform adapter owns persistence and credential handling. */
export interface ProfileLockBridge {
  profileLockStatus(): Promise<ProfileLockStatus>;
  onProfileLock(callback: (status: ProfileLockStatus) => void): () => void;
  lockProfile(): Promise<void>;
  unlockProfile(method: "pin" | "biometric", pin?: string): Promise<void>;
  configureProfileLock(
    pin: string,
    biometric: boolean,
    previousPin?: string,
  ): Promise<void>;
  removeProfileLock(pin?: string, recover?: boolean): Promise<void>;
}
