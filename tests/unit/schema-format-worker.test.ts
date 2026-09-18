import { expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { build } from "esbuild";
import { valid } from "../fixtures/schema-formats/module";

it("validates independently bundled worker requests without process format registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "suite-format-worker-"));
  let worker: Worker | undefined;
  try {
    const outfile = join(directory, "worker.mjs");
    await build({
      stdin: {
        contents: `import {parentPort} from 'node:worker_threads';
        import {executeLocalCall} from '@suite/module-sdk/local';
        import implementation from './tests/fixtures/schema-formats/module-local';
        let snapshot = {records:{},receipts:{}};
        parentPort.on('message', async (call) => {
          try {
            const accepted = await executeLocalCall(implementation.module, {profileId:'worker-profile', configuration:{}, call, snapshot}, implementation);
            snapshot = accepted.snapshot;
            parentPort.postMessage({ok:true, ...accepted});
          } catch (error) {parentPort.postMessage({ok:false, code:error.code, snapshot});}
        });`,
        resolveDir: process.cwd(),
      },
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    worker = new Worker(outfile);
    const call = {
      moduleId: "schema-formats",
      moduleVersion: "1.0.0",
      action: "operation",
      operation: "capture",
      input: valid,
      key: "accepted",
    };
    const send = async (request: typeof call) => {
      const response = once(worker!, "message");
      worker!.postMessage(request);
      return (await response)[0];
    };
    const first = await send(call);
    expect(first).toMatchObject({ ok: true, result: valid });
    expect(first.snapshot.records.records).toHaveLength(1);
    expect(await send(call)).toEqual(first);
    for (const [key, bad] of Object.entries({
      identifier: "bad-uuid",
      email: "reader..office@example.com",
      website: "/relative",
      date: "2025-02-29",
      time: "09:30:00",
      timestamp: "2024-02-29T09:30:00",
    })) {
      expect(
        await send({
          ...call,
          key: `invalid-${key}`,
          input: { ...valid, [key]: bad },
        }),
      ).toEqual({ ok: false, code: "INVALID_INPUT", snapshot: first.snapshot });
    }
  } finally {
    if (worker) await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});
