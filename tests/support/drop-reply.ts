import type { ElectronApplication, Page } from "@playwright/test";

/** Lose one actual committed response, preserving the exact request for a UI retry. */
export async function dropAcceptedReply(
  page: Page,
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  app?: ElectronApplication,
) {
  if (app) {
    await app.evaluate(
      (_, { path, method }) => {
        const root = globalThis as typeof globalThis & {
          acceptedReplyTest?: { keys: string[]; restore(): void };
        };
        const original = globalThis.fetch;
        const keys: string[] = [];
        root.acceptedReplyTest = {
          keys,
          restore: () => {
            globalThis.fetch = original;
          },
        };
        globalThis.fetch = async (...args) => {
          const response = await original(...args);
          if (
            new URL(response.url).pathname === path &&
            args[1]?.method === method
          ) {
            keys.push(
              new Headers(args[1]?.headers).get("idempotency-key") ?? "",
            );
            if (keys.length === 1 && response.ok) {
              await response.arrayBuffer();
              throw new Error("Response was lost after server acceptance");
            }
          }
          return response;
        };
      },
      { path, method },
    );
    return {
      keys: () =>
        app.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                acceptedReplyTest?: { keys: string[] };
              }
            ).acceptedReplyTest!.keys,
        ),
      close: () =>
        app.evaluate(() =>
          (
            globalThis as typeof globalThis & {
              acceptedReplyTest?: { restore(): void };
            }
          ).acceptedReplyTest?.restore(),
        ),
    };
  }
  const keys: string[] = [];
  const pattern = `**${path}`;
  await page.route(pattern, async (route) => {
    if (route.request().method() !== method) return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    const response = await route.fetch();
    if (keys.length === 1 && response.ok()) await route.abort("failed");
    else await route.fulfill({ response });
  });
  return { keys: async () => keys, close: () => page.unroute(pattern) };
}
