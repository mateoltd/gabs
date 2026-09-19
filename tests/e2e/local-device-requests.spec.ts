import "dotenv/config";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { publishLocalPackage } from "../support/local-package-fixture";

test("signed workers commit durable device requests and the broker releases writes while rechecking consent", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const id = `device-queue-${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await publishLocalPackage({
    id,
    transform: (file, source) =>
      file === "module.ts"
        ? source
            .replace("operation,Type", "operation,capability,Type")
            .replace(
              "resources:{items:",
              `capabilities:{export:capability({kind:'files.export',permission:'${id}.capture'})},resources:{items:`,
            )
        : `import {defineLocalModule} from '@suite/module-sdk/local';import module from './module';export default defineLocalModule(module)({async capture(ctx,input){await ctx.resource('items').create({text:input.text});const id=await ctx.device.request('export',{filename:'notes.txt',content:input.text});if(input.reject)ctx.reject({reason:'blocked'});return id;}});`,
  });
  expect(fixture.pkg.artifact.local).toMatchObject({
    format: "suite-local-v2",
  });
  const helper = await build({
    stdin: {
      contents:
        "export * from './composition/src/local/product';export {createModuleClient,hydrateModule} from '@suite/module-sdk';export {moduleContract} from '@suite/module-sdk/client-artifact';export {removeLocalProfile,restoreLocalProfile} from './packages/client/src/identity/local-profiles';export {localProfileRuntime} from './composition/src/local/runtime';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  const worker = await build({
    entryPoints: ["composition/src/local/worker-entry.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await context.route("**/device-profile.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: helper.outputFiles[0].text,
    }),
  );
  await context.route("**/worker-entry.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: worker.outputFiles[0].text,
    }),
  );
  await page.goto("/");
  await context.setOffline(true);
  const result = await page.evaluate(
    async ({ pkg, publicKey }) => {
      const path = "/device-profile.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../composition/src/local/product") &
        typeof import("@suite/module-sdk") &
        typeof import("@suite/module-sdk/client-artifact");
      const password = "correct horse battery staple";
      let session = await sdk.createLocalProfile(
        "Device request profile",
        password,
      );
      const profileId = session.id;
      await session.install(pkg, publicKey);
      const module = sdk.hydrateModule(sdk.moduleContract(pkg.artifact));
      const client = sdk.createModuleClient(module, (call) =>
        session.execute(module, call),
      );
      const capture = async (text: string, reject = false, key?: string) =>
        (await client.call("capture", { text, reject }, key)) as string;
      const code = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return "accepted";
        } catch (error) {
          return (error as { code?: string }).code ?? "rejected";
        }
      };
      const denied = await code(() => capture("Denied"));
      await session.setCapabilityAccess(module.id, "export", true);
      const rejected = await code(() => capture("Rejected", true));
      const rolledBack =
        !session.data.records[`${module.id}/items`]?.length &&
        !Object.keys(session.data.deviceRequests ?? {}).length;
      const first = await capture("Committed", false, "stable-device-call");
      const replay = await capture("Committed", false, "stable-device-call");
      const once =
        first === replay &&
        Object.keys(session.data.deviceRequests ?? {}).length === 1;
      const queued = session.data.deviceRequests![first];
      session.lock();
      session = await sdk.unlockLocalProfile(profileId, password);
      const survived = session.data.deviceRequests![first].state === "pending";
      let effects = 0;
      let entered!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const dialog = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = code(() =>
        session.processDeviceRequest(first, async (guard) => {
          entered();
          await dialog;
          await guard.assertCurrent();
          effects++;
          return { status: "offered" };
        }),
      );
      await ready;
      const duplicate = await code(() =>
        session.processDeviceRequest(first, async () => ({
          status: "offered",
        })),
      );
      const busyDismiss = await code(() => session.dismissDeviceRequest(first));
      await client
        .resource("items")
        .create({ text: "Independent edit while dialog is open" });
      await session.setCapabilityAccess(module.id, "export", false);
      release();
      const revoked = await pending;
      const uncertain = session.data.deviceRequests![first].state;
      await session.setCapabilityAccess(module.id, "export", true);
      const second = await capture("Successful export");
      const success = await session.processDeviceRequest(
        second,
        async (guard) => {
          await guard.assertCurrent();
          effects++;
          return { status: "offered" };
        },
      );
      const repeat = await code(() =>
        session.processDeviceRequest(second, async () => {
          effects++;
          return { status: "offered" };
        }),
      );
      const completed = session.data.deviceRequests![second].state;
      const stale = await capture("Old consent");
      await session.setCapabilityAccess(module.id, "export", false);
      await session.setCapabilityAccess(module.id, "export", true);
      const staleConsent = await code(() =>
        session.processDeviceRequest(stale, async () => {
          effects++;
          return { status: "offered" };
        }),
      );
      const staleState = session.data.deviceRequests![stale].state;
      const beforeRetry = session.data.records[`${module.id}/items`].length;
      const retriedId = await session.retryDeviceRequest(stale);
      const retried = session.data.deviceRequests![retriedId];
      const independentRetry =
        retried.retryOf === stale &&
        retried.state === "pending" &&
        session.data.records[`${module.id}/items`].length === beforeRetry &&
        (await session.retryDeviceRequest(stale)) === retriedId;
      const reviewRequired = await code(() =>
        session.retryDeviceRequest(first),
      );
      const reviewedId = await session.retryDeviceRequest(first, {
        confirmUncertain: true,
      });
      const explicitRetry =
        session.data.deviceRequests![reviewedId].retryOf === first;
      const malformedId = await capture("Unverified result");
      const malformed = await code(() =>
        session.processDeviceRequest(malformedId, async () => ({
          status: "invalid",
        })),
      );
      const malformedState = session.data.deviceRequests![malformedId].state;
      const cancelledId = await capture("Cancelled dialog");
      const cancel = new AbortController();
      let cancelEntered!: () => void;
      const cancelReady = new Promise<void>((resolve) => {
        cancelEntered = resolve;
      });
      let lateGuard:
        | import("../../packages/client/src/identity/local-profiles").LocalCapabilityGuard
        | undefined;
      const cancelledRun = code(() =>
        session.processDeviceRequest(
          cancelledId,
          async (guard) => {
            lateGuard = guard;
            cancelEntered();
            return new Promise(() => {});
          },
          { signal: cancel.signal },
        ),
      );
      await cancelReady;
      cancel.abort();
      const cancelled = await cancelledRun;
      const cancelledState = session.data.deviceRequests![cancelledId].state;
      const late = await code(() => lateGuard!.assertCurrent());
      const timedId = await capture("Timed out dialog");
      const timed = await code(() =>
        session.processDeviceRequest(
          timedId,
          async () => new Promise(() => {}),
          { timeoutMs: 100 },
        ),
      );
      const timedState = session.data.deviceRequests![timedId].state;
      const lockedId = await capture("Interrupted dialog");
      let lockedEntered!: () => void;
      const lockedReady = new Promise<void>((resolve) => {
        lockedEntered = resolve;
      });
      const lockedRun = code(() =>
        session.processDeviceRequest(lockedId, async () => {
          lockedEntered();
          return new Promise(() => {});
        }),
      );
      await lockedReady;
      session.lock();
      const locked = await lockedRun;
      session = await sdk.unlockLocalProfile(profileId, password);
      const recoveredState = session.data.deviceRequests![lockedId].state;
      const noReplay = await code(() =>
        session.processDeviceRequest(lockedId, async () => {
          effects++;
          return { status: "offered" };
        }),
      );
      await session.dismissDeviceRequest(lockedId);
      const cleared = !session.data.deviceRequests![lockedId];
      const uninstallId = await capture("Removed module");
      await session.uninstall(module.id);
      const uninstalled = await code(() =>
        session.processDeviceRequest(uninstallId, async () => {
          effects++;
          return { status: "offered" };
        }),
      );
      const records = session.data.records[`${module.id}/items`].map(
        (r) => r.data.text,
      );
      session.lock();
      return {
        denied,
        rejected,
        rolledBack,
        once,
        survived,
        queued: queued.state,
        duplicate,
        busyDismiss,
        revoked,
        uncertain,
        success,
        repeat,
        completed,
        staleConsent,
        staleState,
        independentRetry,
        reviewRequired,
        explicitRetry,
        malformed,
        malformedState,
        cancelled,
        cancelledState,
        late,
        timed,
        timedState,
        locked,
        recoveredState,
        noReplay,
        cleared,
        uninstalled,
        effects,
        records,
      };
    },
    { pkg: fixture.pkg, publicKey: fixture.publicKey },
  );
  expect(result).toMatchObject({
    denied: "CAPABILITY_DENIED",
    rejected: "MODULE_BUSINESS_ERROR",
    rolledBack: true,
    once: true,
    survived: true,
    queued: "pending",
    duplicate: "LOCAL_DEVICE_BUSY",
    busyDismiss: "LOCAL_DEVICE_BUSY",
    revoked: "CAPABILITY_DENIED",
    uncertain: "uncertain",
    success: { status: "offered" },
    repeat: "accepted",
    completed: "completed",
    staleConsent: "CAPABILITY_DENIED",
    staleState: "rejected",
    independentRetry: true,
    reviewRequired: "LOCAL_DEVICE_REVIEW_REQUIRED",
    explicitRetry: true,
    malformed: "CAPABILITY_RESPONSE_INVALID",
    malformedState: "uncertain",
    cancelled: "LOCAL_CANCELLED",
    cancelledState: "uncertain",
    late: "LOCAL_CANCELLED",
    timed: "LOCAL_TIMEOUT",
    timedState: "uncertain",
    locked: "PROFILE_LOCKED",
    recoveredState: "uncertain",
    noReplay: "LOCAL_DEVICE_NOT_PENDING",
    cleared: true,
    uninstalled: "CAPABILITY_UNDECLARED",
    effects: 1,
  });
  expect(result.records).toContain("Independent edit while dialog is open");
  expect(result.records).not.toContain("Denied");
  expect(result.records).not.toContain("Rejected");
  expect(result.records.filter((r) => r === "Committed")).toHaveLength(1);
  const interrupted = await page.evaluate(
    async ({ pkg, publicKey }) => {
      const path = "/device-profile.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../composition/src/local/product") &
        typeof import("@suite/module-sdk") &
        typeof import("@suite/module-sdk/client-artifact");
      const session = await sdk.createLocalProfile(
        "Interrupted device profile",
        "correct horse battery staple",
      );
      await session.install(pkg, publicKey);
      await session.setCapabilityAccess(pkg.module_id, "export", true);
      const module = sdk.hydrateModule(sdk.moduleContract(pkg.artifact));
      const client = sdk.createModuleClient(module, (call) =>
        session.execute(module, call),
      );
      const id = (await client.call("capture", {
        text: "Saved before page termination",
      })) as string;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      void session
        .processDeviceRequest(id, async () => {
          entered();
          return new Promise(() => {});
        })
        .catch(() => {});
      await ready;
      return { profileId: session.id, requestId: id };
    },
    { pkg: fixture.pkg, publicKey: fixture.publicKey },
  );
  // Terminate the owning page without calling session.lock or saving an outcome.
  await page.close();
  const recovery = await context.newPage();
  await recovery.route("**/device-recovery", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Device recovery harness</title>",
    }),
  );
  await recovery.goto("http://localhost:4300/device-recovery");
  expect(
    await recovery.evaluate(async ({ profileId, requestId }) => {
      const path = "/device-profile.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../composition/src/local/product");
      const session = await sdk.unlockLocalProfile(
        profileId,
        "correct horse battery staple",
      );
      let effects = 0,
        code = "accepted";
      try {
        await session.processDeviceRequest(requestId, async () => {
          effects++;
          return { status: "offered" };
        });
      } catch (error) {
        code = (error as { code: string }).code;
      }
      const state = session.data.deviceRequests![requestId].state;
      const records = Object.values(session.data.records)
        .flat()
        .map((row) => row.data.text);
      session.lock();
      return { state, code, effects, records };
    }, interrupted),
  ).toEqual({
    state: "uncertain",
    code: "LOCAL_DEVICE_NOT_PENDING",
    effects: 0,
    records: ["Saved before page termination"],
  });
  expect(
    await recovery.evaluate(async ({ profileId, requestId }) => {
      const path = "/device-profile.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../composition/src/local/product") &
        Pick<
          typeof import("../../packages/client/src/identity/local-profiles"),
          "removeLocalProfile" | "restoreLocalProfile"
        > &
        typeof import("../../composition/src/local/runtime");
      await sdk.removeLocalProfile(profileId);
      const session = await sdk.restoreLocalProfile(
        profileId,
        "correct horse battery staple",
        sdk.localProfileRuntime,
      );
      let effects = 0,
        code = "accepted";
      try {
        await session.processDeviceRequest(requestId, async () => {
          effects++;
          return { status: "offered" };
        });
      } catch (error) {
        code = (error as { code: string }).code;
      }
      const state = session.data.deviceRequests![requestId].state;
      const records = Object.values(session.data.records)
        .flat()
        .map((row) => row.data.text);
      session.lock();
      return { state, code, effects, records };
    }, interrupted),
  ).toEqual({
    state: "uncertain",
    code: "LOCAL_DEVICE_NOT_PENDING",
    effects: 0,
    records: ["Saved before page termination"],
  });
});
