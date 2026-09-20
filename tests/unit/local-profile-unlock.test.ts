import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type * as Vault from "../../packages/client/src/identity/local-vault";
import type * as Unlock from "../../packages/client/src/identity/local-vault/unlock";
import type * as Native from "../../packages/client/src/identity/local-vault/native";
import type {
  NativeVaultBridge,
  NativeVaultChange,
  OpenedNativeVault,
} from "../../packages/client/src/identity/local-vault/protocol";
type Harness = typeof Vault & typeof Unlock & typeof Native;
let browser: Browser, server: Server, origin: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import * as vault from './packages/client/src/identity/local-vault';import * as unlock from './packages/client/src/identity/local-vault/unlock'; import * as native from './packages/client/src/identity/local-vault/native'; window.vault={...vault,...unlock,...native};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  server = createServer((request, response) => {
    response.setHeader(
      "content-type",
      request.url === "/vault.js" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/vault.js"
        ? bundle.outputFiles[0].text
        : '<!doctype html><title>Local unlock acceptance</title><script src="/vault.js"></script>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
});

it("rejects an unlock reply overtaken by revocation and ignores replies from a retired utility session", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      const id = crypto.randomUUID();
      let change!: (event: NativeVaultChange) => void;
      let pending!: (opened: OpenedNativeVault) => void;
      let requested!: () => void;
      let defer = false;
      let session = "first-utility",
        generation = 2;
      const response = (): OpenedNativeVault => ({
        session,
        generation,
        handle: crypto.randomUUID(),
        profile: { id, name: "Protected" },
        revision: 0,
        data: { secret: "current work" },
      });
      const bridge: NativeVaultBridge = {
        request: (async (_request, action) => {
          if (action === "unlock") {
            if (defer)
              return new Promise<OpenedNativeVault>((resolve) => {
                pending = resolve;
                requested();
              });
            return response();
          }
        }) as NativeVaultBridge["request"],
        cancel: async () => {},
        subscribe: (listener) => {
          change = listener;
          return () => {};
        },
      };
      const provider = v.createNativeVaultProvider(bridge);
      const first = await provider.unlock(id, "long passphrase");
      const beginDelayed = async () => {
        defer = true;
        const started = new Promise<void>((resolve) => {
          requested = resolve;
        });
        const attempt = provider.unlock(id, "long passphrase").then(
          () => "accepted",
          (error: { code?: string }) => error.code,
        );
        await started;
        defer = false;
        return { attempt };
      };
      let delayed = await beginDelayed();
      const obsolete = response();
      generation = 3;
      change({ id, session, generation });
      pending(obsolete);
      const revokedReply = await delayed.attempt;
      const revokedDataCleared = first.data === undefined;

      const current = await provider.unlock(id, "long passphrase");
      delayed = await beginDelayed();
      const oldProcess = response();
      session = "restarted-utility";
      generation = 0;
      change({ id, session, generation });
      const restarted = await provider.unlock(id, "long passphrase");
      pending(oldProcess);
      const oldProcessReply = await delayed.attempt;
      change({ id, session: "first-utility", generation: 999 });
      await restarted.assert();
      const currentData = restarted.data;
      delayed = await beginDelayed();
      const beforeTermination = response();
      change({ closed: true, session });
      pending(beforeTermination);
      const terminatedReply = await delayed.attempt;
      return {
        revokedReply,
        revokedDataCleared,
        oldProcessReply,
        oldProcessDataCleared: current.data === undefined,
        currentData,
        terminatedReply,
        terminatedDataCleared: restarted.data === undefined,
      };
    });
    expect(result).toEqual({
      revokedReply: "PROFILE_LOCKED",
      revokedDataCleared: true,
      oldProcessReply: "PROFILE_LOCKED",
      oldProcessDataCleared: true,
      currentData: { secret: "current work" },
      terminatedReply: "PROFILE_LOCKED",
      terminatedDataCleared: true,
    });
  } finally {
    await context.close();
  }
});
afterAll(async () => {
  await browser?.close();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

it("wraps existing encrypted data, rejects wrong credentials and clears PIN on restored profiles", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      const pass = "original long passphrase";
      const created = await v.createVault("Private", pass, {
        secret: "retained work",
      });
      const id = created.vault.id;
      let wrong = false;
      try {
        await v.configureLocalUnlock(id, "wrong password", "12567890", false);
      } catch {
        wrong = true;
      }
      const before = await v.localUnlockStatus(id);
      await v.configureLocalUnlock(id, pass, "12567890", false);
      const pin = await v.unlockLocalVault<{ secret: string }>(
        id,
        "pin",
        "12567890",
      );
      let stale = false;
      try {
        await v.commitVault(
          created.vault,
          created.key,
          {},
          0,
          undefined,
          () => true,
        );
      } catch {
        stale = true;
      }
      await v.commitVault(
        pin.vault,
        pin.key,
        { secret: "PIN saved" },
        pin.vault.revision!,
        undefined,
        () => true,
      );
      const fallback = await v.unlockVault<{ secret: string }>(id, pass);
      const persisted = JSON.stringify(fallback.vault.unlock);
      await v.removeLocalProfile(id);
      await v.restoreVault(id, pass);
      let removed = false;
      try {
        await v.unlockLocalVault(id, "pin", "12567890");
      } catch {
        removed = true;
      }
      return {
        wrong,
        before: before.enabled,
        stale,
        extracted: pin.key.extractable,
        original: pin.data,
        fallback: fallback.data,
        leaked:
          persisted.includes(pass) ||
          persisted.includes("12567890") ||
          persisted.includes("retained work"),
        restored: await v.localUnlockStatus(id),
        removed,
      };
    });
    expect(result).toMatchObject({
      wrong: true,
      before: false,
      stale: true,
      extracted: false,
      original: { secret: "retained work" },
      fallback: { secret: "PIN saved" },
      leaked: false,
      restored: { enabled: false },
      removed: true,
    });
  } finally {
    await context.close();
  }
});

