import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type * as Runtime from "../../packages/shell/src/app/runtime";

type Harness = { runtime: typeof Runtime; pending?: Promise<string> };
const account = "11111111-1111-4111-8111-111111111111";
let browser: Browser, server: Server, origin: string;
let reads = 0,
  hold: Promise<void> | undefined;
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import * as runtime from './packages/shell/src/app/runtime'; window.runtime = runtime;`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  server = createServer(async (request, response) => {
    if (request.url?.startsWith("/api/")) {
      response.setHeader("content-type", "application/json");
      response.setHeader("x-suite-actor", account);
      if (request.url === "/api/v1/me")
        response.end(
          JSON.stringify({ user: { id: account }, csrfToken: "session" }),
        );
      else {
        reads++;
        await hold;
        response.end(JSON.stringify({ secret: "company response" }));
      }
    } else if (request.url === "/runtime.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles[0]!.text);
    } else {
      response.setHeader("content-type", "text/html");
      response.end(
        '<!doctype html><title>Browser access boundary</title><script src="/runtime.js"></script>',
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
it("enforces the actual shell client and cache boundaries and withholds responses completed after locking", async () => {
  const context = await browser.newContext();
  let release!: () => void;
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => {
      const { client, profileLock, profileLockReady } = (
        window as unknown as Harness
      ).runtime;
      await profileLockReady;
      await client.request({ operation: "me" });
      await profileLock.configureProfileLock("12567890", false);
    });
    await page.evaluate(async (id) => {
      const { platform } = (window as unknown as Harness).runtime;
      await platform.save({ userId: id, workspaceId: id }, "drafts", {
        captured: "retained work",
      });
    }, account);
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const before = reads;
    await page.evaluate((id) => {
      const host = window as unknown as Harness;
      host.pending = host.runtime.client
        .forUser(id)
        .request({ operation: "bootstrap", params: { workspaceId: id } })
        .then(
          () => "unexpected delivery",
          (error: { code: string }) => error.code,
        );
    }, account);
    await expect.poll(() => reads).toBe(before + 1);
    await page.evaluate(() =>
      (window as unknown as Harness).runtime.profileLock.lockProfile(),
    );
    release();
    hold = undefined;
    expect(
      await page.evaluate(() => (window as unknown as Harness).pending),
    ).toBe("PROFILE_LOCKED");
    expect(
      await page.evaluate(async (id) => {
        const { client, platform } = (window as unknown as Harness).runtime;
        const denied = async (action: () => Promise<unknown>) => {
          try {
            await action();
            return "unexpected access";
          } catch (error) {
            return (error as { code: string }).code;
          }
        };
        return Promise.all([
          denied(() => client.forUser(id).request({ operation: "me" })),
          denied(() =>
            client
              .forUser(id)
              .request({ operation: "bootstrap", params: { workspaceId: id } }),
          ),
          denied(() =>
            platform.load({ userId: id, workspaceId: id }, "drafts"),
          ),
          denied(() =>
            platform.save({ userId: id, workspaceId: id }, "drafts", {}),
          ),
          denied(() => platform.purgeUser(id)),
          denied(() =>
            platform.rememberIdentity({
              userId: id,
              workspaceId: id,
              name: "Locked profile",
            }),
          ),
        ]);
      }, account),
    ).toEqual(Array(6).fill("PROFILE_LOCKED"));
    expect(reads).toBe(before + 1);
    await page.evaluate(() =>
      (window as unknown as Harness).runtime.profileLock.unlockProfile(
        "pin",
        "12567890",
      ),
    );
    expect(
      await page.evaluate(
        (id) =>
          (window as unknown as Harness).runtime.platform.load(
            { userId: id, workspaceId: id },
            "drafts",
          ),
        account,
      ),
    ).toEqual({ captured: "retained work" });
  } finally {
    release?.();
    hold = undefined;
    await context.close();
  }
});
