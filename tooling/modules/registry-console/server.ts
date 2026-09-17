import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, relative, sep } from "node:path";
import type { Pool } from "pg";
import { assertSchema, Type } from "@suite/module-sdk";
import type { SignedPackage } from "@suite/module-sdk/node/signing";
import type { ServerPackage } from "@suite/module-sdk/node/server-package";
import type { InstalledModuleServer } from "@suite/server-core/runtime/services";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../registry-review";
import { ReviewAction } from "./contracts";
const secret = () => randomBytes(32).toString("base64url");
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024)
      throw new HttpError(413, "Packages exceed the 16 MB upload limit.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
  } catch {
    throw new HttpError(400, "Supply valid JSON.");
  }
}
const summaryColumns =
  "id,module_id,version,publisher_id,state,backend_kind,submitted_by,submitted_at,reviewed_by,reviewed_at,review_reason,staged_at,staged_by,client_package->>'digest' as client_digest,server_package->>'digest' as server_digest";
export async function startRegistryConsole(options: {
  pool: Pool;
  publicKey: string;
  assets: string;
  port?: number;
  builtins?: readonly InstalledModuleServer[];
}) {
  const { pool, publicKey } = options;
  const identity = await pool.query<{ actor: string; allowed: boolean }>(
    "select session_user as actor, pg_has_role(current_user,'suite_registry','USAGE') as allowed",
  );
  if (!identity.rows[0]?.allowed)
    throw Error(
      "The console requires a protected registry operator connection.",
    );
  const accessCode = secret();
  const sessions = new Map<
    string,
    { csrf: string; created: number; touched: number }
  >();
  let origin = "";
  let failedLogins = 0,
    failureWindow = Date.now();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new HttpError(403, "Use the console's own local address.");
      const url = new URL(req.url ?? "/", origin);
      if (req.method !== "GET" && req.headers.origin !== origin)
        throw new HttpError(403, "A same-origin request is required.");
      if (req.method === "POST" && url.pathname === "/api/session") {
        if (Date.now() - failureWindow > 60000) {
          failedLogins = 0;
          failureWindow = Date.now();
        }
        if (failedLogins >= 5)
          throw new HttpError(429, "Too many attempts. Try again in a minute.");
        const input = await body(req);
        assertSchema(
          Type.Object(
            { code: Type.String({ maxLength: 100 }) },
            { additionalProperties: false },
          ),
          input,
        );
        const supplied = Buffer.from(input.code),
          expected = Buffer.from(accessCode);
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          failedLogins++;
          throw new HttpError(401, "The console access code is incorrect.");
        }
        // One operator session; signing in again revokes a previous browser session.
        sessions.clear();
        const token = secret(),
          csrf = secret();
        sessions.set(token, { csrf, created: Date.now(), touched: Date.now() });
        res.setHeader(
          "Set-Cookie",
          `registry_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        json(200, { actor: identity.rows[0].actor, csrf });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const token =
          req.headers.cookie
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("registry_session="))
            ?.slice("registry_session=".length) ?? "";
        const session = sessions.get(token),
          now = Date.now();
        if (
          !session ||
          now - session.created > 8 * 3600000 ||
          now - session.touched > 30 * 60000
        ) {
          sessions.delete(token);
          throw new HttpError(401, "Unlock the operator console to continue.");
        }
        session.touched = now;
        if (
          req.method !== "GET" &&
          req.headers["x-csrf-token"] !== session.csrf
        )
          throw new HttpError(403, "Refresh the console before trying again.");
        if (url.pathname === "/api/session") {
          if (req.method === "GET") {
            json(200, { actor: identity.rows[0].actor, csrf: session.csrf });
            return;
          }
          if (req.method === "DELETE") {
            sessions.delete(token);
            res.setHeader(
              "Set-Cookie",
              "registry_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            );
            json(200, { ok: true });
            return;
          }
        }
        if (url.pathname === "/api/submissions") {
          if (req.method === "GET") {
            const offset = Number(url.searchParams.get("offset") ?? 0);
            const state = url.searchParams.get("state") ?? "all";
            const search = url.searchParams.get("search") ?? "";
            if (
              !Number.isSafeInteger(offset) ||
              offset < 0 ||
              offset > 1000000 ||
              !["all", "pending", "approved", "rejected", "published"].includes(
                state,
              ) ||
              search.length > 100
            )
              throw new HttpError(400, "Invalid catalogue filter.");
            const result = await pool.query(
              `select ${summaryColumns} from suite.module_submissions where ($1='all' or state=$1) and module_id ilike $2 order by submitted_at desc,id desc limit 26 offset $3`,
              [state, `%${search}%`, offset],
            );
            json(200, {
              items: result.rows.slice(0, 25),
              next: result.rows.length > 25 ? offset + 25 : null,
            });
            return;
          }
          if (req.method === "POST") {
            const input = await body(req);
            assertSchema(
              Type.Object(
                {
                  client: Type.Object({}, { additionalProperties: true }),
                  server: Type.Union([
                    Type.Null(),
                    Type.Object({}, { additionalProperties: true }),
                  ]),
                },
                { additionalProperties: false },
              ),
              input,
            );
            const id = await submitRelease(
              pool,
              input.client as unknown as SignedPackage,
              input.server as unknown as ServerPackage | null,
              publicKey,
            );
            json(200, { id });
            return;
          }
        }
        const match = /^\/api\/submissions\/([0-9a-f-]{36})$/.exec(
          url.pathname,
        );
        if (match) {
          const id = match[1];
          if (req.method === "GET") {
            const row = (
              await pool.query(
                `select ${summaryColumns},client_package,server_package from suite.module_submissions where id=$1`,
                [id],
              )
            ).rows[0];
            if (!row) throw new HttpError(404, "Submission not found.");
            const events = await pool.query(
              "select id,actor,action,detail,created_at from suite.module_review_events where submission_id=$1 order by id",
              [id],
            );
            json(200, { ...row, events: events.rows });
            return;
          }
          if (req.method === "POST") {
            const input = await body(req);
            assertSchema(ReviewAction, input);
            if (input.action === "approve" || input.action === "reject")
              await reviewRelease(
                pool,
                id,
                input.action === "approve" ? "approved" : "rejected",
                input.reason,
                publicKey,
              );
            else if (input.action === "stage")
              await stageRelease(pool, id, publicKey, options.builtins);
            else await publishRelease(pool, id, publicKey);
            json(200, { ok: true });
            return;
          }
        }
        throw new HttpError(404, "Not found.");
      }
      if (req.method !== "GET") throw new HttpError(404, "Not found.");
      const name =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      const asset = resolve(options.assets, name),
        traversal = relative(options.assets, asset);
      if (
        traversal.startsWith(`..${sep}`) ||
        traversal === ".." ||
        ![".html", ".js", ".css", ".woff2", ".woff"].includes(extname(asset))
      )
        throw new HttpError(404, "Not found.");
      let bytes: Buffer;
      try {
        bytes = await readFile(asset);
      } catch {
        throw new HttpError(404, "Not found.");
      }
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      };
      res.writeHead(200, { "Content-Type": types[extname(asset)] });
      res.end(bytes);
    } catch (error) {
      const e = error as Error & { code?: string };
      json(error instanceof HttpError ? error.status : 400, {
        message:
          e.code && /^\d/.test(e.code)
            ? "The registry rejected this change. Check the submission state and operator permissions."
            : (e.message ?? "The registry could not process this request."),
      });
    }
  });
  server.requestTimeout = 30000;
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4322, "127.0.0.1", () => accept());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Console did not bind a local port.");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    accessCode,
    close: () =>
      new Promise<void>((accept, reject) => {
        sessions.clear();
        server.close((error) => (error ? reject(error) : accept()));
        server.closeIdleConnections();
      }),
  };
}
