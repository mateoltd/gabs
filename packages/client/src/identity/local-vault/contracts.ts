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
