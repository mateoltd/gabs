/** Narrow native protection for standalone credentials, separate from corporate identity. */
export interface LocalUnlockBinding {
  profileId: string;
  epoch: string;
  kind: "pin" | "biometric";
}
export interface LocalUnlockProtection {
  status(): Promise<{ available: boolean; biometric: boolean }>;
  seal(binding: LocalUnlockBinding, bytes: number[]): Promise<string>;
  open(binding: LocalUnlockBinding, sealed: string): Promise<number[]>;
  /** Rewraps the same bound credential without releasing its plaintext. */
  renew(binding: LocalUnlockBinding, sealed: string): Promise<string>;
}

export interface LocalUnlockCredential {
  version: 1;
  epoch: string;
  salt: Uint8Array;
  iv: Uint8Array;
  pin:
    | { kind: "browser"; wrapped: ArrayBuffer }
    | { kind: "native"; sealed: string };
  biometric?: string;
  failures: number;
  retryAt: number;
}
export interface LocalUnlockStatus {
  enabled: boolean;
  biometric: boolean;
  available: boolean;
  biometricAvailable: boolean;
  retryAt: number;
}

export interface LocalVault {
  id: string;
  name: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
  revision?: number;
  removedAt?: number;
  unlock?: LocalUnlockCredential;
  /** Must be cleared atomically with recovery safeguards before an unlocked grant is issued. */
  recoveryRequired?: true;
}

/** Atomic updates run synchronously against the latest stored revision. */
export interface LocalVaultStore {
  get(id: string): Promise<LocalVault | undefined>;
  list(): Promise<LocalVault[]>;
  add(vault: LocalVault): Promise<void>;
  update(
    id: string,
    change: (stored: LocalVault | undefined) => LocalVault,
  ): Promise<LocalVault>;
  exclusive<T>(id: string, run: () => Promise<T>): Promise<T>;
  changed(id: string): void;
}
