import { createServer } from "node:http";
import { watch } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ClientBundles } from "@suite/module-sdk/client-artifact";
import { buildDevAssets } from "./build";
import type { DevAction, DevState, WorkerResponse } from "./contracts";

export async function startModuleDev(
  directory: string,
  port = 4321,
  dependencies: string[] = [],
) {
  if (process.env.NODE_ENV === "production")
    throw Error("The module simulator is a development-only tool.");
  const assets = await buildDevAssets();
  let revision = randomUUID(),
    state: DevState | undefined,
    bundles: ClientBundles = {};
  let status: "building" | "ready" | "error" = "building",
    error: string | undefined;
  let child: ChildProcess | undefined,
    closed = false,
    sequence = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined,
    startup: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: Extract<WorkerResponse, { type: "response" }>): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const stopWorker = () => {
    clearTimeout(startup);
    child?.kill("SIGKILL");
    child = undefined;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        Object.assign(
          Error(
            "The simulation restarted. Reload the current module before retrying.",
          ),
          { status: 409 },
        ),
      );
    }
    pending.clear();
  };
  const failed = (message: string) => {
    status = "error";
    error = message;
    state = undefined;
    bundles = {};
    stopWorker();
  };
  const rebuild = () => {
    if (closed) return;
    stopWorker();
    revision = randomUUID();
    status = "building";
    error = undefined;
    state = undefined;
    bundles = {};
    const worker = fork(
      fileURLToPath(new URL("worker.ts", import.meta.url)),
      [directory, ...dependencies],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    child = worker;
    let diagnostic = "";
    worker.stderr?.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-16000);
    });
    // Keep authored development logs visible without filling an unconsumed pipe.
    worker.stdout?.pipe(process.stdout, { end: false });
    startup = setTimeout(() => {
      if (child === worker)
        failed(
          "Module build exceeded 120 seconds. Check the module's top-level code.",
        );
    }, 120_000);
    worker.on("message", (message: WorkerResponse) => {
      if (child !== worker) return;
      if (message.type === "error") {
        failed(message.message);
        return;
      }
      if (message.type === "ready") {
        clearTimeout(startup);
        bundles = message.bundles;
        state = {
          ...message.snapshot,
          module: message.module,
          revision,
          status: "ready",
          views: Object.fromEntries(
            Object.entries(bundles).map(([name, bundle]) => [
              name,
              { css: bundle.css },
            ]),
          ),
        };
        status = "ready";
      }
      if (message.type === "response") {
        if (state) state = { ...state, ...message.snapshot };
        const request = pending.get(message.id);
        if (request) {
          clearTimeout(request.timer);
          pending.delete(message.id);
          request.resolve(message);
        }
      }
    });
    worker.on("error", (error) => {
      if (child === worker) failed(error.message);
    });
    worker.on("exit", (code) => {
      if (child === worker && !closed)
        failed(`Module simulator stopped (${code}). ${diagnostic}`);
    });
  };
  const watchers = [...new Set([directory, ...dependencies])].map((path) => {
    const watcher = watch(path, { recursive: true }, (_event, filename) => {
      if (
        !filename ||
        /(^|[/\\])(node_modules|dist|\.git|\.local)([/\\]|$)/.test(
          filename.toString(),
        )
      )
        return;
      if (!/\.(?:[cm]?[jt]sx?|css|json)$/.test(filename.toString())) return;
      // Invalidate the old code as soon as a change is observed; debounce the rebuild only.
      stopWorker();
      status = "building";
      state = undefined;
      bundles = {};
      revision = randomUUID();
      clearTimeout(debounce);
      debounce = setTimeout(rebuild, 150);
    });
    watcher.on("error", (error) =>
      failed(`Module source watcher failed: ${error.message}`),
    );
    return watcher;
  });
  let origin = "";
  const http = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    );
    const json = (code: number, value: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      json(403, {
        message: "This simulator only accepts its own local origin.",
      });
      return;
    }
    const url = new URL(req.url ?? "/", origin);
    try {
      if (req.method === "GET") {
        if (url.pathname === "/state") {
          json(200, state ?? { status, revision, error });
          return;
        }
        const asset = assets.get(url.pathname);
        if (asset) {
          res.writeHead(200, { "Content-Type": asset.type });
          res.end(asset.content);
          return;
        }
        const view = url.pathname.match(
          /^\/views\/([a-z][a-z0-9-]*)\.js$/,
        )?.[1];
        if (
          view &&
          status === "ready" &&
          url.searchParams.get("revision") === revision &&
          Object.hasOwn(bundles, view)
        ) {
          res.writeHead(200, { "Content-Type": "text/javascript" });
          res.end(bundles[view].javascript);
          return;
        }
      }
      if (req.method !== "POST" || url.pathname !== "/action") {
        json(404, { message: "Not found." });
        return;
      }
      if (!state || status !== "ready" || !child) {
        json(503, {
          message:
            "The module is not ready. Fix the build diagnostics before retrying.",
        });
        return;
      }
      if (req.headers["x-module-dev-revision"] !== revision) {
        json(409, {
          message:
            "This page uses an earlier module build. Reload before retrying.",
        });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) {
          json(413, { message: "Simulation input exceeds 64 KB." });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const action = JSON.parse(Buffer.concat(chunks).toString()) as DevAction;
      // The body may have arrived while a source change restarted the worker.
      if (!child || req.headers["x-module-dev-revision"] !== revision) {
        json(409, {
          message:
            "The module changed while this request arrived. Reload before retrying.",
        });
        return;
      }
      const id = ++sequence;
      const response = await new Promise<
        Extract<WorkerResponse, { type: "response" }>
      >((resolve, reject) => {
        const timer = setTimeout(
          () =>
            failed(
              "A simulated request exceeded 30 seconds. Edit a source file to restart the module.",
            ),
          30_000,
        );
        pending.set(id, { resolve, reject, timer });
        child!.send({ id, action }, (error) => {
          if (error) failed(error.message);
        });
      });
      if (response.error) {
        json(response.error.status, response.error);
        return;
      }
      json(200, { result: response.result, ...state });
    } catch (error) {
      const e = error as { status?: number; message?: string };
      json(e.status ?? 400, {
        message: e.message ?? "Simulation request failed.",
      });
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    rebuild();
  } catch (error) {
    watchers.forEach((watcher) => watcher.close());
    stopWorker();
    throw error;
  }
  return {
    origin,
    async close() {
      closed = true;
      clearTimeout(debounce);
      watchers.forEach((watcher) => watcher.close());
      stopWorker();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
