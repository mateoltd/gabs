import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { moduleDefinitions } from "@suite/module-catalog";
import { moduleServers } from "@suite/module-catalog/server";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import { assertSchema, Type, type ModuleCall } from "@suite/module-sdk";
const module = moduleDefinitions.find((m) => m.id === process.argv[2]);
if (!module) throw Error("Usage: pnpm module dev <discovered-module-id>");
if (process.env.NODE_ENV === "production")
  throw Error("The module simulator is a development-only tool.");
const port = Number(process.env.MODULE_DEV_PORT ?? 4321),
  origin = `http://127.0.0.1:${port}`;
let fixtures = {};
try {
  fixtures = JSON.parse(
    await readFile(`modules/${module.id}/fixtures.json`, "utf8"),
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const staged = moduleServers.find(
  (s) => s.module.id === module.id && s.module.version === module.version,
);
const simulator = createModuleSimulator(module, {
  fixtures,
  server: staged?.kind === "scoped" ? staged : undefined,
});
const revision = randomUUID();
const inputSchema = Type.Union([
  Type.Object(
    { action: Type.Literal("network"), online: Type.Boolean() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("permissions"),
      permissions: Type.Array(Type.String(), { maxItems: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("sync") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("submit"),
      call: Type.Object(
        {
          moduleId: Type.Literal(module.id),
          action: Type.Union(
            ["create", "update", "archive", "get", "list", "operation"].map(
              (v) => Type.Literal(v),
            ),
          ),
          resource: Type.Optional(Type.String()),
          operation: Type.Optional(Type.String()),
          key: Type.String({ maxLength: 128, minLength: 8 }),
          input: Type.Unknown(),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (
    req.headers.host !== new URL(origin).host ||
    (req.headers.origin && req.headers.origin !== origin)
  ) {
    json(403, { message: "This simulator only accepts its own local origin." });
    return;
  }
  try {
    if (req.method === "GET") {
      if (req.url === "/state") {
        json(200, { module, revision, ...simulator.snapshot() });
        return;
      }
      const assets: Record<string, [string, string]> = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
      };
      const asset = assets[req.url ?? ""];
      if (asset) {
        res.writeHead(200, { "Content-Type": asset[1] });
        res.end(
          await readFile(new URL(`./module-dev/${asset[0]}`, import.meta.url)),
        );
        return;
      }
    }
    if (req.method !== "POST" || req.url !== "/action") {
      json(404, { message: "Not found." });
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
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assertSchema(inputSchema, body);
    let result: unknown;
    if (body.action === "network") simulator.setOnline(body.online);
    if (body.action === "permissions")
      simulator.setPermissions(body.permissions);
    if (body.action === "sync") result = await simulator.sync();
    if (body.action === "submit")
      result = await simulator.submit(body.call as ModuleCall);
    json(200, { result, ...simulator.snapshot() });
  } catch (error) {
    const e = error as { status?: number; code?: string; message?: string };
    json(e.status ?? 400, {
      code: e.code ?? "SIMULATION_ERROR",
      message: e.message,
    });
  }
}).listen(port, "127.0.0.1", () =>
  console.log(
    `${module.name} development simulator: ${origin}\nSource changes restart the simulator and reset its isolated fixtures. No corporate data is used.`,
  ),
);
