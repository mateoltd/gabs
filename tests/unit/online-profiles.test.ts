import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { OnlineProfileDirectory } from "../../packages/client/src/identity/online-profiles";
function fixture() {
  let disk: unknown,
    queue: Promise<unknown> = Promise.resolve();
  const store = {
    read: async () => structuredClone(disk),
    write: async (value: unknown) => {
      disk = structuredClone(value);
    },
    exclusive: <T>(run: () => Promise<T>) => {
      const next = queue.catch(() => {}).then(run);
      queue = next;
      return next;
    },
  };
  return {
    directory: new OnlineProfileDirectory(store),
    store,
    disk: () => disk,
  };
}
it("serializes independent accounts and persists only sign-in metadata", async () => {
  const f = fixture(),
    a = {
      id: randomUUID(),
      name: "A",
      email: "a@example.test",
      accessToken: "never-store",
    },
    b = { id: randomUUID(), name: "B", email: "b@example.test" };
  await Promise.all([
    f.directory.remember(a, true),
    f.directory.remember(b, true),
  ]);
  expect((await f.directory.list()).map((p) => p.id).sort()).toEqual(
    [a.id, b.id].sort(),
  );
  expect(JSON.stringify(f.disk())).not.toContain("never-store");
  expect(await new OnlineProfileDirectory(f.store).list()).toHaveLength(2);
});
it("forgetting removes identifying labels, prevents background resurrection and allows explicit reauthentication", async () => {
  const f = fixture(),
    user = {
      id: randomUUID(),
      name: "Private name",
      email: "private@example.test",
    };
  await f.directory.remember(user, true);
  await f.directory.forget(user.id);
  await f.directory.remember(user, false);
  expect(await f.directory.list()).toEqual([]);
  expect(f.disk()).toEqual([{ id: user.id, removed: true }]);
  await f.directory.remember(user, true);
  expect(await f.directory.list()).toMatchObject([user]);
});
it("a delayed identity writer cannot save after its account changes", async () => {
  const f = fixture();
  let current = true,
    release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const held = f.store.exclusive(
    () =>
      new Promise<void>((done) => {
        release = done;
        entered();
      }),
  );
  await started;
  const pending = f.directory.remember(
    { id: randomUUID(), name: "Old", email: "old@example.test" },
    true,
    () => current,
  );
  const rejected = expect(pending).rejects.toThrow("profile changed");
  current = false;
  release();
  await held;
  await rejected;
  expect(await f.directory.list()).toEqual([]);
});
it("unreadable saved metadata is reported without silently overwriting it", async () => {
  const f = fixture();
  await f.store.write({ broken: true });
  await expect(f.directory.list()).rejects.toThrow();
  await expect(f.directory.forget(randomUUID())).rejects.toThrow();
  expect(f.disk()).toEqual({ broken: true });
});
