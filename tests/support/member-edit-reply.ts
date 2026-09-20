import type { ElectronApplication, Page } from "@playwright/test";

/** Lose one actual committed response, preserving the exact request for a UI retry. */
export async function dropMemberReply(
  page: Page,
  path: string,
  app?: ElectronApplication,
) {
  if (app) {
    await app.evaluate((_, path) => {
      const root = globalThis as typeof globalThis & {
        memberReplyTest?: { keys: string[]; restore(): void };
      };
      const original = globalThis.fetch;
      const keys: string[] = [];
      root.memberReplyTest = {
        keys,
        restore: () => {
          globalThis.fetch = original;
        },
      };
      globalThis.fetch = async (...args) => {
        const response = await original(...args);
        if (
          new URL(response.url).pathname === path &&
          args[1]?.method === "PATCH"
        ) {
          keys.push(new Headers(args[1]?.headers).get("idempotency-key") ?? "");
          if (keys.length === 1 && response.ok) {
            await response.arrayBuffer();
            throw new Error("Member response was lost after server acceptance");
          }
        }
        return response;
      };
    }, path);
    return {
      keys: () =>
        app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                memberReplyTest?: { keys: string[] };
              }
            ).memberReplyTest!.keys,
        ),
      close: () =>
        app.evaluate(() =>
          (
            globalThis as typeof globalThis & {
              memberReplyTest?: { restore(): void };
            }
          ).memberReplyTest?.restore(),
        ),
    };
  }
  const keys: string[] = [];
  const pattern = `**${path}`;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    const response = await route.fetch();
    if (keys.length === 1 && response.ok()) await route.abort("failed");
    else await route.fulfill({ response });
  });
  return { keys: async () => keys, close: () => page.unroute(pattern) };
}
