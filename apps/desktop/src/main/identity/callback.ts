import { createServer } from "node:http";

/** One loopback attempt owns one callback, including timeout and cancellation. */
export async function nativeLoginCallback(options: {
  callback: URL;
  state: string;
  signal: AbortSignal;
  timeoutMs?: number;
  open(signal: AbortSignal): Promise<void>;
  exchange(url: URL, signal: AbortSignal): Promise<void>;
}) {
  const { callback } = options;
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    !callback.port
  )
    throw Error("Use a registered 127.0.0.1 callback with a fixed port.");
  options.signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const controller = new AbortController();
    let finished = false,
      exchanging = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", cancel);
      if (error) controller.abort(error);
      server.close();
      if (error) server.closeAllConnections();
      error ? reject(error) : resolve();
    };
    const cancel = () =>
      finish(options.signal.reason ?? Error("Sign-in cancelled."));
    const server = createServer((req, res) => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", callback);
      } catch {
        res.writeHead(400);
        res.end("Invalid callback");
        return;
      }
      if (
        req.method !== "GET" ||
        url.origin !== callback.origin ||
        url.pathname !== callback.pathname ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== options.state
      ) {
        res.writeHead(400);
        res.end("Invalid callback");
        return;
      }
      if (finished || exchanging) {
        res.writeHead(409);
        res.end("This sign-in callback is already being processed.");
        return;
      }
      exchanging = true;
      void (async () => {
        try {
          controller.signal.throwIfAborted();
          await options.exchange(url, controller.signal);
          controller.signal.throwIfAborted();
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Security-Policy": "default-src 'none'",
          });
          res.end("<h1>Signed in</h1><p>You can return to Common.</p>");
          finish();
        } catch (error) {
          if (!res.destroyed) {
            res.writeHead(400);
            res.end("Sign-in failed. Return to Common and try again.");
          }
          finish(error);
        }
      })();
    });
    const timer = setTimeout(
      () => finish(Error("Sign-in timed out. Try again.")),
      options.timeoutMs ?? 180000,
    );
    options.signal.addEventListener("abort", cancel, { once: true });
    server.once("error", (error) =>
      finish(
        new Error(
          `Unable to open the registered login callback: ${error.message}`,
        ),
      ),
    );
    server.listen(Number(callback.port), "127.0.0.1", () => {
      if (finished) {
        server.close();
        return;
      }
      void options.open(controller.signal).catch(finish);
    });
  });
}
