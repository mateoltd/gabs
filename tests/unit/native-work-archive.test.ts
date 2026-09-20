import { it, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { exportNativeWorkArchive } from "../../apps/desktop/src/main/work-archive";
import {
  openSavedWorkArchive,
  type SavedWorkArchive,
} from "../../packages/client/src/recovery/archive";

function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() },
    id = randomUUID();
  const archive: SavedWorkArchive = {
    kind: "corporate-saved-work",
    formatVersion: 1,
    createdAt: Date.now(),
    ...scope,
    copies: [
      {
        kind: "module-work-recovery",
        formatVersion: 1,
        ...scope,
        moduleId: "contacts",
        moduleVersion: "1.0.0",
        selection: "request",
        entry: {
          id,
          ...scope,
          call: {
            moduleId: "contacts",
            moduleVersion: "1.0.0",
            key: id,
            action: "create",
            resource: "contacts",
            input: { name: "Private pending work" },
          },
          createdAt: Date.now(),
          state: "pending",
          attempts: 0,
          dependencies: [],
        },
      },
    ],
  };
  let active = true,
    revoked = false,
    authorizations = 0;
  const check = () => {
    if (!active) throw Error("Profile locked");
  };
  const options = {
    handle: "session",
    content: JSON.stringify(archive),
    passphrase: "native archive integration secret",
    check,
    capture: () => ({
      scope,
      moduleId: "contacts",
      moduleVersion: "1.0.0",
      check,
    }),
    authorize: async () => {
      authorizations++;
      return () => {
        if (revoked) throw Error("Access revoked");
      };
    },
  };
  return {
    options,
    archive,
    lock: () => {
      active = false;
    },
    revoke: () => {
      revoked = true;
    },
    count: () => authorizations,
  };
}

it("publishes an encrypted archive atomically with private permissions and fresh checks after the dialog", async () => {
  const f = fixture(),
    directory = await mkdtemp(resolve(tmpdir(), "suite-work-archive-"));
  const destination = resolve(directory, "saved.json");
  try {
    expect(
      await exportNativeWorkArchive({
        ...f.options,
        choose: async () => destination,
      }),
    ).toEqual({ status: "saved" });
    expect(f.count()).toBe(2);
    const text = await readFile(destination, "utf8");
    expect(text).not.toContain("Private pending work");
    expect(
      await openSavedWorkArchive(
        text,
        f.options.passphrase,
        f.archive,
        () => {},
      ),
    ).toEqual(f.archive);
    expect(await readdir(directory)).toEqual(["saved.json"]);
    if (process.platform !== "win32")
      expect((await stat(destination)).mode & 0o777).toBe(0o600);
    await expect(
      exportNativeWorkArchive({
        ...f.options,
        choose: async () => destination,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(destination, "utf8")).toBe(text);
    expect(await readdir(directory)).toEqual(["saved.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("cancels without publishing and rejects access or profile loss during destination selection", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "suite-work-archive-"));
  try {
    const f = fixture();
    expect(
      await exportNativeWorkArchive({
        ...f.options,
        choose: async () => undefined,
      }),
    ).toEqual({ status: "cancelled" });
    for (const transition of ["lock", "revoke"] as const) {
      const test = fixture();
      await expect(
        exportNativeWorkArchive({
          ...test.options,
          choose: async () => {
            test[transition]();
            return resolve(directory, "never.json");
          },
        }),
      ).rejects.toThrow(transition === "lock" ? /locked/ : /revoked/);
    }
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects mismatched workspace or session contracts before choosing a destination", async () => {
  const f = fixture();
  let chosen = false;
  const choose = async () => {
    chosen = true;
    return undefined;
  };
  await expect(
    exportNativeWorkArchive({
      ...f.options,
      content: JSON.stringify({ ...f.archive, workspaceId: randomUUID() }),
      choose,
    }),
  ).rejects.toThrow(/another account or workspace/);
  await expect(
    exportNativeWorkArchive({
      ...f.options,
      capture: () => ({ ...f.options.capture(), moduleVersion: "2.0.0" }),
      choose,
    }),
  ).rejects.toThrow(/owning recovery session/);
  expect(chosen).toBe(false);
});
