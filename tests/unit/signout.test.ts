import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SuiteClient } from "../../packages/client/src/api";
import {
  rememberSignOut,
  acknowledgeSignOut,
  rememberAuthenticatedSession,
  reconcileSignOut,
  hasSignedOut,
} from "../../packages/shell/src/features/identity/signout";
const userId = "11111111-1111-4111-8111-111111111111";
const identity = (csrfToken = "old-session") => ({
  user: { id: userId },
  csrfToken,
});
beforeEach(() => {
  const disk = new Map<string, string>();
  vi.stubGlobal("navigator", {
    locks: { request: (_key: string, task: () => Promise<unknown>) => task() },
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => {
      disk.set(key, value);
    },
    removeItem: (key: string) => {
      disk.delete(key);
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("invalidates the local session before a held logout acknowledgement without discarding that acknowledgement", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new SuiteClient(async (request) => {
    if (request.operation === "me")
      return { status: 200, actorId: userId, body: identity() };
    expect(request.expectedUserId).toBe(userId);
    await held;
    return { status: 200, actorId: userId, body: { ok: true } };
  });
  await client.request({ operation: "me" });
  const invalidated = vi.fn(async () => {});
  client.onIdentityInvalidated(invalidated);
  const ending = client.signOut(userId, true);
  expect(client.isCurrentUser(userId)).toBe(false);
  expect(invalidated).toHaveBeenCalledWith({
    userId,
    reason: "signed-out",
    remote: false,
  });
  release();
  await ending;
});
it("terminates the original session once and requires a fresh server session before reopening", async () => {
  const transport = vi.fn(async () => ({
    status: 200,
    actorId: userId,
    body: { ok: true },
  }));
  const client = new SuiteClient(transport);
  await rememberSignOut(userId, "old-session");
  expect(localStorage.getItem("suite-logout-pending")).not.toContain(
    "old-session",
  );
  await expect(reconcileSignOut(client, identity())).rejects.toMatchObject({
    code: "SIGNED_OUT",
  });
  await expect(reconcileSignOut(client, identity())).rejects.toMatchObject({
    code: "SIGNED_OUT",
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(hasSignedOut(userId)).toBe(true);
  await reconcileSignOut(client, identity("new-session"));
  expect(hasSignedOut(userId)).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
});
it("retains the original session fingerprint for an offline restart and recognizes fresh redirect authentication", async () => {
  await rememberAuthenticatedSession(identity());
  await rememberSignOut(userId);
  const transport = vi.fn(async () => ({ status: 200, body: {} }));
  await reconcileSignOut(
    new SuiteClient(transport),
    identity("fresh-redirect-session"),
  );
  expect(transport).not.toHaveBeenCalled();
  expect(hasSignedOut(userId)).toBe(false);
});
it("keeps a failed termination pending and prevents an old acknowledgement from replacing a newer sign-out", async () => {
  const record = await rememberSignOut(userId, "old-session");
  const client = new SuiteClient(async () => {
    throw new TypeError("Offline");
  });
  await expect(reconcileSignOut(client, identity())).rejects.toThrow("Offline");
  expect(
    JSON.parse(localStorage.getItem("suite-logout-pending")!).pending,
  ).toBe(true);
  await rememberSignOut("another-user", "another-session");
  acknowledgeSignOut(record);
  expect(hasSignedOut("another-user")).toBe(true);
  expect(
    JSON.parse(localStorage.getItem("suite-logout-pending")!).pending,
  ).toBe(true);
});
it("does not terminate a different account and retains legacy pending sign-out recovery", async () => {
  await rememberSignOut("another-user", "old-session");
  const transport = vi.fn(async () => ({
    status: 200,
    actorId: userId,
    body: {},
  }));
  const client = new SuiteClient(transport);
  await reconcileSignOut(client, identity());
  expect(transport).not.toHaveBeenCalled();
  localStorage.setItem("suite-logout-pending", "1");
  await expect(reconcileSignOut(client, identity())).rejects.toMatchObject({
    code: "SIGNED_OUT",
  });
  expect(transport).toHaveBeenCalledTimes(1);
  await reconcileSignOut(client, identity("fresh-session"));
  expect(hasSignedOut(userId)).toBe(false);
});
