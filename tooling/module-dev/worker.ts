import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSchema, Type } from "@suite/module-sdk";
import { canonical, resolveReleases } from "@suite/module-sdk/registry";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import type { ScopedModuleServer } from "@suite/module-sdk/server";
import { moduleDefinitions } from "@suite/module-catalog";
import { checkModuleSources, loadModuleWorkspace } from "../module-workspace";
import { buildClientViews } from "../../packages/module-sdk/node/build-client";
import type { DevAction, WorkerResponse } from "./contracts";

const send = (message: WorkerResponse) => process.send?.(message);
try {
  const directory = resolve(process.argv[2]);
  await checkModuleSources(directory);
  const { module, fixtures } = await loadModuleWorkspace(directory);
  resolveReleases(
    module.id,
    [...moduleDefinitions.filter((m) => m.id !== module.id), module],
    "1.0.0",
    "1.0.0",
  );
  let configuration: unknown = {};
  try {
    configuration = JSON.parse(
      await readFile(resolve(directory, "configuration.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  assertSchema(module.configuration, configuration);
  let server: ScopedModuleServer | undefined;
  const entry = resolve(directory, "module-server.ts");
  let hasServer = true;
  try {
    await access(entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    hasServer = false;
  }
  if (hasServer) {
    server = (await import(pathToFileURL(entry).href))
      .default as ScopedModuleServer;
    if (
      server?.kind !== "scoped" ||
      canonical(server.module) !== canonical(module)
    )
      throw Error(
        "Development operations require a scoped module-server.ts matching this release.",
      );
  }
  const bundles = await buildClientViews(module, directory);
  const simulator = createModuleSimulator(module, {
    fixtures,
    configuration,
    server,
  });
  const call = Type.Object(
    {
      moduleId: Type.Literal(module.id),
      moduleVersion: Type.Optional(Type.Literal(module.version)),
      action: Type.Union(
        ["create", "update", "archive", "get", "list", "operation"].map(
          (value) => Type.Literal(value),
        ),
      ),
      kind: Type.Optional(
        Type.Union([Type.Literal("query"), Type.Literal("command")]),
      ),
      resource: Type.Optional(Type.String()),
      operation: Type.Optional(Type.String()),
      key: Type.Optional(Type.String({ minLength: 8, maxLength: 128 })),
      input: Type.Unknown(),
    },
    { additionalProperties: false },
  );
  const input = Type.Union([
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
        action: Type.Union([Type.Literal("submit"), Type.Literal("execute")]),
        call,
      },
      { additionalProperties: false },
    ),
  ]);
  process.on("message", async (message: { id: number; action: DevAction }) => {
    let result: unknown;
    try {
      assertSchema(input, message.action);
      const action = message.action;
      if (action.action === "network") simulator.setOnline(action.online);
      if (action.action === "permissions")
        simulator.setPermissions(action.permissions);
      if (action.action === "sync") result = await simulator.sync();
      if (action.action === "submit")
        result = await simulator.submit(action.call);
      if (action.action === "execute")
        result = await simulator.send(action.call);
      send({
        type: "response",
        id: message.id,
        result,
        snapshot: simulator.snapshot(),
      });
    } catch (error) {
      const e = error as {
        status?: number;
        code?: string;
        message?: string;
        detail?: unknown;
      };
      send({
        type: "response",
        id: message.id,
        snapshot: simulator.snapshot(),
        error: {
          status: e.status ?? 400,
          code: e.code ?? "SIMULATION_ERROR",
          message: e.message ?? String(error),
          detail: e.detail,
        },
      });
    }
  });
  send({ type: "ready", module, bundles, snapshot: simulator.snapshot() });
} catch (error) {
  send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}
