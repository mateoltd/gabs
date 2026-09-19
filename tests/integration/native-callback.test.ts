import { expect, it } from "vitest";
import { createServer } from "node:http";
import { nativeLoginCallback } from "../../apps/desktop/src/main/identity/callback";
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function callbackUrl() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing local callback port");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return new URL(`http://127.0.0.1:${address.port}/callback`);
}
it("the real loopback listener rejects wrong/duplicate state and exchanges one callback only", async () => {
  const callback = await callbackUrl(),
    ready = gate(),
    entered = gate(),
    release = gate(),
    controller = new AbortController();
  let exchanges = 0;
  const attempt = nativeLoginCallback({
    callback,
    state: "expected",
    signal: controller.signal,
    open: async () => ready.resolve(),
    exchange: async () => {
      exchanges++;
      entered.resolve();
      await release.promise;
    },
  });
  try {
    await ready.promise;
    expect((await fetch(`${callback}?state=wrong`)).status).toBe(400);
    expect(
      (await fetch(`${callback}?state=expected&state=expected`)).status,
    ).toBe(400);
    expect(
      (await fetch(`${callback}?state=expected`, { method: "POST" })).status,
    ).toBe(400);
    const first = fetch(`${callback}?state=expected&code=accepted`);
    await entered.promise;
    expect(
      (await fetch(`${callback}?state=expected&code=duplicate`)).status,
    ).toBe(409);
    release.resolve();
    expect((await first).status).toBe(200);
    await attempt;
    expect(exchanges).toBe(1);
  } finally {
    controller.abort();
    release.resolve();
    await attempt.catch(() => {});
  }
});
for (const reason of ["timeout", "logout"] as const)
  it(`a ${reason} cancels a held exchange and prevents late activation`, async () => {
    const callback = await callbackUrl(),
      ready = gate(),
      entered = gate(),
      release = gate(),
      finished = gate(),
      controller = new AbortController();
    let activated = false;
    const attempt = nativeLoginCallback({
      callback,
      state: "expected",
      signal: controller.signal,
      timeoutMs: reason === "timeout" ? 100 : 10000,
      open: async () => ready.resolve(),
      exchange: async (_url, signal) => {
        entered.resolve();
        try {
          await release.promise;
          signal.throwIfAborted();
          activated = true;
        } finally {
          finished.resolve();
        }
      },
    });
    const rejection = expect(attempt).rejects.toThrow(
      reason === "timeout" ? "timed out" : "Signed out",
    );
    try {
      await ready.promise;
      const request = fetch(`${callback}?state=expected&code=held`).catch(
        () => undefined,
      );
      await entered.promise;
      if (reason === "logout") controller.abort(Error("Signed out"));
      await rejection;
      release.resolve();
      await finished.promise;
      await request;
      expect(activated).toBe(false);
      // The cancelled attempt releases its registered port for the next sign-in.
      const next = new AbortController(),
        reopened = gate();
      const retry = nativeLoginCallback({
        callback,
        state: "new",
        signal: next.signal,
        open: async () => reopened.resolve(),
        exchange: async () => {},
      });
      await reopened.promise;
      expect((await fetch(`${callback}?state=new&code=fresh`)).status).toBe(
        200,
      );
      await retry;
    } finally {
      controller.abort();
      release.resolve();
      await attempt.catch(() => {});
    }
  });
it("browser-launch failure closes the listener and rejects the sign-in", async () => {
  const callback = await callbackUrl();
  await expect(
    nativeLoginCallback({
      callback,
      state: "expected",
      signal: new AbortController().signal,
      open: async () => {
        throw Error("Browser unavailable");
      },
      exchange: async () => {},
    }),
  ).rejects.toThrow("Browser unavailable");
});
