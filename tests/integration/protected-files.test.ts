import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ProtectedFiles } from "../../apps/desktop/src/main/identity/protected-files";

const fault = vi.hoisted(() => ({
  phase: "",
  published: false,
  events: [] as string[],
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args);
      const temporary = args[1] === "wx";
      return new Proxy(file, {
        get(target, key) {
          if (key === "sync")
            return async () => {
              const phase = temporary ? "file-sync" : "directory-sync";
              fault.events.push(phase);
              if (fault.phase === phase && (temporary || fault.published))
                throw Error("Injected flush failure");
              return target.sync();
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      fault.events.push("rename");
      if (fault.phase === "rename") throw Error("Injected publication failure");
      await fs.rename(...args);
      fault.published = true;
    },
  };
});
const directories: string[] = [];
afterEach(async () => {
  fault.phase = "";
  fault.published = false;
  fault.events = [];
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "suite-protected-files-"));
  directories.push(dir);
  const keys = new Map([
    [1, randomBytes(32)],
    [2, randomBytes(32)],
  ]);
  let generation = 1,
    available = true;
  const host = {
    available: () => available,
    encrypt: vi.fn(async (text: string) => {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", keys.get(generation)!, iv);
      const payload = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([
        Buffer.from([generation]),
        iv,
        cipher.getAuthTag(),
        payload,
      ]);
    }),
    decrypt: vi.fn(async (bytes: Buffer) => {
      const key = keys.get(bytes[0]);
      if (!key) throw Error("Old provider key retired");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(1, 13),
      );
      cipher.setAuthTag(bytes.subarray(13, 29));
      return {
        result: Buffer.concat([
          cipher.update(bytes.subarray(29)),
          cipher.final(),
        ]).toString(),
        shouldReEncrypt: bytes[0] !== generation,
      };
    }),
  };
  const store = () => new ProtectedFiles(() => dir, host);
  return {
    dir,
    host,
    store,
    rotate: () => {
      generation = 2;
    },
    retire: () => keys.delete(1),
    unavailable: () => {
      available = false;
    },
  };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

it("renews the provider envelope without changing the database key, and a fresh owner reads it after old-provider-key retirement", async () => {
  const f = await fixture(),
    store = f.store();
  const key = randomBytes(32).toString("base64");
  await store.write("cache-secret", key);
  f.rotate();
  fault.events = [];
  fault.published = false;
  expect(await store.read("cache-secret")).toBe(key);
  const bytes = await readFile(join(f.dir, "cache-secret.bin"));
  expect(bytes[0]).toBe(2);
  expect(bytes.includes(Buffer.from(key))).toBe(false);
  expect(fault.events.indexOf("file-sync")).toBeLessThan(
    fault.events.indexOf("rename"),
  );
  if (process.platform !== "win32")
    expect(fault.events.at(-1)).toBe("directory-sync");
  f.retire();
  expect(await f.store().read("cache-secret")).toBe(key);
});

it.each([
  "file-sync",
  "rename",
  ...(process.platform === "win32" ? [] : ["directory-sync"]),
])(
  "retains a complete readable envelope and rejects acknowledgement after %s failure",
  async (phase) => {
    const f = await fixture(),
      store = f.store();
    await store.write("credentials", { refreshToken: "original token" });
    fault.phase = phase;
    fault.published = false;
    await expect(
      store.write("credentials", { refreshToken: "new token" }),
    ).rejects.toThrow("Injected");
    fault.phase = "";
    expect(await f.store().read("credentials")).toEqual({
      refreshToken: phase === "directory-sync" ? "new token" : "original token",
    });
    expect(await readdir(f.dir)).toEqual(["credentials.bin"]);
  },
);

it("a delayed renewal cannot overwrite a later write or resurrect a removed credential", async () => {
  const f = await fixture(),
    store = f.store();
  await store.write("credentials", { refreshToken: "old" });
  f.rotate();
  const started = gate(),
    resume = gate();
  const decrypt = f.host.decrypt.getMockImplementation()!;
  f.host.decrypt.mockImplementationOnce(async (bytes) => {
    started.resolve();
    await resume.promise;
    return decrypt(bytes);
  });
  const reading = store.read("credentials");
  await started.promise;
  const writing = store.write("credentials", { refreshToken: "current" });
  resume.resolve();
  await reading;
  await writing;
  expect(await store.read("credentials")).toEqual({ refreshToken: "current" });

  const entered = gate(),
    release = gate();
  f.host.decrypt.mockImplementationOnce(async (bytes) => {
    entered.resolve();
    await release.promise;
    return { ...(await decrypt(bytes)), shouldReEncrypt: true };
  });
  const delayed = store.read("credentials");
  await entered.promise;
  const removal = store.remove("credentials");
  release.resolve();
  await delayed;
  await removal;
  expect(await f.store().read("credentials")).toBeUndefined();
  expect(await readdir(f.dir)).toEqual([]);
});

it("failed provider renewal and lost protection preserve the prior encrypted file", async () => {
  const f = await fixture(),
    store = f.store();
  await store.write("cache-secret", "retained key");
  const before = await readFile(join(f.dir, "cache-secret.bin"));
  f.rotate();
  f.host.encrypt.mockRejectedValueOnce(Error("Provider unavailable"));
  await expect(store.read("cache-secret")).rejects.toThrow(
    "Provider unavailable",
  );
  expect(await readFile(join(f.dir, "cache-secret.bin"))).toEqual(before);
  const encrypt = f.host.encrypt.getMockImplementation()!;
  f.host.encrypt.mockImplementationOnce(async (value) => {
    const bytes = await encrypt(value);
    f.unavailable();
    return bytes;
  });
  await expect(store.read("cache-secret")).rejects.toThrow(
    "Protected storage is unavailable",
  );
  expect(await readFile(join(f.dir, "cache-secret.bin"))).toEqual(before);
});

it("invalid decrypted content is retained without disclosure or renewal; traversal is rejected", async () => {
  const f = await fixture(),
    store = f.store();
  const bytes = await f.host.encrypt("not-json-private-token");
  await writeFile(join(f.dir, "credentials.bin"), bytes);
  f.rotate();
  await expect(store.read("credentials")).rejects.toThrow(
    "The protected record is invalid",
  );
  expect(await readFile(join(f.dir, "credentials.bin"))).toEqual(bytes);
  for (const key of ["../outside", "/absolute", "a//b", "a/../b", "a\\b"])
    await expect(store.read(key)).rejects.toThrow(
      "Invalid protected storage key",
    );
  expect(await store.read("account/workspace/missing")).toBeUndefined();
});

it("reads legacy scoped files without renewing them during workspace retirement", async () => {
  const f = await fixture(),
    store = f.store();
  const name = "account/workspace/identity";
  await store.write(name, { name: "Retained legacy record" });
  const before = await readFile(join(f.dir, `${name}.bin`));
  f.rotate();
  expect(await store.read(name, { renew: false })).toEqual({
    name: "Retained legacy record",
  });
  expect(await readFile(join(f.dir, `${name}.bin`))).toEqual(before);
});

it.skipIf(process.platform === "win32")(
  "retries a failed deletion flush even when the credential file is already absent",
  async () => {
    const f = await fixture(),
      store = f.store();
    await store.write("credentials", { refreshToken: "removed" });
    fault.phase = "directory-sync";
    fault.published = true;
    await expect(store.remove("credentials")).rejects.toThrow(
      "Injected flush failure",
    );
    expect(await readdir(f.dir)).toEqual([]);
    fault.phase = "";
    fault.events = [];
    await store.remove("credentials");
    expect(fault.events).toContain("directory-sync");
    expect(await f.store().read("credentials")).toBeUndefined();
  },
);
