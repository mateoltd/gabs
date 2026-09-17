import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "esbuild";
import { defineModuleServer } from "@suite/module-sdk/server";
import { createModuleClient, type ModuleCall } from "@suite/module-sdk";
import {
  executeLocalCall,
  defineLocalModule,
  createLocalModuleClient,
  type LocalSnapshot,
} from "@suite/module-sdk/local";
import implementation, { module } from "./fixtures/local-module";
import {
  LocalWorkerHost,
  type LocalWorkerPort,
} from "../packages/platform/src/local-worker";
let directory: string;
const empty = (): LocalSnapshot => ({ records: {}, receipts: {} });
const command = (
  operation: string,
  input: unknown = {},
  key = crypto.randomUUID(),
): ModuleCall => ({
  moduleId: module.id,
  moduleVersion: module.version,
  action: "operation",
  operation,
  input,
  key,
});
const request = (call: ModuleCall, snapshot = empty()) => ({
  profileId: "local-profile",
  configuration: {},
  call,
  snapshot,
});
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "suite-local-worker-"));
  await build({
    stdin: {
      contents: `import {parentPort} from 'node:worker_threads';import {executeLocalCall} from '@suite/module-sdk/local';import implementation,{module} from './tests/fixtures/local-module';parentPort.on('message',async({request})=>{if(request.call.operation==='crash'){process.exit(1);}try{parentPort.postMessage({ok:true,value:await executeLocalCall(module,request,implementation)});}catch(e){parentPort.postMessage({ok:false,error:{code:e.code,message:e.message,detail:e.detail}});}});`,
      resolveDir: process.cwd(),
    },
    outfile: join(directory, "worker.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
  });
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
function host() {
  return new LocalWorkerHost(() => {
    const worker = new Worker(join(directory, "worker.mjs"));
    return {
      postMessage: (value) => worker.postMessage(value),
      terminate: () => {
        void worker.terminate();
      },
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        if (type === "message")
          worker.on("message", (data) =>
            (listener as (e: MessageEvent) => void)({ data } as MessageEvent),
          );
        else if (type === "error")
          worker.on("exit", (code) => {
            if (code !== 0)
              (listener as (e: Event) => void)(new Event("error"));
          });
        else
          worker.on("messageerror", () =>
            (listener as (e: Event) => void)(new Event("messageerror")),
          );
      },
    } as LocalWorkerPort;
  });
}
it("runs CPU work outside the calling thread and can terminate, time out, crash and restart", async () => {
  const runner = host();
  try {
    const value = await runner.run(
      module,
      request(command("calculate", { count: 1000000 })),
    );
    expect(value.result).toBe(499999500000);
    const abort = new AbortController();
    const pending = runner.run(module, request(command("endless")), {
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 25);
    await expect(pending).rejects.toMatchObject({ code: "LOCAL_CANCELLED" });
    await expect(
      runner.run(module, request(command("endless")), { timeoutMs: 25 }),
    ).rejects.toMatchObject({ code: "LOCAL_TIMEOUT" });
    await expect(
      runner.run(module, request(command("crash"))),
    ).rejects.toMatchObject({ code: "LOCAL_WORKER_FAILED" });
    expect(
      (await runner.run(module, request(command("calculate", { count: 4 }))))
        .result,
    ).toBe(6);
    const locked = runner.run(module, request(command("endless")));
    runner.close();
    await expect(locked).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
    await expect(
      runner.run(module, request(command("calculate", { count: 4 }))),
    ).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  } finally {
    runner.close();
  }
});
it("returns records and exact retry receipts together, rejects changed keys, and rolls back rejected/caught failures", async () => {
  const initial = empty(),
    call = command("append", { text: "Durable note" });
  const first = await executeLocalCall(
    module,
    request(call, initial),
    implementation,
  );
  expect(initial.records).toEqual({});
  expect(first.snapshot.records.notes).toHaveLength(1);
  const replay = await executeLocalCall(
    module,
    request(call, structuredClone(first.snapshot)),
    implementation,
  );
  expect(replay).toEqual(first);
  await expect(
    executeLocalCall(
      module,
      request({ ...call, input: { text: "Different" } }, first.snapshot),
      implementation,
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    executeLocalCall(
      module,
      request(command("caught"), initial),
      implementation,
    ),
  ).rejects.toMatchObject({ code: "LOCAL_ONLY" });
  const client = createModuleClient(module, (call) =>
    executeLocalCall(module, request(call, initial), implementation).then(
      (value) => value.result,
    ),
  );
  expect(await client.attempt("reject", {})).toEqual({
    ok: false,
    error: { code: "INVALID_NOTE" },
  });
  expect(initial.records).toEqual({});
});
it("rejects corporate operations, foreign module scopes, missing local implementations and stale resource writes", async () => {
  await expect(
    executeLocalCall(module, request(command("company")), implementation),
  ).rejects.toMatchObject({ code: "LOCAL_ONLY" });
  await expect(
    executeLocalCall(
      module,
      request({ ...command("append", { text: "No" }), moduleId: "other" }),
      implementation,
    ),
  ).rejects.toMatchObject({ code: "LOCAL_CONTRACT_MISMATCH" });
  await expect(
    executeLocalCall(module, request(command("append", { text: "No" }))),
  ).rejects.toMatchObject({ code: "LOCAL_IMPLEMENTATION_MISSING" });
  const first = await executeLocalCall(
    module,
    request(command("append", { text: "Original" })),
    implementation,
  );
  const row = first.snapshot.records.notes[0];
  const update: ModuleCall = {
    moduleId: module.id,
    moduleVersion: module.version,
    resource: "notes",
    action: "update",
    key: crypto.randomUUID(),
    input: { id: row.id, baseVersion: 0, data: { text: "Stale" } },
  };
  await expect(
    executeLocalCall(module, request(update, first.snapshot), implementation),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect(first.snapshot.records.notes[0].data.text).toBe("Original");
});
function compileTimeContracts() {
  defineModuleServer(module)({ company: async () => null });
  defineModuleServer(module)({
    company: async () => null,
    // @ts-expect-error Local handlers belong in the worker, not the corporate server.
    calculate: async () => 0,
  });
  const client = createLocalModuleClient(module, async () => null);
  void client.call("calculate", { count: 10 });
  // @ts-expect-error Server operations cannot be called by a local client.
  void client.call("company", {});
  // @ts-expect-error Corporate resources are not local capabilities.
  client.resource("corporate");
  // @ts-expect-error Operation input is inferred.
  void client.call("calculate", { count: "wrong" });
  // @ts-expect-error All declared local handlers are required.
  defineLocalModule(module)({});
  defineLocalModule(module)({
    ...({} as Parameters<
      ReturnType<typeof defineLocalModule<typeof module>>
    >[0]),
    // @ts-expect-error Online handlers must remain on the authoritative server.
    company: async () => null,
  });
}
void compileTimeContracts;

it("looks up standalone references in the actual worker without creating a receipt", async () => {
  const runner = host();
  const id = "00000000-0000-4000-8000-000000000080";
  const snapshot: LocalSnapshot = {
    records: {
      notes: [
        {
          id,
          data: { text: "Worker note" },
          version: 1,
          archived: false,
          updatedAt: "2026-09-17T00:00:00Z",
        },
      ],
    },
    receipts: {},
  };
  try {
    const result = await runner.run(
      module,
      request(
        {
          moduleId: module.id,
          moduleVersion: module.version,
          resource: "notes",
          action: "references",
          input: { field: "/properties/linked", selected: id },
        },
        snapshot,
      ),
    );
    expect(result.result).toEqual({
      items: [{ value: id, label: id }],
      nextCursor: null,
      selected: { value: id, label: id },
    });
    expect(result.snapshot).toEqual(snapshot);
  } finally {
    runner.close();
  }
});

it("rejects invalid links inside the worker without committing records or consuming a retry key", async () => {
  const runner = host();
  try {
    const first = await runner.run(
      module,
      request(command("append", { text: "Target" })),
    );
    const target = first.snapshot.records.notes[0];
    const before = structuredClone(first.snapshot);
    const create = (linked: string): ModuleCall => ({
      moduleId: module.id,
      moduleVersion: module.version,
      resource: "notes",
      action: "create",
      input: { data: { text: "Linked note", linked } },
      key: "reference-retry",
    });
    await expect(
      runner.run(module, request(create(crypto.randomUUID()), before)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(before).toEqual(first.snapshot);
    const valid = await runner.run(module, request(create(target.id), before));
    expect(valid.snapshot.records.notes).toHaveLength(2);
    expect(valid.snapshot.receipts["reference-retry"]).toBeDefined();
    const archived = await runner.run(
      module,
      request(
        {
          moduleId: module.id,
          moduleVersion: module.version,
          resource: "notes",
          action: "archive",
          input: { id: target.id, baseVersion: target.version },
          key: "archive-target",
        },
        valid.snapshot,
      ),
    );
    await expect(
      runner.run(
        module,
        request(
          { ...create(target.id), key: "after-archive" },
          archived.snapshot,
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(archived.snapshot.records.notes).toHaveLength(2);
  } finally {
    runner.close();
  }
});
