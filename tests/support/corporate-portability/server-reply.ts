import { expect, type ElectronApplication, type Page } from "@playwright/test";

export interface ReplyGate {
  arrived(): Promise<void>;
  release(): Promise<void>;
  dispose(): Promise<void>;
}
interface NativeGate {
  arrived: boolean;
  done: boolean;
  release(): void;
  dispose(): void;
}

/** Hold an actual authenticated server response; do not fabricate its proof or body. */
export async function holdServerReply(
  page: Page,
  path: string,
  app?: ElectronApplication,
  options: { method?: string; requestId?: string } = {},
): Promise<ReplyGate> {
  if (app) {
    const child = app.process();
    await app.evaluate(
      (_, { path, method, requestId }) => {
        const root = globalThis as typeof globalThis & {
          serverReplyGate?: NativeGate;
        };
        const original = globalThis.fetch;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const gate: NativeGate = {
          arrived: false,
          done: false,
          release,
          dispose: () => {
            globalThis.fetch = original;
            release();
          },
        };
        root.serverReplyGate = gate;
        globalThis.fetch = async (...args) => {
          const response = await original(...args);
          if (
            !gate.arrived &&
            new URL(response.url).pathname === path &&
            (!method || args[1]?.method === method) &&
            (!requestId ||
              new Headers(args[1]?.headers).get("idempotency-key") ===
                requestId)
          ) {
            gate.arrived = true;
            try {
              await held;
            } finally {
              gate.done = true;
              globalThis.fetch = original;
            }
          }
          return response;
        };
      },
      { path, method: options.method, requestId: options.requestId },
    );
    return {
      dispose: async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await app.evaluate(() =>
          (
            globalThis as typeof globalThis & { serverReplyGate?: NativeGate }
          ).serverReplyGate?.dispose(),
        );
      },
      arrived: async () => {
        await expect
          .poll(() =>
            app.evaluate(
              () =>
                (
                  globalThis as typeof globalThis & {
                    serverReplyGate?: NativeGate;
                  }
                ).serverReplyGate?.arrived,
            ),
          )
          .toBe(true);
      },
      release: async () => {
        await app.evaluate(() =>
          (
            globalThis as typeof globalThis & { serverReplyGate?: NativeGate }
          ).serverReplyGate?.release(),
        );
        await expect
          .poll(() =>
            app.evaluate(
              () =>
                (
                  globalThis as typeof globalThis & {
                    serverReplyGate?: NativeGate;
                  }
                ).serverReplyGate?.done,
            ),
          )
          .toBe(true);
      },
    };
  }
  let arrived = false;
  let release!: () => void, done!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });
  const pattern = `**${path}`;
  await page.route(pattern, async (route) => {
    if (options.method && route.request().method() !== options.method)
      return route.continue();
    if (
      options.requestId &&
      route.request().headers()["idempotency-key"] !== options.requestId
    )
      return route.continue();
    try {
      const response = await route.fetch();
      arrived = true;
      await held;
      await route.fulfill({ response }).catch(() => {});
    } finally {
      done();
    }
  });
  return {
    dispose: async () => {
      release();
      if (!page.isClosed()) await page.unroute(pattern);
    },
    arrived: async () => {
      await expect.poll(() => arrived, { timeout: 15000 }).toBe(true);
    },
    release: async () => {
      release();
      await finished;
    },
  };
}
