import { it, expect } from "vitest";
import { NativeProfileLock } from "../../apps/desktop/src/main/identity/profile-lock";
function fixture() {
  const disk = new Map<string, unknown>();
  let available = true,
    hardware = true,
    time = 100_000,
    locks = 0;
  let prompt = async () => {};
  const host = {
    read: async (account: string) => structuredClone(disk.get(account)),
    write: async (account: string, value: unknown) => {
      if (!available) throw Error("Storage unavailable");
      if (value === undefined) disk.delete(account);
      else disk.set(account, structuredClone(value));
    },
    available: () => available,
    biometricAvailable: () => hardware,
    biometric: () => prompt(),
    changed: () => {},
    onLock: () => {
      locks++;
    },
    now: () => time,
  };
  return {
    lock: new NativeProfileLock(host),
    host,
    disk,
    locks: () => locks,
    availability: (value: boolean) => {
      available = value;
    },
    hardware: (value: boolean) => {
      hardware = value;
    },
    advance: (ms: number) => {
      time += ms;
    },
    prompt: (value: typeof prompt) => {
      prompt = value;
    },
  };
}
it("persists only a salted PIN verifier and requires unlock after restart", async () => {
  const f = fixture();
  await f.lock.activate("account-a", true);
  await f.lock.configure("12567890", false);
  expect(JSON.stringify([...f.disk])).not.toContain("12567890");
  f.lock.lock();
  expect(() => f.lock.assertUnlocked()).toThrow("Unlock");
  expect(f.locks()).toBe(1);
  const restarted = new NativeProfileLock(f.host);
  await restarted.activate("account-a");
  expect(restarted.status()).toMatchObject({
    enabled: true,
    locked: true,
    canRecover: false,
  });
  await restarted.unlock("pin", "12567890");
  expect(restarted.status().locked).toBe(false);
});
it("retains retry delays across restart and accepts the original PIN after the delay", async () => {
  const f = fixture();
  await f.lock.activate("account-a", true);
  await f.lock.configure("12567890", false);
  f.lock.lock();
  for (let i = 0; i < 5; i++)
    await expect(f.lock.unlock("pin", "00000000")).rejects.toThrow("incorrect");
  const restarted = new NativeProfileLock(f.host);
  await restarted.activate("account-a");
  await expect(restarted.unlock("pin", "12567890")).rejects.toThrow("Wait");
  f.advance(30_001);
  await restarted.unlock("pin", "12567890");
  expect(restarted.status()).toMatchObject({ locked: false, retryAt: 0 });
});
it("keeps account policies isolated and rejects stale biometric completion after switching", async () => {
  const f = fixture();
  await f.lock.activate("account-a", true);
  await f.lock.configure("12567890", true);
  f.lock.lock();
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.prompt(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        entered();
      }),
  );
  const unlocking = f.lock.unlock("biometric");
  const rejected = expect(unlocking).rejects.toThrow(
    "profile or its lock changed",
  );
  await started;
  const switching = f.lock.activate("account-b");
  finish();
  await rejected;
  await switching;
  expect(f.lock.status()).toMatchObject({
    userId: "account-b",
    enabled: false,
  });
  await f.lock.activate("account-a");
  expect(f.lock.status().locked).toBe(true);
});
it("cancellation, unavailable hardware and relocking never grant access", async () => {
  const f = fixture();
  await f.lock.activate("account-a", true);
  await f.lock.configure("12567890", true);
  f.lock.lock();
  f.prompt(async () => {
    throw Error("Authentication cancelled");
  });
  await expect(f.lock.unlock("biometric")).rejects.toThrow("cancelled");
  f.hardware(false);
  await expect(f.lock.unlock("biometric")).rejects.toThrow("unavailable");
  expect(f.lock.locked).toBe(true);
  f.hardware(true);
  f.prompt(async () => {
    f.lock.lock();
  });
  await expect(f.lock.unlock("biometric")).rejects.toThrow("changed");
  expect(f.lock.locked).toBe(true);
});
it("fails closed for unreadable policy and requires recent online authentication to reset", async () => {
  const f = fixture();
  f.disk.set("account-a", { broken: true });
  await f.lock.activate("account-a");
  expect(f.lock.status()).toMatchObject({
    locked: true,
    enabled: true,
    canRecover: false,
  });
  await expect(f.lock.remove(undefined, true)).rejects.toThrow("Unlock");
  await f.lock.activate("account-a", true);
  expect(f.lock.status()).toMatchObject({ locked: false, canRecover: true });
  f.advance(300_001);
  await expect(f.lock.remove(undefined, true)).rejects.toThrow(
    "Sign in online again",
  );
  await f.lock.activate("account-a", true);
  await f.lock.remove(undefined, true);
  expect(f.disk.has("account-a")).toBe(false);
});
it("refuses volatile PIN configuration and does not unlock if retry reset cannot persist", async () => {
  const f = fixture();
  await f.lock.activate("account-a", true);
  f.availability(false);
  await expect(f.lock.configure("12567890", false)).rejects.toThrow(
    "protected storage",
  );
  expect(f.disk.size).toBe(0);
  f.availability(true);
  await f.lock.configure("12567890", false);
  f.lock.lock();
  f.host.write = async () => {
    throw Error("Write failed");
  };
  await expect(f.lock.unlock("pin", "12567890")).rejects.toThrow(
    "Write failed",
  );
  expect(f.lock.locked).toBe(true);
});
it("changing or removing a configured PIN requires its current value", async () => {
  const f = fixture();
  await f.lock.activate("account-a", true);
  await f.lock.configure("12567890", false);
  await expect(f.lock.configure("87654321", false, "00000000")).rejects.toThrow(
    "incorrect",
  );
  await expect(f.lock.remove("00000000")).rejects.toThrow("incorrect");
  await f.lock.configure("87654321", false, "12567890");
  f.lock.lock();
  await expect(f.lock.unlock("pin", "12567890")).rejects.toThrow("incorrect");
  await f.lock.unlock("pin", "87654321");
  await f.lock.remove("87654321");
  expect(f.lock.status()).toMatchObject({ locked: false, enabled: false });
});