it("serializes attempts across tabs, retains limits through ordinary saves and reload, and recovers with a passphrase", async () => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage(),
      second = await context.newPage();
    await first.goto(origin);
    await second.goto(origin);
    const id = await first.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      const { vault } = await v.createVault(
        "Attempts",
        "original long passphrase",
        {},
      );
      await v.configureLocalUnlock(
        vault.id,
        "original long passphrase",
        "12567890",
        false,
      );
      return vault.id;
    });
    const attempt = (page: typeof first) =>
      page.evaluate(async (id) => {
        const v = (window as unknown as { vault: Harness }).vault;
        try {
          await v.unlockLocalVault(id, "pin", "00000000");
          return false;
        } catch {
          return true;
        }
      }, id);
    expect(
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => attempt(i % 2 ? first : second)),
      ),
    ).toEqual(Array(5).fill(true));
    const retry = await first.evaluate(async (id) => {
      const v = (window as unknown as { vault: Harness }).vault;
      const unlocked = await v.unlockVault(id, "original long passphrase");
      await v.commitVault(
        unlocked.vault,
        unlocked.key,
        { saved: true },
        unlocked.vault.revision!,
        undefined,
        () => true,
      );
      return (await v.localUnlockStatus(id)).retryAt;
    }, id);
    await first.reload();
    const result = await first.evaluate(
      async ({ id, retry }) => {
        const v = (window as unknown as { vault: Harness }).vault;
        let limited = false;
        try {
          await v.unlockLocalVault(id, "pin", "12567890");
        } catch (e) {
          limited = (e as Error).message.includes("Try again after");
        }
        const persisted = (await v.localUnlockStatus(id)).retryAt;
        await v.configureLocalUnlock(
          id,
          "original long passphrase",
          "87654321",
          false,
        );
        const recovered = await v.unlockLocalVault(id, "pin", "87654321");
        return { limited, retained: persisted === retry, data: recovered.data };
      },
      { id, retry },
    );
    expect(result).toEqual({
      limited: true,
      retained: true,
      data: { saved: true },
    });
  } finally {
    await context.close();
  }
});

it("rejects a delayed native biometric result after removal and rejects foreign or corrupt wrappers", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      const pass = "original long passphrase";
      let release!: () => void, entered!: () => void;
      let hold = false;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const protection: Unlock.LocalUnlockProtection = {
        status: async () => ({ available: true, biometric: true }),
        seal: async (binding, value) => JSON.stringify({ binding, value }),
        open: async (binding, sealed) => {
          if (hold) {
            entered();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          const stored = JSON.parse(sealed);
          if (JSON.stringify(binding) !== JSON.stringify(stored.binding))
            throw Error("Wrong binding");
          return stored.value;
        },
      };
      const a = await v.createVault("A", pass, {}),
        b = await v.createVault("B", pass, {});
      await v.configureLocalUnlock(
        a.vault.id,
        pass,
        "12567890",
        true,
        protection,
      );
      const enrolled = await v.unlockVault(a.vault.id, pass);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("suite-local-profiles");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction("vaults", "readwrite");
      tx.objectStore("vaults").put({
        ...b.vault,
        unlock: enrolled.vault.unlock,
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      let foreign = false;
      try {
        await v.unlockLocalVault(b.vault.id, "pin", "12567890", protection);
      } catch {
        foreign = true;
      }
      hold = true;
      const pending = v
        .unlockLocalVault(a.vault.id, "biometric", "", protection)
        .then(
          () => false,
          () => true,
        );
      await started;
      await v.removeLocalProfile(a.vault.id);
      await v.restoreVault(a.vault.id, pass);
      release();
      const stale = await pending;
      const corrupt = db.transaction("vaults", "readwrite");
      corrupt
        .objectStore("vaults")
        .put({ ...b.vault, unlock: { version: 999 } });
      await new Promise<void>((resolve) => {
        corrupt.oncomplete = () => resolve();
      });
      db.close();
      let damaged = false;
      try {
        await v.localUnlockStatus(b.vault.id);
      } catch {
        damaged = true;
      }
      await v.configureLocalUnlock(b.vault.id, pass, undefined, false);
      return {
        foreign,
        stale,
        damaged,
        repaired: !(await v.localUnlockStatus(b.vault.id)).enabled,
      };
    });
    expect(result).toEqual({
      foreign: true,
      stale: true,
      damaged: true,
      repaired: true,
    });
  } finally {
    await context.close();
  }
});

