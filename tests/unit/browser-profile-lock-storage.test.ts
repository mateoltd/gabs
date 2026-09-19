import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { createBrowserProfileLock } from "../../packages/client/src/adapters/browser-profile-lock";

type Harness = {
  create: typeof createBrowserProfileLock;
  profile: ReturnType<typeof createBrowserProfileLock>;
  observed?: Awaited<
    ReturnType<
      ReturnType<typeof createBrowserProfileLock>["lock"]["profileLockStatus"]
    >
  >;
};
const account = "11111111-1111-4111-8111-111111111111";
let browser: Browser, server: Server, origin: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import {createBrowserProfileLock} from './packages/client/src/adapters/browser-profile-lock'; window.create = createBrowserProfileLock;`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  server = createServer((request, response) => {
    if (request.url === "/lock.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles[0]!.text);
    } else {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><title>Browser lock persistence acceptance</title><script src="/lock.js"></script>',
      );
    }
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
async function activate(page: Page) {
  await page.goto(origin);
  await page.evaluate(async (id) => {
    const host = window as unknown as Harness;
    host.profile = host.create();
    host.profile.lock.onProfileLock((status) => {
      host.observed = status;
    });
    await host.profile.lock.activate(id);
  }, account);
}
it("uses real IndexedDB to retain PIN policy across reloads and broadcasts locks to other tabs", async () => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage(),
      second = await context.newPage();
    await activate(first);
    await first.evaluate(() =>
      (window as unknown as Harness).profile.lock.configureProfileLock(
        "12567890",
        false,
      ),
    );
    await activate(second);
    expect(
      await second.evaluate(() =>
        (window as unknown as Harness).profile.lock.profileLockStatus(),
      ),
    ).toMatchObject({ locked: true });
    await second.evaluate(() =>
      (window as unknown as Harness).profile.lock.unlockProfile(
        "pin",
        "12567890",
      ),
    );
    await first.evaluate(() =>
      (window as unknown as Harness).profile.lock.lockProfile(),
    );
    await expect
      .poll(() =>
        second.evaluate(() => (window as unknown as Harness).observed),
      )
      .toMatchObject({ locked: true });
    await activate(first);
    expect(
      await first.evaluate(() =>
        (window as unknown as Harness).profile.lock.profileLockStatus(),
      ),
    ).toMatchObject({ enabled: true, locked: true });
    await first.evaluate(() =>
      (window as unknown as Harness).profile.lock.unlockProfile(
        "pin",
        "12567890",
      ),
    );
    await first.evaluate(async (id) => {
      await (
        await (window as unknown as Harness).profile.lock.access(id)
      )();
    }, account);
  } finally {
    await context.close();
  }
});
it("serializes attempts from real tabs, preserves their delay after reload and refuses offline recovery", async () => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage(),
      second = await context.newPage();
    await activate(first);
    await first.evaluate(() =>
      (window as unknown as Harness).profile.lock.configureProfileLock(
        "12567890",
        false,
      ),
    );
    await first.evaluate(() =>
      (window as unknown as Harness).profile.lock.lockProfile(),
    );
    await activate(second);
    const attempt = (page: Page) =>
      page.evaluate(async () => {
        try {
          await (window as unknown as Harness).profile.lock.unlockProfile(
            "pin",
            "00000000",
          );
          return "unexpected success";
        } catch (error) {
          return (error as Error).message;
        }
      });
    expect(
      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          attempt(index % 2 ? first : second),
        ),
      ),
    ).toEqual(Array(5).fill("The device PIN is incorrect."));
    await activate(first);
    expect(
      await first.evaluate(async () => {
        try {
          await (window as unknown as Harness).profile.lock.unlockProfile(
            "pin",
            "12567890",
          );
          return "unexpected success";
        } catch (error) {
          return (error as Error).message;
        }
      }),
    ).toContain("Wait");
    await context.setOffline(true);
    expect(
      await first.evaluate(async () => {
        try {
          await (window as unknown as Harness).profile.lock.beginRecovery();
          return "unexpected success";
        } catch {
          return "recovery unavailable";
        }
      }),
    ).toBe("recovery unavailable");
    expect(
      await first.evaluate(() =>
        (window as unknown as Harness).profile.lock.profileLockStatus(),
      ),
    ).toMatchObject({ locked: true, enabled: true, canRecover: false });
  } finally {
    await context.close();
  }
});
