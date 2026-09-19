import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type * as Vault from "../../packages/client/src/identity/local-vault";
import type * as Unlock from "../../packages/client/src/identity/local-vault/unlock";
type Harness = typeof Vault & typeof Unlock;
let browser: Browser, server: Server, origin: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import * as vault from './packages/client/src/identity/local-vault';import * as unlock from './packages/client/src/identity/local-vault/unlock'; window.vault={...vault,...unlock};`,
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
