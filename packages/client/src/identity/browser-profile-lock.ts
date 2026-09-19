import { assertSchema } from "@suite/module-sdk";
import { ProfileRecoverySchema, type ProfileRecovery } from "@suite/contracts";
import type { ProfileLockBridge, ProfileLockStatus } from "./profile-lock";

interface Pin {
  salt: string;
  verifier: string;
  failures: number;
  retryAt: number;
}
export interface BrowserLockRecord {
  version: 1;
  epoch: string;
  pin?: Pin;
  fault?: true;
  sessionId?: string;
  preservedPolicy?: string;
}
export interface BrowserRecoveryChallenge {
  account: string;
  snapshot: string;
  startedAt: number;
  previousSessionId?: string;
}
export interface BrowserLockStorage {
  read(account: string): Promise<string | undefined>;
  write(account: string, value: BrowserLockRecord): Promise<void>;
  exclusive<T>(account: string, run: () => Promise<T>): Promise<T>;
  changed(account: string): void;
  recovery(): Promise<ProfileRecovery>;
  now?(): number;
}
export class BrowserProfileLocked extends Error {
  readonly status = 423;
  readonly code = "PROFILE_LOCKED";
  constructor(message = "Unlock this profile to continue.") {
    super(message);
  }
}
class UnreadablePolicy extends Error {}
const unreadable = () =>
  new UnreadablePolicy(
    "The browser unlock settings could not be read. Sign in online to recover access.",
  );
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
const bytes = (value: string) =>
  Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
function pinValue(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{8,12}$/.test(value))
    throw Error("Use a device PIN of 8 to 12 digits.");
}
function record(raw: string | undefined): BrowserLockRecord {
  if (raw === undefined) return { version: 1, epoch: "initial" };
  let item: BrowserLockRecord | null;
  try {
    item = JSON.parse(raw) as BrowserLockRecord | null;
  } catch {
    throw unreadable();
  }
  if (
    !item ||
    item.version !== 1 ||
    typeof item.epoch !== "string" ||
    !/^(initial|[a-f0-9-]{36})$/.test(item.epoch) ||
    (item.fault !== undefined && item.fault !== true) ||
    (item.preservedPolicy !== undefined &&
      typeof item.preservedPolicy !== "string") ||
    (item.sessionId !== undefined &&
      (typeof item.sessionId !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sessionId)))
  )
    throw unreadable();
  const pin = item.pin;
  if (
    pin !== undefined &&
    (!pin ||
      typeof pin.salt !== "string" ||
      !/^[a-f0-9]{32}$/.test(pin.salt) ||
      typeof pin.verifier !== "string" ||
      !/^[a-f0-9]{64}$/.test(pin.verifier) ||
      !Number.isInteger(pin.failures) ||
      pin.failures < 0 ||
      pin.failures > 20 ||
      !Number.isSafeInteger(pin.retryAt) ||
      pin.retryAt < 0)
  )
    throw unreadable();
  return item;
}
async function key(pin: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(salt), iterations: 600000, hash: "SHA-256" },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}
const snapshot = async (raw: string | undefined) =>
  hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw === undefined ? "absent" : `stored:${raw}`),
    ),
  );
const message = (account: string) =>
  new TextEncoder().encode(`suite-profile-lock/v1/${account}`);

