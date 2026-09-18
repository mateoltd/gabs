import { resolve } from "node:path";
import { assertSchema, Type } from "@suite/module-sdk";
import {
  createModuleSimulator,
  SimulationReadGrantSchema,
} from "@suite/module-sdk/simulator";
import { checkModuleSources } from "../workspace";
import { loadSimulationGraph } from "../simulation";
import { buildClientViews } from "@suite/module-sdk/node/build-client";
import type { DevAction, WorkerResponse } from "./contracts";

const send = (message: WorkerResponse) => process.send?.(message);
try {
  const directory = resolve(process.argv[2]);
  const dependencies = process.argv.slice(3).map((path) => resolve(path));
  for (const path of [directory, ...dependencies])
    await checkModuleSources(path);
  const graph = await loadSimulationGraph(directory, dependencies);
  const { module } = graph;
  const bundles = await buildClientViews(module, directory);
  const simulator = createModuleSimulator(module, graph);
  const call = Type.Object(
    {
      moduleId: Type.Literal(module.id),
      moduleVersion: Type.Optional(Type.Literal(module.version)),
      action: Type.Union(
        [
          "create",
          "update",
          "archive",
          "get",
          "list",
          "references",
          "operation",
        ].map((value) => Type.Literal(value)),
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
      {
        action: Type.Literal("queue"),
        call,
        dependencies: Type.Array(Type.String(), {
          maxItems: 100,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("queued"),
        identity: Type.Object(
          {
            moduleId: Type.Literal(module.id),
            moduleVersion: Type.Literal(module.version),
            operation: Type.String(),
            key: Type.String(),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("hostLease"),
        capability: Type.String(),
        task: Type.Union([Type.Literal("renew"), Type.Literal("revoke")]),
        remainingMs: Type.Optional(
          Type.Integer({ minimum: 0, maximum: 86400000 }),
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("hostClock"),
        milliseconds: Type.Integer({
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("localAccess"),
        moduleId: Type.String(),
        capability: Type.String(),
        allowed: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { action: Type.Literal("localProfile"), locked: Type.Boolean() },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("localDevice"),
        id: Type.String(),
        task: Type.Union(
          ["process", "interrupt", "retry", "clear"].map((value) =>
            Type.Literal(value),
          ),
        ),
        confirmUncertain: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("host"),
        call: Type.Object(
          {
            moduleId: Type.Literal(module.id),
            moduleVersion: Type.Literal(module.version),
            capability: Type.String(),
            input: Type.Unknown(),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("hostResult"),
        moduleId: Type.Optional(Type.String()),
        capability: Type.String(),
        result: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("readGrants"),
        grants: Type.Array(SimulationReadGrantSchema, { maxItems: 500 }),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("grants"),
        grants: Type.Array(
          Type.Object(
            {
              consumerId: Type.String(),
              providerId: Type.String(),
              operation: Type.String(),
            },
            { additionalProperties: false },
          ),
          { maxItems: 500 },
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { action: Type.Literal("network"), online: Type.Boolean() },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        action: Type.Literal("permissions"),
        permissions: Type.Array(Type.String(), { maxItems: 500 }),
        moduleId: Type.Optional(Type.String()),
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
      if (action.action === "hostClock")
        simulator.advanceHostTime(action.milliseconds);
      if (action.action === "hostLease") {
        if (action.task === "renew")
          simulator.grantHostLease(action.capability, action.remainingMs);
        else simulator.revokeHostLease(action.capability);
      }
      if (action.action === "host")
        result = await simulator.sendHost(action.call);
      if (action.action === "hostResult")
        if (action.moduleId && action.moduleId !== module.id)
          simulator.setModuleHostResult(
            action.moduleId,
            action.capability,
            action.result === null ? undefined : action.result,
          );
        else
          simulator.setHostResult(
            action.capability,
            (action.result === null ? undefined : action.result) as never,
          );
      if (action.action === "localAccess")
        simulator.setModuleDeviceAccess(
          action.moduleId,
          action.capability,
          action.allowed,
        );
      if (action.action === "localProfile") {
        if (action.locked) simulator.lockProfile();
        else simulator.unlockProfile();
      }
      if (action.action === "localDevice") {
        if (action.task === "process" || action.task === "interrupt")
          result = await simulator.processDeviceRequest(action.id, {
            interrupt: action.task === "interrupt",
          });
        if (action.task === "retry")
          result = simulator.retryDeviceRequest(action.id, {
            confirmUncertain: action.confirmUncertain,
          });
        if (action.task === "clear") simulator.dismissDeviceRequest(action.id);
      }
      if (action.action === "network") simulator.setOnline(action.online);
      if (action.action === "permissions")
        simulator.setModulePermissions(
          action.moduleId ?? module.id,
          action.permissions,
        );
      if (action.action === "grants") simulator.setGrants(action.grants);
      if (action.action === "readGrants")
        simulator.setReadGrants(action.grants);
      if (action.action === "queue")
        result = await simulator.queue.capture(
          action.call,
          action.dependencies,
        );
      if (action.action === "queued")
        result = await simulator.queue.get(action.identity);
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
      const e = (error ?? {}) as {
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
