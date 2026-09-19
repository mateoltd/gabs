import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ProfileLockStatus } from "@suite/client/profile-lock";

interface Policy {
  version: 1;
  salt: string;
  digest: string;
  biometric: boolean;
  failures: number;
  retryAt: number;
}
function policy(value: unknown): Policy | undefined {
  if (value === undefined) return;
  const p = value as Policy;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.salt !== "string" ||
    !/^[a-f0-9]{32}$/.test(p.salt) ||
    typeof p.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(p.digest) ||
    typeof p.biometric !== "boolean" ||
    !Number.isInteger(p.failures) ||
    p.failures < 0 ||
    p.failures > 20 ||
    !Number.isSafeInteger(p.retryAt) ||
    p.retryAt < 0
  )
    throw Error(
      "The device unlock settings could not be read. Sign in online to recover access.",
    );
  return p;
}
function validatePin(pin: unknown): asserts pin is string {
  if (typeof pin !== "string" || !/^\d{8,12}$/.test(pin))
    throw Error("Use a device PIN of 8 to 12 digits.");
}
function digest(pin: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      pin,
      Buffer.from(salt, "hex"),
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
}
/** Native access gate. It never grants server permissions or extends an offline lease. */
export class NativeProfileLock {
  private account?: string;
  private saved?: Policy;
  private blocked = false;
  private failure?: string;
  private generation = 0;
  private revision = 0;
  private recoveredUntil = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private changing = 0;
  constructor(
    private host: {
      read(account: string): Promise<unknown>;
      write(account: string, value: Policy | undefined): Promise<void>;
      available(): boolean;
      biometricAvailable(): boolean;
      biometric(): Promise<void>;
      changed(status: ProfileLockStatus): void;
      onLock(): void;
      now?(): number;
    },
  ) {}
  private now() {
    return this.host.now?.() ?? Date.now();
  }
  get epoch() {
    return this.generation;
  }
  get locked() {
    return this.blocked;
  }
  status(): ProfileLockStatus {
    return {
      revision: this.revision,
      userId: this.account,
      enabled: !!this.saved || !!this.failure,
      locked: this.blocked,
      available: this.host.available(),
      biometric: !!this.saved?.biometric,
      biometricAvailable: this.host.biometricAvailable(),
      retryAt: this.saved?.retryAt ?? 0,
      error: this.failure,
      canRecover: !this.blocked && this.recoveredUntil > this.now(),
      recoveryExpiresAt: this.recoveredUntil,
    };
  }
  private changed() {
    this.revision++;
    this.host.changed(this.status());
  }
  private current(account: string, generation: number) {
    if (account !== this.account || generation !== this.generation)
      throw Error("The profile or its lock changed. Try again.");
  }
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.writes.catch(() => {}).then(run);
    this.writes = next;
    return next;
  }
  private change<T>(run: () => Promise<T>): Promise<T> {
    this.changing++;
    return this.exclusive(run).finally(() => {
      this.changing--;
    });
  }
  /** Publish a completed durable write before rejecting an invalidated caller. */
  private persisted(
    account: string,
    generation: number,
    durable: () => void,
    current?: () => void,
  ) {
    if (account !== this.account) this.current(account, generation);
    durable();
    if (generation !== this.generation) {
      this.changed();
      this.current(account, generation);
    }
    current?.();
    this.changed();
  }
  async activate(account?: string, authenticated = false) {
    const generation = ++this.generation;
    this.account = account;
    this.saved = undefined;
    this.failure = undefined;
    this.blocked = !!account;
    this.recoveredUntil = 0;
    this.changed();
    if (!account) return;
    try {
      const saved = await this.exclusive(async () =>
        policy(await this.host.read(account)),
      );
      this.current(account, generation);
      this.saved = saved;
      this.blocked = !!saved && !authenticated;
    } catch (error) {
      this.current(account, generation);
      this.failure =
        error instanceof Error
          ? error.message
          : "Unlock settings are unavailable.";
      this.blocked = !authenticated;
    }
    if (authenticated) this.recoveredUntil = this.now() + 5 * 60_000;
    this.changed();
  }
  assertUnlocked() {
    if (this.blocked) throw Error("Unlock this profile to continue.");
  }
  lock() {
    this.generation++;
    this.recoveredUntil = 0;
    if (this.account && (this.saved || this.failure || this.changing > 0)) {
      this.blocked = true;
      this.host.onLock();
    }
    this.changed();
  }
  private async verify(pin: unknown, account: string, generation: number) {
    validatePin(pin);
    const saved = this.saved;
    if (!saved)
      throw Error("Sign in online to recover device unlock settings.");
    if (saved.retryAt > this.now())
      throw Error("Too many attempts. Wait before trying this PIN again.");
    const actual = await digest(pin, saved.salt);
    this.current(account, generation);
    if (timingSafeEqual(actual, Buffer.from(saved.digest, "hex"))) return;
    const failures = Math.min(20, saved.failures + 1);
    const next = {
      ...saved,
      failures,
      retryAt:
        failures < 5
          ? 0
          : this.now() + Math.min(900_000, 30_000 * 2 ** (failures - 5)),
    };
    await this.host.write(account, next);
    this.persisted(account, generation, () => {
      this.saved = next;
    });
    throw Error("The device PIN is incorrect.");
  }
  async configure(pin: unknown, biometric: unknown, previousPin?: unknown) {
    validatePin(pin);
    if (typeof biometric !== "boolean")
      throw Error("Choose whether to enable Touch ID.");
    const account = this.account,
      generation = this.generation;
    if (!account) throw Error("Sign in before configuring device unlock.");
    this.assertUnlocked();
    if (!this.host.available())
      throw Error("Unlock protected storage before enabling a device PIN.");
    if (biometric && !this.host.biometricAvailable())
      throw Error("Touch ID is unavailable. Use a device PIN.");
    await this.change(async () => {
      this.current(account, generation);
      this.assertUnlocked();
      if (this.saved) await this.verify(previousPin, account, generation);
      else if (this.failure)
        throw Error("Recover the existing device lock before replacing it.");
      const salt = randomBytes(16).toString("hex");
      const hashed = await digest(pin, salt);
      this.current(account, generation);
      const next: Policy = {
        version: 1,
        salt,
        digest: hashed.toString("hex"),
        biometric,
        failures: 0,
        retryAt: 0,
      };
      await this.host.write(account, next);
      this.persisted(account, generation, () => {
        this.saved = next;
        this.failure = undefined;
      });
    });
  }
  async unlock(method: "pin" | "biometric", pin?: unknown) {
    if (method !== "pin" && method !== "biometric")
      throw Error("Choose a supported unlock method.");
    const account = this.account,
      generation = this.generation;
    if (!account || !this.blocked) return;
    await this.change(async () => {
      this.current(account, generation);
      if (!this.host.available())
        throw Error(
          "Protected storage is unavailable. Unlock it or sign in online.",
        );
      if (method === "pin") await this.verify(pin, account, generation);
      else if (
        method === "biometric" &&
        this.saved?.biometric &&
        this.host.biometricAvailable()
      )
        await this.host.biometric();
      else
        throw Error(
          "Touch ID is unavailable. Use your device PIN or sign in online.",
        );
      this.current(account, generation);
      if (!this.saved)
        throw Error("Sign in online to recover device unlock settings.");
      const next = { ...this.saved, failures: 0, retryAt: 0 };
      await this.host.write(account, next);
      this.persisted(
        account,
        generation,
        () => {
          this.saved = next;
        },
        () => {
          this.blocked = false;
        },
      );
    });
  }
  async remove(pin?: unknown, recover = false) {
    const account = this.account,
      generation = this.generation;
    if (!account) throw Error("Sign in before changing device unlock.");
    this.assertUnlocked();
    await this.change(async () => {
      this.current(account, generation);
      if (recover) {
        if (this.recoveredUntil <= this.now())
          throw Error(
            "Sign in online again before resetting a forgotten device PIN.",
          );
      } else await this.verify(pin, account, generation);
      await this.host.write(account, undefined);
      this.persisted(account, generation, () => {
        this.saved = undefined;
        this.failure = undefined;
      });
    });
  }
}
