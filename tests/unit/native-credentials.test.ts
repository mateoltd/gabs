import { expect, it, vi } from "vitest";
import {
  NativeCredentials,
  type CredentialTokens,
} from "../../apps/desktop/src/main/identity/credentials";
function gate<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let epoch = 0,
    now = 0;
  let disk: { refreshToken?: string } | undefined;
  const host = {
    epoch: () => epoch,
    now: () => now,
    load: async () => disk,
    save: vi.fn(async (value: { refreshToken?: string }) => {
      disk = value;
    }),
    remove: vi.fn(async () => {
      disk = undefined;
    }),
    renew: vi.fn<(token: string) => Promise<CredentialTokens>>(),
  };
  const credentials = new NativeCredentials(host);
  return {
    credentials,
    host,
    epoch: () => epoch,
    next: () => ++epoch,
    expire: () => {
      now += 600000;
    },
    disk: () => disk,
  };
}
it("coalesces refreshes, rotates once and restores only the durable current token", async () => {
  const f = fixture();
  await f.credentials.commit(
    { access_token: "a", refresh_token: "original" },
    f.epoch(),
    "login",
  );
  f.expire();
  const reply = gate<CredentialTokens>();
  f.host.renew.mockReturnValue(reply.promise);
  const calls = [
    f.credentials.ensure(),
    f.credentials.ensure(),
    f.credentials.ensure(),
  ];
  expect(f.host.renew).toHaveBeenCalledTimes(1);
  reply.resolve({ access_token: "b", refresh_token: "rotated" });
  await Promise.all(calls);
  const restart = new NativeCredentials(f.host);
  await restart.restore();
  expect(restart.accessToken).toBeUndefined();
  expect(restart.refreshToken).toBe("rotated");
  expect(f.credentials.accessToken).toBe("b");
});
it("a new login without a refresh token cannot inherit another account's token", async () => {
  const f = fixture();
  await f.credentials.commit(
    { access_token: "a", refresh_token: "account-a" },
    f.epoch(),
    "login",
  );
  await f.credentials.commit({ access_token: "b" }, f.next(), "login");
  expect(f.credentials.refreshToken).toBeUndefined();
  expect(f.disk()).toEqual({ refreshToken: undefined });
  f.expire();
  await expect(f.credentials.ensure()).rejects.toThrow("Sign in");
  expect(f.host.renew).not.toHaveBeenCalled();
});
it("an obsolete refresh neither writes credentials nor clears the new refresh flight", async () => {
  const f = fixture(),
    old = gate<CredentialTokens>(),
    current = gate<CredentialTokens>();
  await f.credentials.commit(
    { access_token: "a", refresh_token: "account-a" },
    f.epoch(),
    "login",
  );
  f.expire();
  f.host.renew
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const obsolete = expect(f.credentials.ensure()).rejects.toThrow(
    "session changed",
  );
  f.next();
  await f.credentials.clear();
  await f.credentials.commit(
    { access_token: "b", refresh_token: "account-b" },
    f.epoch(),
    "login",
  );
  f.expire();
  const first = f.credentials.ensure();
  old.resolve({ access_token: "stale", refresh_token: "stale" });
  await obsolete;
  const second = f.credentials.ensure();
  expect(f.host.renew).toHaveBeenCalledTimes(2);
  current.resolve({ access_token: "new-b" });
  await Promise.all([first, second]);
  expect(f.credentials.accessToken).toBe("new-b");
  expect(f.disk()).toEqual({ refreshToken: "account-b" });
});
it("logout fences a held disk write and durable deletion finishes after it", async () => {
  const f = fixture(),
    held = gate<void>(),
    entered = gate<void>();
  const save = f.host.save.getMockImplementation()!;
  f.host.save.mockImplementationOnce(async (value) => {
    entered.resolve();
    await held.promise;
    await save(value);
  });
  const login = expect(
    f.credentials.commit(
      { access_token: "late", refresh_token: "late" },
      f.epoch(),
      "login",
    ),
  ).rejects.toThrow("session changed");
  await entered.promise;
  f.next();
  const removal = f.credentials.clear();
  expect(f.credentials.accessToken).toBeUndefined();
  held.resolve();
  await login;
  await removal;
  expect(f.disk()).toBeUndefined();
  expect(f.credentials.refreshToken).toBeUndefined();
});
it("failed persistence never publishes an access token and does not poison later credential writes", async () => {
  const f = fixture();
  f.host.save.mockRejectedValueOnce(Error("Protected storage failed"));
  await expect(
    f.credentials.commit(
      { access_token: "unsaved", refresh_token: "unsaved" },
      f.epoch(),
      "login",
    ),
  ).rejects.toThrow("Protected storage");
  expect(f.credentials.accessToken).toBeUndefined();
  await f.credentials.commit({ access_token: "saved" }, f.epoch(), "login");
  expect(f.credentials.accessToken).toBe("saved");
});
it("cancellation rejects a queued login before it can persist credentials", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort(Error("Login expired"));
  await expect(
    f.credentials.commit(
      { access_token: "late" },
      f.epoch(),
      "login",
      controller.signal,
    ),
  ).rejects.toThrow("Login expired");
  expect(f.host.save).not.toHaveBeenCalled();
});

it.each([
  "Sign-in cancelled by sign-out.",
  "Sign-in cancelled because the profile was locked.",
])(
  "a cancelled sign-in cannot delay or detach its replacement: %s",
  async (reason) => {
    const { NativeSignIn } =
      await import("../../apps/desktop/src/main/identity/sign-in");
    const sessions = new NativeSignIn(),
      old = gate<void>(),
      fresh = gate<void>();
    const first = sessions.run(async (signal) => {
      await old.promise;
      signal.throwIfAborted();
    });
    const rejected = expect(first).rejects.toThrow(reason);
    await Promise.resolve();
    sessions.cancel(reason);
    const start = vi.fn(async () => {
      await fresh.promise;
    });
    const replacement = sessions.run(start);
    old.resolve();
    await rejected;
    expect(sessions.run(start)).toBe(replacement);
    expect(start).toHaveBeenCalledTimes(1);
    fresh.resolve();
    await replacement;
  },
);
it("sign-out before queued sign-in begins prevents its setup side effects", async () => {
  const { NativeSignIn } =
    await import("../../apps/desktop/src/main/identity/sign-in");
  const sessions = new NativeSignIn(),
    start = vi.fn(async () => {});
  const pending = sessions.run(start);
  sessions.cancel();
  await expect(pending).rejects.toThrow("cancelled");
  expect(start).not.toHaveBeenCalled();
});