/** A cooperative browser access gate. It neither encrypts cached business data nor grants server authority. */
export class BrowserProfileLock implements ProfileLockBridge {
  private account?: string;
  private saved?: BrowserLockRecord;
  private grant?: string;
  private blocked = false;
  private failure?: string;
  private generation = 0;
  private revision = 0;
  private changing = 0;
  private available = true;
  private recoveredUntil = 0;
  private recoverySession?: string;
  private listeners = new Set<(status: ProfileLockStatus) => void>();
  constructor(private host: BrowserLockStorage) {}
  currentAccount() {
    return this.account;
  }
  /** Even an identity-control response must not outlive a local lock or account change. */
  fence() {
    const generation = this.generation;
    return async () => {
      if (generation !== this.generation) throw new BrowserProfileLocked();
    };
  }
  /** Serialize short local effects with cross-tab policy changes. Never hold this across network calls. */
  async withAccess<T>(account: string, task: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    return this.host.exclusive(account, async () => {
      this.current(account, generation);
      let value: BrowserLockRecord;
      try {
        value = record(await this.host.read(account));
      } catch (error) {
        if (account === this.account && generation === this.generation)
          this.fail(error);
        throw new BrowserProfileLocked(unreadable().message);
      }
      this.current(account, generation);
      this.apply(account, value);
      this.current(account, generation);
      this.requireGrant(value);
      const result = await task();
      this.current(account, generation);
      return result;
    });
  }
  private now() {
    return this.host.now?.() ?? Date.now();
  }
  private status(): ProfileLockStatus {
    return {
      revision: this.revision,
      userId: this.account,
      enabled: !!(this.saved?.pin || this.saved?.fault || this.failure),
      locked: this.blocked,
      available: this.available,
      biometric: false,
      biometricAvailable: false,
      retryAt: this.saved?.pin?.retryAt ?? 0,
      canRecover: !this.blocked && this.recoveredUntil > this.now(),
      recoveryExpiresAt: this.recoveredUntil,
      error:
        this.failure ?? (this.saved?.fault ? unreadable().message : undefined),
    };
  }
  async profileLockStatus() {
    if (this.account) await this.refresh(this.account);
    return this.status();
  }
  onProfileLock(listener: (status: ProfileLockStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    this.revision++;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
  private current(account: string, generation: number) {
    if (account !== this.account || generation !== this.generation)
      throw new BrowserProfileLocked(
        "The profile or its lock changed. Try again.",
      );
  }
  private apply(account: string, value: BrowserLockRecord) {
    if (account !== this.account) return;
    const before = JSON.stringify(this.status());
    if (this.saved && this.saved.epoch !== value.epoch) {
      this.generation++;
      this.recoveredUntil = 0;
      this.recoverySession = undefined;
    }
    this.saved = value;
    this.available = true;
    this.failure = undefined;
    this.blocked = !!(value.pin || value.fault) && this.grant !== value.epoch;
    if (JSON.stringify(this.status()) !== before) this.changed();
  }
  async activate(account?: string) {
    if (account === this.account) {
      if (account) await this.refresh(account);
      return;
    }
    this.generation++;
    this.account = account;
    this.saved = undefined;
    this.grant = undefined;
    this.failure = undefined;
    this.recoveredUntil = 0;
    this.recoverySession = undefined;
    this.blocked = !!account;
    this.changed();
    if (account) await this.refresh(account);
  }
  async refresh(account: string) {
    if (account !== this.account) return;
    const generation = this.generation;
    try {
      await this.host.exclusive(account, async () => {
        const value = record(await this.host.read(account));
        this.current(account, generation);
        this.apply(account, value);
      });
    } catch (error) {
      if (account !== this.account || generation !== this.generation) return;
      this.fail(error);
    }
  }
  private fail(error: unknown) {
    const message =
      error instanceof Error ? error.message : unreadable().message;
    const available = error instanceof UnreadablePolicy;
    if (
      this.blocked &&
      !this.grant &&
      this.failure === message &&
      this.available === available &&
      this.recoveredUntil === 0
    )
      return;
    this.generation++;
    this.grant = undefined;
    this.blocked = true;
    this.available = available;
    this.recoveredUntil = 0;
    this.recoverySession = undefined;
    this.failure = message;
    this.changed();
  }
  private async persist(
    account: string,
    generation: number,
    value: BrowserLockRecord,
    grant = false,
  ) {
    await this.host.write(account, value);
    // A committed counter or PIN must remain visible even if its caller was cancelled.
    if (account === this.account) {
      const current = generation === this.generation;
      if (grant && current) this.grant = value.epoch;
      this.apply(account, value);
      if (!current) {
        this.grant = undefined;
        this.blocked = true;
        this.changed();
      }
      if (!current) {
        this.host.changed(account);
        throw new BrowserProfileLocked(
          "The profile or its lock changed. Try again.",
        );
      }
    }
    this.host.changed(account);
    if (account !== this.account) throw new BrowserProfileLocked();
  }
  private async mutation<T>(account: string, run: () => Promise<T>) {
    this.changing++;
    try {
      return await this.host.exclusive(account, run);
    } finally {
      this.changing--;
    }
  }
  private requireAccount() {
    if (!this.account)
      throw Error("Open a profile before changing device unlock.");
    return this.account;
  }
  private requireGrant(value: BrowserLockRecord) {
    if (
      this.blocked ||
      ((value.pin || value.fault) && this.grant !== value.epoch)
    )
      throw new BrowserProfileLocked();
  }
  private async verify(
    account: string,
    generation: number,
    value: BrowserLockRecord,
    pin: unknown,
  ) {
    pinValue(pin);
    if (!value.pin || value.fault) throw unreadable();
    if (value.pin.retryAt > this.now())
      throw Error("Too many attempts. Wait before trying this PIN again.");
    const material = await key(pin, value.pin.salt);
    const valid = await crypto.subtle.verify(
      "HMAC",
      material,
      bytes(value.pin.verifier),
      message(account),
    );
    this.current(account, generation);
    if (valid) return;
    const failures = Math.min(20, value.pin.failures + 1);
    await this.persist(account, generation, {
      ...value,
      pin: {
        ...value.pin,
        failures,
        retryAt:
          failures < 5
            ? 0
            : this.now() + Math.min(900000, 30000 * 2 ** (failures - 5)),
      },
    });
    throw Error("The device PIN is incorrect.");
  }
  async configureProfileLock(
    pin: string,
    biometric: boolean,
    previousPin?: string,
  ) {
    pinValue(pin);
    if (biometric !== false)
      throw Error("Biometric unlock requires a supported desktop application.");
    const account = this.requireAccount(),
      generation = this.generation;
    await this.mutation(account, async () => {
      this.current(account, generation);
      const value = record(await this.host.read(account));
      this.requireGrant(value);
      if (value.fault) throw unreadable();
      if (value.pin) await this.verify(account, generation, value, previousPin);
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
      const material = await key(pin, salt);
      const verifier = hex(
        await crypto.subtle.sign("HMAC", material, message(account)),
      );
      this.current(account, generation);
      await this.persist(
        account,
        generation,
        {
          version: 1,
          epoch: crypto.randomUUID(),
          sessionId: value.sessionId,
          pin: { salt, verifier, failures: 0, retryAt: 0 },
        },
        true,
      );
    });
  }
  async lockProfile() {
    const account = this.account;
    this.generation++;
    this.grant = undefined;
    this.recoveredUntil = 0;
    this.recoverySession = undefined;
    if (this.saved?.pin || this.saved?.fault || this.failure || this.changing)
      this.blocked = true;
    this.changed();
    if (!account) return;
    try {
      await this.host.exclusive(account, async () => {
        const value = record(await this.host.read(account));
        const next = { ...value, epoch: crypto.randomUUID() };
        await this.host.write(account, next);
        this.apply(account, next);
        this.host.changed(account);
      });
    } catch (error) {
      if (account === this.account) this.fail(error);
      throw error;
    }
  }

  async unlockProfile(method: "pin" | "biometric", pin?: string) {
    if (method !== "pin") throw Error("Use your device PIN in this browser.");
    const account = this.requireAccount(),
      generation = this.generation;
    await this.mutation(account, async () => {
      this.current(account, generation);
      const value = record(await this.host.read(account));
      if (!value.pin && !value.fault) {
        this.apply(account, value);
        return;
      }
      await this.verify(account, generation, value, pin);
      await this.persist(
        account,
        generation,
        { ...value, pin: { ...value.pin!, failures: 0, retryAt: 0 } },
        true,
      );
    });
  }
  async removeProfileLock(pin?: string, recover = false) {
    const account = this.requireAccount(),
      generation = this.generation;
    await this.mutation(account, async () => {
      this.current(account, generation);
      const value = record(await this.host.read(account));
      this.requireGrant(value);
      if (recover) {
        if (
          this.recoveredUntil <= this.now() ||
          value.sessionId !== this.recoverySession
        )
          throw Error(
            "Sign in online again before resetting a forgotten device PIN.",
          );
      } else await this.verify(account, generation, value, pin);
      this.current(account, generation);
      await this.persist(
        account,
        generation,
        { version: 1, epoch: crypto.randomUUID(), sessionId: value.sessionId },
        true,
      );
    });
  }
  /** Call before starting fresh authentication; persist this non-secret challenge through redirects. */
  async beginRecovery(): Promise<BrowserRecoveryChallenge> {
    // A new sign-in intent supersedes any recovery still awaiting a response.
    this.generation++;
    const account = this.requireAccount(),
      generation = this.generation,
      startedAt = this.now();
    const raw = await this.host.exclusive(account, () =>
      this.host.read(account),
    );
    let previousSessionId: string | undefined;
    try {
      previousSessionId = record(raw).sessionId;
    } catch {
      /* Preserve unreadable settings until fresh authentication succeeds. */
    }
    try {
      const proof = await this.proof();
      if (proof.userId === account) previousSessionId = proof.sessionId;
    } catch (error) {
      const failure = error as { status?: number; code?: string };
      if (
        failure.status !== 401 &&
        !(
          failure.status === 403 &&
          ["MFA_REQUIRED", "REAUTHENTICATION_REQUIRED"].includes(
            failure.code ?? "",
          )
        )
      )
        throw error;
    }
    this.current(account, generation);
    return {
      account,
      snapshot: await snapshot(raw),
      startedAt,
      previousSessionId,
    };
  }

  private async proof() {
    const proof = await this.host.recovery();
    assertSchema(ProfileRecoverySchema, proof);
    const start = Date.parse(proof.authenticatedAt),
      end = Date.parse(proof.expiresAt);
    if (start > this.now() || end <= this.now() || end - start !== 300000)
      throw Error("Sign in online again before recovering this profile.");
    return proof;
  }
  async completeRecovery(
    challenge: BrowserRecoveryChallenge,
    beforeUnlock?: (account: string) => Promise<void>,
  ) {
    const account = this.requireAccount(),
      generation = this.generation;
    if (
      !challenge ||
      typeof challenge.snapshot !== "string" ||
      !/^[a-f0-9]{64}$/.test(challenge.snapshot) ||
      !Number.isSafeInteger(challenge.startedAt) ||
      challenge.startedAt < 0 ||
      challenge.startedAt > this.now() ||
      (challenge.previousSessionId !== undefined &&
        (typeof challenge.previousSessionId !== "string" ||
          !/^[a-f0-9]{64}$/.test(challenge.previousSessionId)))
    )
      throw Error("Start profile recovery again.");
    if (challenge.account !== account)
      throw new BrowserProfileLocked(
        "This recovery belongs to another profile.",
      );
    const proof = await this.proof();
    this.current(account, generation);
    if (
      proof.userId !== account ||
      proof.sessionId === challenge.previousSessionId ||
      Date.parse(proof.authenticatedAt) < challenge.startedAt
    )
      throw Error("Sign in again with this profile before recovering access.");
    // Adopt fresh host credentials before publishing unlocked access.
    // Recheck the durable policy after network work, outside the storage lock.
    await beforeUnlock?.(account);
    await this.mutation(account, async () => {
      this.current(account, generation);
      const raw = await this.host.read(account);
      if ((await snapshot(raw)) !== challenge.snapshot)
        throw new BrowserProfileLocked(
          "The profile changed after recovery began. Start again.",
        );
      let value: BrowserLockRecord;
      try {
        value = record(raw);
      } catch {
        value = {
          version: 1,
          epoch: crypto.randomUUID(),
          fault: true,
          preservedPolicy: raw,
        };
      }
      this.current(account, generation);
      if (
        proof.sessionId === value.sessionId ||
        Date.parse(proof.expiresAt) <= this.now()
      )
        throw Error("Sign in online again before recovering this profile.");
      await this.persist(
        account,
        generation,
        { ...value, epoch: crypto.randomUUID(), sessionId: proof.sessionId },
        true,
      );
      this.recoveredUntil = Date.parse(proof.expiresAt);
      this.recoverySession = proof.sessionId;
      this.changed();
    });
  }
  /** Check before work and again before returning data or publishing its result. */
  async access(account: string): Promise<() => Promise<void>> {
    const generation = this.generation;
    this.current(account, generation);
    const read = async () => {
      try {
        return await this.host.exclusive(account, async () => {
          const value = record(await this.host.read(account));
          check(value);
          return value;
        });
      } catch (error) {
        if (error instanceof BrowserProfileLocked) throw error;
        if (account === this.account && generation === this.generation)
          this.fail(error);
        throw new BrowserProfileLocked(unreadable().message);
      }
    };
    const check = (value: BrowserLockRecord) => {
      if (generation !== this.generation) throw new BrowserProfileLocked();
      if (account === this.account) this.apply(account, value);
      if (
        generation !== this.generation ||
        (account === this.account && this.blocked) ||
        ((value.pin || value.fault) &&
          (this.account !== account || this.grant !== value.epoch))
      )
        throw new BrowserProfileLocked();
    };
    const value = await read();
    return async () => {
      const latest = await read();
      if (value.epoch !== latest.epoch) throw new BrowserProfileLocked();
    };
  }
}