it("cancels enrollment before storage and prevents replay after a concurrent profile edit", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      const pass = "original long passphrase";
      const { vault, key } = await v.createVault("Cancellation", pass, {
        text: "original",
      });
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const protection: Unlock.LocalUnlockProtection = {
        status: async () => ({ available: true, biometric: false }),
        seal: async () => {
          entered();
          await wait;
          return "opaque native envelope";
        },
        open: async () => {
          throw Error("Not used");
        },
      };
      const controller = new AbortController();
      const pending = v
        .configureLocalUnlock(
          vault.id,
          pass,
          "12567890",
          false,
          protection,
          controller.signal,
        )
        .then(
          () => false,
          () => true,
        );
      await started;
      controller.abort();
      release();
      const cancelled = await pending;
      const unchanged = await v.unlockVault(vault.id, pass);
      // A normal commit after the passphrase read must win over stale enrollment.
      protection.seal = async () => {
        await v.commitVault(
          vault,
          key,
          { text: "newer" },
          0,
          undefined,
          () => true,
        );
        return "opaque native envelope";
      };
      const raced = await v
        .configureLocalUnlock(vault.id, pass, "12567890", false, protection)
        .then(
          () => false,
          () => true,
        );
      return {
        cancelled,
        revision: unchanged.vault.revision,
        raced,
        enabled: (await v.localUnlockStatus(vault.id)).enabled,
        data: (await v.unlockVault(vault.id, pass)).data,
      };
    });
    expect(result).toEqual({
      cancelled: true,
      revision: 0,
      raced: true,
      enabled: false,
      data: { text: "newer" },
    });
  } finally {
    await context.close();
  }
});

it("ignores delayed native creation events while applying later revocations to opaque grants", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      let change!: (event: NativeVaultChange) => void;
      const closed: string[] = [];
      const id = crypto.randomUUID(),
        handle = crypto.randomUUID();
      const bridge: NativeVaultBridge = {
        request: (async (_request, action, input) => {
          if (action === "create")
            return {
              session: "utility-one",
              generation: 7,
              handle,
              profile: { id, name: "New" },
              revision: 0,
              data: { records: {} },
            };
          if (action === "close")
            closed.push((input as { handle: string }).handle);
        }) as NativeVaultBridge["request"],
        cancel: async () => {},
        subscribe: (callback) => {
          change = callback;
          return () => {};
        },
      };
      const provider = v.createNativeVaultProvider(bridge);
      const notifications: boolean[] = [];
      provider.subscribe((_id, invalidate) => notifications.push(!!invalidate));
      const opened = await provider.create("New", "long passphrase", {
        records: {},
      });
      change({ id, session: "utility-one", generation: 7 });
      await opened.assert();
      const preserved = opened.data;
      change({ id, session: "utility-one", generation: 8 });
      let locked = false;
      try {
        await opened.assert();
      } catch {
        locked = true;
      }
      return {
        preserved,
        locked,
        cleared: opened.data === undefined,
        notifications,
        closed: closed.length,
      };
    });
    expect(result).toEqual({
      preserved: { records: {} },
      locked: true,
      cleared: true,
      notifications: [false, true],
      closed: 1,
    });
  } finally {
    await context.close();
  }
});

it("retains legacy IndexedDB vaults until native migration is fully acknowledged", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const v = (window as unknown as { vault: Harness }).vault;
      const password = "original encrypted vault passphrase";
      const original = await v.createVault("Retained", password, {
        note: "original work",
      });
      let stage = 0;
      const bridge: NativeVaultBridge = {
        request: (async (_request, action) => {
          if (action === "import") {
            if (stage === 0) throw Error("Protected storage is unavailable.");
            if (stage === 1) return [];
            return [original.vault.id];
          }
          return [{ id: original.vault.id, name: "Retained" }];
        }) as NativeVaultBridge["request"],
        cancel: async () => {},
        subscribe: () => () => {},
      };
      const provider = v.createNativeVaultProvider(bridge);
      const outcomes: unknown[] = [];
      for (; stage < 2; stage++) {
        try {
          await provider.list();
          outcomes.push("unexpected success");
        } catch {
          outcomes.push(
            (await v.unlockVault(original.vault.id, password)).data,
          );
        }
      }
      const migrated = await provider.list();
      return { outcomes, migrated, remaining: await v.listLocalProfiles() };
    });
    expect(result.outcomes).toEqual([
      { note: "original work" },
      { note: "original work" },
    ]);
    expect(result.migrated).toHaveLength(1);
    expect(result.remaining).toEqual([]);
  } finally {
    await context.close();
  }
});
