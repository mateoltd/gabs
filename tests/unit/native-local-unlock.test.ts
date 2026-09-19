import { expect, it } from "vitest";
import { NativeLocalUnlock } from "../../apps/desktop/src/main/identity/local-unlock";
const profileId = "11111111-1111-4111-8111-111111111111";
const epoch = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let available = true,
    prompts = 0;
  let prompt: () => Promise<void> = async () => {};
  const adapter = new NativeLocalUnlock({
    available: () => available,
    biometricAvailable: () => true,
    biometric: async () => {
      prompts++;
      await prompt();
    },
    encrypt: async (value) => Buffer.from(value),
    decrypt: async (value) => Buffer.from(value).toString(),
  });
  return {
    adapter,
    prompts: () => prompts,
    available: (value: boolean) => {
      available = value;
    },
    prompt: (value: typeof prompt) => {
      prompt = value;
    },
  };
}
it("binds protected keys to profile, epoch and purpose, requiring a fresh biometric prompt", async () => {
  const f = fixture();
  const scope = { profileId, epoch, kind: "biometric" as const };
  const sealed = await f.adapter.seal(scope, Array(32).fill(7));
  expect(f.prompts()).toBe(1);
  await expect(
    f.adapter.open({ ...scope, kind: "pin" }, sealed),
  ).rejects.toThrow("another profile or unlock method");
  await expect(
    f.adapter.open({ ...scope, profileId: epoch }, sealed),
  ).rejects.toThrow("another profile");
  await expect(
    f.adapter.open({ ...scope, epoch: profileId }, sealed),
  ).rejects.toThrow("another profile");
  expect(f.prompts()).toBe(1);
  expect(await f.adapter.open(scope, sealed)).toEqual(Array(32).fill(7));
  expect(f.prompts()).toBe(2);
  f.prompt(async () => {
    throw Error("Cancelled");
  });
  await expect(f.adapter.open(scope, sealed)).rejects.toThrow("Cancelled");
});
it("refuses unavailable OS protection and invalid IPC payloads without fallback", async () => {
  const f = fixture();
  const scope = { profileId, epoch, kind: "pin" as const };
  const sealed = await f.adapter.seal(scope, Array(48).fill(3));
  expect(f.prompts()).toBe(0);
  expect(await f.adapter.open(scope, sealed)).toHaveLength(48);
  await expect(f.adapter.seal(scope, Array(32).fill(3))).rejects.toThrow(
    "Invalid protected",
  );
  await expect(
    f.adapter.seal({ ...scope, profileId: "foreign" }, Array(48).fill(3)),
  ).rejects.toThrow("Invalid local");
  f.available(false);
  expect(await f.adapter.status()).toEqual({
    available: false,
    biometric: false,
  });
  await expect(f.adapter.seal(scope, Array(48).fill(3))).rejects.toThrow(
    "unavailable",
  );
  await expect(f.adapter.open(scope, sealed)).rejects.toThrow("unavailable");
});
it("captures enrollment inputs and rejects protection lost during a biometric prompt", async () => {
  const f = fixture();
  let finish!: () => void;
  f.prompt(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const scope = { profileId, epoch, kind: "biometric" as const },
    raw = Array(32).fill(4);
  const pending = f.adapter.seal(scope, raw);
  scope.profileId = epoch;
  raw.fill(9);
  finish();
  const sealed = await pending;
  f.prompt(async () => {});
  expect(
    await f.adapter.open({ profileId, epoch, kind: "biometric" }, sealed),
  ).toEqual(Array(32).fill(4));
  f.prompt(async () => {
    f.available(false);
  });
  await expect(
    f.adapter.open({ profileId, epoch, kind: "biometric" }, sealed),
  ).rejects.toThrow("became unavailable");
});
