import { expect, it } from "vitest";
import {
  BrowserProfileLock,
  type BrowserLockStorage,
} from "../../packages/client/src/identity/browser-profile-lock";
import type { ProfileRecovery } from "../../packages/contracts/src";

const account = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const pin = "12567890";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  const disk = new Map<string, string>();
  const queues = new Map<string, Promise<unknown>>();
  let now = Date.parse("2026-09-19T12:00:00Z");
  let proof: ProfileRecovery = {
    userId: account,
    sessionId: "a".repeat(64),
    authenticatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300000).toISOString(),
  };
  const host: BrowserLockStorage = {
    read: async (id) => disk.get(id),
    write: async (id, value) => {
      disk.set(id, JSON.stringify(value));
    },
    exclusive: (id, run) => {
      const next = (queues.get(id) ?? Promise.resolve())
        .catch(() => {})
        .then(run);
      queues.set(
        id,
        next.catch(() => {}),
      );
      return next;
    },
    changed: () => {},
    now: () => now,
    recovery: async () => structuredClone(proof),
  };
  return {
    lock: new BrowserProfileLock(host),
    host,
    disk,
    advance: (ms: number) => {
      now += ms;
    },
    proof: () => proof,
    signIn: (id = account, sessionId = "b".repeat(64)) => {
      now += 1000;
      proof = {
        userId: id,
        sessionId,
        authenticatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 300000).toISOString(),
      };
    },
  };
}
it("stores an account-bound salted verifier, locks on restart and keeps accounts separate", async () => {
  const f = fixture();
  await f.lock.activate(account);
  await f.lock.configureProfileLock(pin, false);
  expect(f.disk.get(account)).not.toContain(pin);
  const restart = new BrowserProfileLock(f.host);
  await restart.activate(account);
  expect(await restart.profileLockStatus()).toMatchObject({
    enabled: true,
    locked: true,
    canRecover: false,
  });
  await expect(restart.access(account)).rejects.toMatchObject({ status: 423 });
  await restart.unlockProfile("pin", pin);
  await (
    await restart.access(account)
  )();
  await expect(restart.access(other)).rejects.toMatchObject({ status: 423 });
  f.disk.set(other, f.disk.get(account)!);
  await restart.activate(other);
  await expect(restart.unlockProfile("pin", pin)).rejects.toThrow("incorrect");
});
it("serializes failed attempts across tabs and retains retry delay across restarts", async () => {
  const f = fixture();
  await f.lock.activate(account);
  await f.lock.configureProfileLock(pin, false);
  await f.lock.lockProfile();
  const second = new BrowserProfileLock(f.host);
  await second.activate(account);
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      (i % 2 ? second : f.lock).unlockProfile("pin", "00000000"),
    ),
  );
  expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
  expect(JSON.parse(f.disk.get(account)!).pin.failures).toBe(5);
  const restart = new BrowserProfileLock(f.host);
  await restart.activate(account);
  await expect(restart.unlockProfile("pin", pin)).rejects.toThrow("Wait");
  f.advance(30001);
  await restart.unlockProfile("pin", pin);
  expect(await restart.profileLockStatus()).toMatchObject({
    locked: false,
    retryAt: 0,
  });
});
it("fences reads after a missed cross-tab lock broadcast and after identity replacement", async () => {
  const f = fixture();
  await f.lock.activate(account);
  await f.lock.configureProfileLock(pin, false);
  const finish = await f.lock.access(account);
  const second = new BrowserProfileLock(f.host);
  await second.activate(account);
  await second.lockProfile();
  await expect(finish()).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  expect(await f.lock.profileLockStatus()).toMatchObject({ locked: true });
  await f.lock.unlockProfile("pin", pin);
  const oldAccount = await f.lock.access(account);
  await f.lock.activate(other);
  await expect(oldAccount()).rejects.toMatchObject({ status: 423 });
});
it("retains a first PIN policy committed after a concurrent local lock", async () => {
  const f = fixture(),
    entered = deferred(),
    finish = deferred();
  await f.lock.activate(account);
  const write = f.host.write;
  f.host.write = async (...args) => {
    entered.resolve();
    await finish.promise;
    await write(...args);
  };
  const configuring = f.lock.configureProfileLock(pin, false);
  const rejected = expect(configuring).rejects.toMatchObject({ status: 423 });
  await entered.promise;
  const locking = f.lock.lockProfile();
  finish.resolve();
  await rejected;
  await locking;
  expect(await f.lock.profileLockStatus()).toMatchObject({
    enabled: true,
    locked: true,
  });
  const restart = new BrowserProfileLock(f.host);
  await restart.activate(account);
  await restart.unlockProfile("pin", pin);
});
it("does not overwrite corrupt or future settings when locking and preserves them through explicit recovery", async () => {
  const f = fixture();
  const raw = '{"version":2,"future":"preserve this"}';
  f.disk.set(account, raw);
  await f.lock.activate(account);
  await expect(f.lock.lockProfile()).rejects.toThrow("could not be read");
  expect(f.disk.get(account)).toBe(raw);
  await expect(f.lock.access(account)).rejects.toMatchObject({ status: 423 });
  const challenge = await f.lock.beginRecovery();
  await expect(f.lock.completeRecovery(challenge)).rejects.toThrow(
    "Sign in again",
  );
  f.signIn();
  await f.lock.completeRecovery(challenge);
  expect(JSON.parse(f.disk.get(account)!)).toMatchObject({
    fault: true,
    preservedPolicy: raw,
  });
  expect(await f.lock.profileLockStatus()).toMatchObject({
    enabled: true,
    locked: false,
    canRecover: true,
  });
  await f.lock.removeProfileLock(undefined, true);
  expect(await f.lock.profileLockStatus()).toMatchObject({ enabled: false });
});
it("rejects same-session, foreign-account, expired and changed-policy recovery", async () => {
  const f = fixture();
  await f.lock.activate(account);
  await f.lock.configureProfileLock(pin, false);
  await f.lock.lockProfile();
  const challenge = await f.lock.beginRecovery();
  await expect(f.lock.completeRecovery(challenge)).rejects.toThrow(
    "Sign in again",
  );
  f.signIn(other);
  await expect(f.lock.completeRecovery(challenge)).rejects.toThrow(
    "Sign in again",
  );
  f.signIn();
  f.advance(300001);
  await expect(f.lock.completeRecovery(challenge)).rejects.toThrow(
    "Sign in online again",
  );
  f.signIn();
  const second = new BrowserProfileLock(f.host);
  await second.activate(account);
  await second.lockProfile();
  await expect(f.lock.completeRecovery(challenge)).rejects.toThrow(
    "changed after recovery",
  );
});
it("expires reset authority and rejects stale recovery after an account switch", async () => {
  const f = fixture();
  await f.lock.activate(account);
  await f.lock.configureProfileLock(pin, false);
  await f.lock.lockProfile();
  const challenge = await f.lock.beginRecovery();
  f.signIn();
  await f.lock.completeRecovery(challenge);
  f.advance(300000);
  await expect(f.lock.removeProfileLock(undefined, true)).rejects.toThrow(
    "Sign in online again",
  );
  await f.lock.activate(other);
  await expect(f.lock.completeRecovery(challenge)).rejects.toThrow(
    "another profile",
  );
});
it("fails closed on unavailable storage without deleting policy or granting recovery", async () => {
  const f = fixture();
  await f.lock.activate(account);
  await f.lock.configureProfileLock(pin, false);
  const raw = f.disk.get(account);
  f.host.read = async () => {
    throw Error("Storage unavailable");
  };
  await f.lock.refresh(account);
  expect(await f.lock.profileLockStatus()).toMatchObject({
    enabled: true,
    locked: true,
    available: false,
    canRecover: false,
  });
  await expect(f.lock.access(account)).rejects.toMatchObject({ status: 423 });
  await expect(f.lock.beginRecovery()).rejects.toThrow("Storage unavailable");
  expect(f.disk.get(account)).toBe(raw);
});

it.each(["refresh", "lock"] as const)(
  "handles %s of unreadable policy while fresh recovery is in flight",
  async (action) => {
    const f = fixture(),
      entered = deferred(),
      finish = deferred();
    f.disk.set(account, "unreadable policy");
    await f.lock.activate(account);
    const challenge = await f.lock.beginRecovery();
    f.signIn();
    f.host.recovery = async () => {
      entered.resolve();
      await finish.promise;
      return f.proof();
    };
    const recovering = f.lock.completeRecovery(challenge);
    const outcome =
      action === "lock"
        ? expect(recovering).rejects.toMatchObject({ status: 423 })
        : expect(recovering).resolves.toBeUndefined();
    await entered.promise;
    if (action === "lock")
      await expect(f.lock.lockProfile()).rejects.toThrow("could not be read");
    else await f.lock.refresh(account);
    finish.resolve();
    await outcome;
    expect((await f.lock.profileLockStatus()).locked).toBe(action === "lock");
  },
);
