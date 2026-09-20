import type { LocalUnlockBinding, LocalUnlockProtection } from "@suite/client";

interface ProtectionHost {
  available(): boolean;
  biometricAvailable(): boolean;
  biometric(): Promise<void>;
  encrypt(value: string): Promise<Uint8Array>;
  decrypt(
    value: Uint8Array,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function binding(value: LocalUnlockBinding) {
  if (
    !value ||
    typeof value.profileId !== "string" ||
    !uuid.test(value.profileId) ||
    typeof value.epoch !== "string" ||
    !uuid.test(value.epoch) ||
    (value.kind !== "pin" && value.kind !== "biometric")
  )
    throw Error("Invalid local unlock request.");
}
function payload(
  value: unknown,
  kind: LocalUnlockBinding["kind"],
): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length !== (kind === "pin" ? 48 : 32) ||
    value.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    throw Error("Invalid protected credential.");
}

/** OS protection authenticates purpose and profile; only biometric envelopes prompt and reveal raw keys. */
export class NativeLocalUnlock implements LocalUnlockProtection {
  constructor(private readonly host: ProtectionHost) {}
  async status() {
    const available = this.host.available();
    return {
      available,
      biometric: available && this.host.biometricAvailable(),
    };
  }
  private async authorize(kind: LocalUnlockBinding["kind"]) {
    if (!this.host.available())
      throw Error("Protected storage is unavailable. Use your passphrase.");
    if (kind === "biometric") {
      if (!this.host.biometricAvailable())
        throw Error("Biometric unlock is unavailable. Use your passphrase.");
      await this.host.biometric();
      if (!this.host.available())
        throw Error(
          "Protected storage became unavailable. Use your passphrase.",
        );
    }
  }
  async seal(scope: LocalUnlockBinding, value: number[]) {
    binding(scope);
    payload(value, scope.kind);
    // Capture before yielding; a caller cannot change the approved purpose or bytes.
    const envelope = { version: 1, ...scope, value: [...value] };
    await this.authorize(envelope.kind);
    return Buffer.from(
      await this.host.encrypt(JSON.stringify(envelope)),
    ).toString("base64");
  }
  private async read(scope: LocalUnlockBinding, sealed: string) {
    binding(scope);
    const expected = { ...scope };
    if (
      typeof sealed !== "string" ||
      sealed.length < 1 ||
      sealed.length > 16384 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(sealed)
    )
      throw Error("Invalid protected credential.");
    if (!this.host.available())
      throw Error("Protected storage is unavailable. Use your passphrase.");
    const decrypted = await this.host.decrypt(Buffer.from(sealed, "base64"));
    let stored: {
      version?: unknown;
      profileId?: unknown;
      epoch?: unknown;
      kind?: unknown;
      value?: unknown;
    } | null;
    try {
      stored = JSON.parse(decrypted.result);
    } catch {
      throw Error("Invalid protected credential.");
    }
    if (
      !stored ||
      stored.version !== 1 ||
      stored.profileId !== expected.profileId ||
      stored.epoch !== expected.epoch ||
      stored.kind !== expected.kind
    )
      throw Error(
        "This credential belongs to another profile or unlock method.",
      );
    payload(stored.value, expected.kind);
    return { ...decrypted, value: stored.value, kind: expected.kind };
  }
  async open(scope: LocalUnlockBinding, sealed: string) {
    const stored = await this.read(scope, sealed);
    await this.authorize(stored.kind);
    return stored.value;
  }
  async renew(scope: LocalUnlockBinding, sealed: string) {
    const stored = await this.read(scope, sealed);
    // Renewal returns ciphertext only; it cannot authorize biometric key access.
    await this.authorize("pin");
    if (!stored.shouldReEncrypt) return sealed;
    const renewed = await this.host.encrypt(stored.result);
    await this.authorize("pin");
    return Buffer.from(renewed).toString("base64");
  }
}
