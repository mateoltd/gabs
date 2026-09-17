import { publishLocalPackage } from "../local-package-fixture";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { defineModule, field, resource, Type } from "@suite/module-sdk";
import { signPackage } from "../../packages/module-sdk/node/signing";
import type { Page } from "@playwright/test";
async function fixture(page: Page) {
  const source = await build({
    stdin: {
      contents: `export * from './packages/platform/src/local-profiles';export {LocalWorkerHost} from './packages/platform/src/local-worker';export {resumeLocalDownload} from './packages/app-web/src/local-module-download';export {createModuleClient,hydrateModule} from '@suite/module-sdk';export {default as module} from './modules/contacts/module';export {default as projects} from './modules/projects/module';`,
      resolveDir: process.cwd(),
    },
    write: false,
    bundle: true,
    platform: "browser",
    format: "esm",
  });
  const worker = await build({
    entryPoints: [resolve("packages/platform/src/local-worker-entry.ts")],
    write: false,
    bundle: true,
    platform: "browser",
    format: "esm",
  });
  await page.context().route("**/local-profile-proof.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: source.outputFiles[0].text,
    }),
  );
  await page.context().route("**/local-worker-entry.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `if(typeof process!=="undefined"||typeof document!=="undefined"||typeof suiteDesktop!=="undefined"||typeof suite!=="undefined")throw Error("Privileged globals reached the worker");\n${worker.outputFiles[0].text}`,
    }),
  );
}
test("real web workers persist atomic receipts offline and reject stale or removed profile writes", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await page.context().setOffline(true);
  let workers = 0;
  page.on("worker", () => {
    workers++;
  });
  const result = await page.evaluate(async () => {
    const path = "/local-profile-proof.mjs";
    const sdk = (await import(
      path
    )) as typeof import("../../packages/platform/src/local-profiles") & {
      module: typeof import("../../modules/contacts/module").default;
      createModuleClient: typeof import("@suite/module-sdk").createModuleClient;
    };
    const pass = "correct horse battery staple";
    let session = await sdk.createLocalProfile("Worker receipt proof", pass);
    const id = session.id,
      key = crypto.randomUUID();
    const data = {
      name: "Worker contact",
      kind: "person" as const,
      relationship: "other" as const,
    };
    const client = () =>
      sdk.createModuleClient(sdk.module, (call) =>
        session.execute(sdk.module, call),
      );
    const created = await client().resource("contacts").create(data, key);
    session.lock();
    session = await sdk.unlockLocalProfile(id, pass);
    const recovered = await client().resource("contacts").create(data, key);
    const competitor = await sdk.unlockLocalProfile(id, pass);
    session.data.records["contacts/contacts"][0].data.name =
      "Uncommitted external mutation";
    await client()
      .resource("contacts")
      .create({ ...data, name: "Second contact" });
    let stale = "",
      removed = "";
    try {
      await sdk
        .createModuleClient(sdk.module, (call) =>
          competitor.execute(sdk.module, call),
        )
        .resource("contacts")
        .create({ ...data, name: "Must not overwrite" });
    } catch (e) {
      stale = (e as { code: string }).code;
    }
    competitor.lock();
    session.lock();
    session = await sdk.unlockLocalProfile(id, pass);
    const names = session.data.records["contacts/contacts"].map(
      (r) => r.data.name,
    );
    await sdk.removeLocalProfile(id);
    try {
      await client()
        .resource("contacts")
        .create({ ...data, name: "Must not resurrect" });
    } catch (e) {
      removed = (e as { code: string }).code;
    }
    session.lock();
    return {
      same: created.id === recovered.id,
      names,
      stale,
      removed,
      profiles: await sdk.listLocalProfiles(),
    };
  });
  expect(result).toEqual({
    same: true,
    names: ["Worker contact", "Second contact"],
    stale: "PROFILE_CHANGED",
    removed: "PROFILE_CHANGED",
    profiles: [],
  });
  // Stale and removed profiles now fail before any worker receives their data.
  expect(workers).toBe(3);
});

test("a reviewed local executable installs, runs offline, upgrades and retains exact historical receipts", async ({
  page,
}) => {
  const first = await publishLocalPackage();
  const next = await publishLocalPackage({
    id: first.pkg.module_id,
    version: "1.1.0",
    prefix: "Updated: ",
  });
  const incompatible = await publishLocalPackage({
    id: first.pkg.module_id,
    version: "1.2.0",
    maxLength: 3,
  });
  await fixture(page);
  await page.goto("/");
  await page.context().setOffline(true);
  const result = await page.evaluate(
    async ({ first, next, incompatible }) => {
      const path = "/local-profile-proof.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../packages/platform/src/local-profiles") & {
        hydrateModule: typeof import("@suite/module-sdk").hydrateModule;
        createModuleClient: typeof import("@suite/module-sdk").createModuleClient;
      };
      const pass = "correct horse battery staple";
      let session = await sdk.createLocalProfile(
        "Installed local module",
        pass,
      );
      const profile = session.id;
      const oldModule = sdk.hydrateModule(
        first.pkg
          .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
      );
      const newModule = sdk.hydrateModule(
        next.pkg
          .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
      );
      await session.install(first.pkg, first.publicKey);
      const client = (module: import("@suite/module-sdk").ModuleDefinition) =>
        sdk.createModuleClient(module, (call) => session.execute(module, call));
      const key = crypto.randomUUID(),
        original = await client(oldModule).call(
          "capture",
          { text: "First note" },
          key,
        );
      session.lock();
      session = await sdk.unlockLocalProfile(profile, pass);
      const resumed = await client(oldModule).call(
        "capture",
        { text: "First note" },
        key,
      );
      await session.install(next.pkg, next.publicKey);
      const historical = await client(oldModule).call(
        "capture",
        { text: "First note" },
        key,
      );
      let outdated = "",
        invalid = "",
        corrupt = "";
      try {
        await client(oldModule).call("capture", {
          text: "New request on old code",
        });
      } catch (error) {
        outdated = (error as { code: string }).code;
      }
      await client(newModule).call("capture", { text: "Second note" });
      try {
        await session.install(incompatible.pkg, incompatible.publicKey);
      } catch (error) {
        invalid = (error as Error).message;
      }
      const tampered = structuredClone(next.pkg);
      (tampered.artifact.local as { javascript: string }).javascript +=
        "\n// changed";
      try {
        await session.install(tampered, next.publicKey);
      } catch (error) {
        corrupt = (error as Error).message;
      }
      const before = session.data.records[oldModule.id + "/items"].map(
        (r) => r.data.text,
      );
      const selected = session.data.modules![oldModule.id].version;
      for (const [id, attempt] of Object.entries(
        session.data.installationAttempts ?? {},
      ))
        if (attempt.state !== "accepted") await session.dismissInstallation(id);
      await session.uninstall(oldModule.id);
      const retained = session.data.records[oldModule.id + "/items"].map(
        (r) => r.data.text,
      );
      let removed = "";
      try {
        await client(newModule).call("capture", { text: "Must not run" });
      } catch (error) {
        removed = (error as { code: string }).code;
      }
      await session.install(next.pkg, next.publicKey);
      const repaired = session.data.records[oldModule.id + "/items"].map(
        (r) => r.data.text,
      );
      session.lock();
      return {
        same: original === resumed && resumed === historical,
        outdated,
        invalid,
        corrupt,
        before,
        retained,
        repaired,
        selected,
        removed,
      };
    },
    { first, next, incompatible },
  );
  expect(result.same).toBe(true);
  expect(result.outdated).toBe("LOCAL_UPDATE_REQUIRED");
  expect(result.selected).toBe("1.1.0");
  expect(result.before).toEqual(["First note", "Updated: Second note"]);
  expect(result.retained).toEqual(result.before);
  expect(result.repaired).toEqual(result.before);
  expect(result.removed).toBe("LOCAL_NOT_INSTALLED");
  expect(result.invalid).toMatch(/text.*(length|3)/i);
  expect(result.corrupt).toMatch(/checksum/);
});

test("signed local migrations commit atomically and retain compatible rollback, receipts and recovery", async ({
  page,
}) => {
  test.setTimeout(120000);
  const first = await publishLocalPackage();
  const localStorage = {
    version: 2,
    compatible: { minimum: 2, maximum: 2 },
    migrations: { rename: { from: 1, to: 2 } },
  };
  const failed = await publishLocalPackage({
    id: first.pkg.module_id,
    version: "2.0.0",
    field: "body",
    localStorage,
    migrationError: true,
  });
  const next = await publishLocalPackage({
    id: first.pkg.module_id,
    version: "2.1.0",
    field: "body",
    localStorage,
    migrationDelayMs: 1000,
  });
  const compatible = await publishLocalPackage({
    id: first.pkg.module_id,
    version: "1.1.0",
    field: "body",
    localStorage: {
      version: 1,
      compatible: { minimum: 1, maximum: 2 },
      migrations: {},
    },
  });
  await fixture(page);
  await page.goto("/");
  await page.context().setOffline(true);
  const result = await page.evaluate(
    async ({ first, failed, next, compatible }) => {
      const path = "/local-profile-proof.mjs";
      type SDK = typeof import("../../packages/platform/src/local-profiles") &
        typeof import("@suite/module-sdk");
      const sdk = (await import(path)) as SDK;
      const password = "correct horse battery staple";
      let session = await sdk.createLocalProfile("Schema recovery", password);
      const profile = session.id;
      const module = sdk.hydrateModule(
        first.pkg
          .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
      );
      await session.install(first.pkg, first.publicKey);
      const key = crypto.randomUUID();
      const client = () =>
        sdk.createModuleClient(module, (call) => session.execute(module, call));
      const original = await client().call(
        "capture",
        { text: "Retained note" },
        key,
      );
      const businessData = () => ({
        records: session.data.records,
        modules: session.data.modules,
        receipts: session.data.receipts,
      });
      const before = businessData();
      const originalInstallation = Object.keys(
        session.data.installationAttempts!,
      )[0];
      const discardUnfinished = async () => {
        for (const [id, attempt] of Object.entries(
          session.data.installationAttempts ?? {},
        ))
          if (attempt.state !== "accepted")
            await session.dismissInstallation(id);
      };
      let failure = "",
        cancelled = "",
        incompatible = "",
        stale = "";
      try {
        await session.install(failed.pkg, failed.publicKey);
      } catch (e) {
        failure = (e as Error).message;
      }
      const failurePreserved =
        JSON.stringify(businessData()) === JSON.stringify(before);
      const failedAttempt = Object.values(
        session.data.installationAttempts!,
      ).find((a) => a.state !== "accepted")!;
      let replacement = "",
        removal = "";
      try {
        await session.install(next.pkg, next.publicKey);
      } catch (error) {
        replacement = (error as Error).message;
      }
      try {
        await session.uninstall(module.id);
      } catch (error) {
        removal = (error as Error).message;
      }
      await discardUnfinished();
      const controller = new AbortController();
      const pending = session.install(
        next.pkg,
        next.publicKey,
        {},
        { signal: controller.signal },
      );
      while (
        !Object.values(session.data.installationAttempts ?? {}).some(
          (a) => a.state === "pending",
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      try {
        await pending;
      } catch (e) {
        cancelled = (e as { code: string }).code;
      }
      const cancellationPreserved =
        JSON.stringify(businessData()) === JSON.stringify(before);
      const interruptedId = Object.entries(
        session.data.installationAttempts!,
      ).find(([, a]) => a.state === "interrupted")![0];
      // A concurrent session commits while the worker computes a migration snapshot.
      const migrating = session.install(next.pkg, next.publicKey);
      while (
        !Object.values(session.data.installationAttempts ?? {}).some(
          (a) => a.state === "pending",
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      const competitor = await sdk.unlockLocalProfile(profile, password);
      await sdk
        .createModuleClient(module, (call) => competitor.execute(module, call))
        .call("capture", { text: "Concurrent note" });
      try {
        await migrating;
      } catch (e) {
        stale = (e as { code: string }).code;
      }
      competitor.lock();
      session.lock();
      session = await sdk.unlockLocalProfile(profile, password);
      const beforeRetry = session.data.modules![module.id].version;
      await session.retryInstallation(interruptedId);
      const migrated = session.data;
      await session.retryInstallation(originalInstallation);
      const acceptedReplayPreserved =
        JSON.stringify(session.data) === JSON.stringify(migrated);
      session.lock();
      session = await sdk.unlockLocalProfile(profile, password);
      const historical = await client().call(
        "capture",
        { text: "Retained note" },
        key,
      );
      try {
        await session.install(first.pkg, first.publicKey);
      } catch (e) {
        incompatible = (e as { code: string }).code;
      }
      await discardUnfinished();
      await session.install(compatible.pkg, compatible.publicKey);
      const restored = session.data;
      // Reinstalling the same executable does not re-run the data migration.
      await session.install(compatible.pkg, compatible.publicKey);
      const repeat = session.data;
      session.lock();
      return {
        failure,
        cancelled,
        incompatible,
        stale,
        beforeRetry,
        failurePreserved,
        failedState: failedAttempt.state,
        replacement,
        removal,
        cancellationPreserved,
        acceptedReplayPreserved,
        recoveredState: migrated.installationAttempts![interruptedId].state,
        same: original === historical,
        rows: migrated.records[module.id + "/items"],
        stored: restored.modules![module.id],
        history: repeat.modules![module.id].migrations,
      };
    },
    { first, failed, next, compatible },
  );
  expect(result.failure).toContain("Migration fixture failure");
  expect(result.failurePreserved).toBe(true);
  expect(result.failedState).toBe("failed");
  expect(result.replacement).toContain("Resume or discard");
  expect(result.removal).toContain("Resume or discard");
  expect(result.acceptedReplayPreserved).toBe(true);
  expect(result.recoveredState).toBe("accepted");
  expect(result.cancellationPreserved).toBe(true);
  expect(result.cancelled).toBe("LOCAL_CANCELLED");
  expect(result.stale).toBe("PROFILE_CHANGED");
  expect(result.beforeRetry).toBe("1.0.0");
  expect(result.incompatible).toBe("LOCAL_SCHEMA_INCOMPATIBLE");
  expect(result.same).toBe(true);
  expect(result.rows.map((row) => row.data)).toEqual([
    { body: "Retained note" },
    { body: "Concurrent note" },
  ]);
  expect(result.stored).toMatchObject({ version: "1.1.0", schemaVersion: 2 });
  expect(result.history).toHaveLength(1);
  expect(result.history![0]).toMatchObject({
    name: "rename",
    from: 1,
    to: 2,
    release: "2.1.0",
  });
});

test("local dependency sets migrate atomically, preserve consumers and resume the entire selection offline", async ({
  page,
}) => {
  test.setTimeout(120000);
  const provider = await publishLocalPackage({ name: "Local provider" });
  const consumer = await publishLocalPackage({
    name: "Local consumer",
    dependencies: { [provider.pkg.module_id]: "^1" },
    dependencyPackages: [provider.pkg],
  });
  const schema = {
    version: 2,
    compatible: { minimum: 2, maximum: 2 },
    migrations: { rename: { from: 1, to: 2 } },
  };
  const nextProvider = await publishLocalPackage({
    id: provider.pkg.module_id,
    name: "Local provider",
    version: "2.0.0",
    field: "body",
    localStorage: schema,
  });
  const failedConsumer = await publishLocalPackage({
    id: consumer.pkg.module_id,
    name: "Local consumer",
    version: "2.0.0",
    field: "body",
    localStorage: schema,
    migrationError: true,
    dependencies: { [provider.pkg.module_id]: "^2" },
    dependencyPackages: [nextProvider.pkg],
  });
  const nextConsumer = await publishLocalPackage({
    id: consumer.pkg.module_id,
    name: "Local consumer",
    version: "2.1.0",
    field: "body",
    localStorage: schema,
    migrationDelayMs: 1200,
    dependencies: { [provider.pkg.module_id]: "^2" },
    dependencyPackages: [nextProvider.pkg],
  });
  await fixture(page);
  await page.goto("/");
  await page.context().setOffline(true);
  const result = await page.evaluate(
    async ({
      provider,
      consumer,
      nextProvider,
      failedConsumer,
      nextConsumer,
    }) => {
      const path = "/local-profile-proof.mjs";
      type SDK = typeof import("../../packages/platform/src/local-profiles") &
        typeof import("@suite/module-sdk");
      const sdk = (await import(path)) as SDK;
      const password = "correct horse battery staple";
      let session = await sdk.createLocalProfile(
        "Dependency recovery",
        password,
      );
      const id = session.id;
      const release = (published: typeof provider, prefix = "") => ({
        package: published.pkg,
        publicKey: published.publicKey,
        configuration: { prefix },
      });
      const beforeData = () =>
        JSON.stringify({
          records: session.data.records,
          modules: session.data.modules,
          receipts: session.data.receipts,
        });
      await session.installSet(consumer.pkg.module_id, [
        release(consumer),
        release(provider),
      ]);
      for (const published of [provider, consumer]) {
        const module = sdk.hydrateModule(
          published.pkg
            .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
        );
        await sdk
          .createModuleClient(module, (call) => session.execute(module, call))
          .call("capture", { text: module.id });
      }
      const before = beforeData();
      let incompatible = "",
        failed = "",
        overlap = "";
      try {
        await session.install(nextProvider.pkg, nextProvider.publicKey);
      } catch (error) {
        incompatible = (error as Error).message;
      }
      const corrupt = structuredClone(nextProvider);
      corrupt.pkg.artifact.description = "Tampered dependency";
      let signature = "";
      try {
        await session.installSet(consumer.pkg.module_id, [
          release(nextConsumer),
          release(corrupt),
        ]);
      } catch (error) {
        signature = (error as Error).message;
      }
      const preflightPreserved = beforeData() === before;
      try {
        await session.installSet(consumer.pkg.module_id, [
          release(failedConsumer),
          release(nextProvider),
        ]);
      } catch (error) {
        failed = (error as Error).message;
      }
      const failedPreserved = beforeData() === before;
      const failedId = Object.entries(session.data.installationAttempts!).find(
        ([, a]) => a.state === "failed",
      )![0];
      try {
        await session.uninstall(provider.pkg.module_id);
      } catch (error) {
        overlap = (error as Error).message;
      }
      await session.dismissInstallation(failedId);
      const controller = new AbortController();
      const pending = session.installSet(
        consumer.pkg.module_id,
        [
          release(nextConsumer, "Consumer: "),
          release(nextProvider, "Provider: "),
        ],
        { signal: controller.signal },
      );
      while (
        !Object.values(session.data.installationAttempts ?? {}).some(
          (a) => a.state === "pending",
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      try {
        await pending;
      } catch {}
      const interruptedPreserved = beforeData() === before;
      const attemptId = Object.entries(session.data.installationAttempts!).find(
        ([, a]) => a.state === "interrupted",
      )![0];
      session.lock();
      session = await sdk.unlockLocalProfile(id, password);
      const saved = session.data.installationAttempts![attemptId];
      const savedCount =
        saved.state === "accepted" ? 0 : 1 + (saved.related?.length ?? 0);
      await session.retryInstallation(attemptId);
      const recovered = session.data;
      await session.retryInstallation(attemptId);
      const replayPreserved =
        beforeData() ===
        JSON.stringify({
          records: recovered.records,
          modules: recovered.modules,
          receipts: recovered.receipts,
        });
      const active = [provider, consumer].map(
        (p) => session.data.modules![p.pkg.module_id],
      );
      const rows = [provider, consumer].map(
        (p) => session.data.records[p.pkg.module_id + "/items"],
      );
      session.lock();
      return {
        incompatible,
        signature,
        failed,
        overlap,
        preflightPreserved,
        failedPreserved,
        interruptedPreserved,
        savedCount,
        replayPreserved,
        active,
        rows,
      };
    },
    { provider, consumer, nextProvider, failedConsumer, nextConsumer },
  );
  expect(result.incompatible).toContain("compatible official release set");
  expect(result.signature).toContain("checksum");
  expect(result.failed).toContain("Migration fixture failure");
  expect(result.overlap).toContain("Resume or discard");
  expect(
    result.preflightPreserved &&
      result.failedPreserved &&
      result.interruptedPreserved &&
      result.replayPreserved,
  ).toBe(true);
  expect(result.savedCount).toBe(2);
  expect(
    result.active.map((m) => [
      m.version,
      m.schemaVersion,
      m.migrations?.length,
    ]),
  ).toEqual([
    ["2.0.0", 2, 1],
    ["2.1.0", 2, 1],
  ]);
  expect(result.rows.map((rows) => rows.map((r) => r.data))).toEqual([
    [{ body: provider.pkg.module_id }],
    [{ body: consumer.pkg.module_id }],
  ]);
  expect(result.active[0].releases["2.0.0"].configuration).toEqual({
    prefix: "Provider: ",
  });
  expect(result.active[1].releases["2.1.0"].configuration).toEqual({
    prefix: "Consumer: ",
  });
});

test("encrypted local download sets reject invalid bytes, foreign sources, cancellation and stale-window commits", async ({
  page,
}) => {
  const provider = await publishLocalPackage({
    name: "Download contract provider",
  });
  const root = await publishLocalPackage({
    dependencies: { [provider.pkg.module_id]: "^1" },
    dependencyPackages: [provider.pkg],
  });
  const newer = await publishLocalPackage({
    id: root.pkg.module_id,
    version: "1.1.0",
    dependencies: { [provider.pkg.module_id]: "^1" },
    dependencyPackages: [provider.pkg],
  });
  await fixture(page);
  await page.goto("/");
  const result = await page.evaluate(
    async ({ provider, root, newer }) => {
      const path = "/local-profile-proof.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../packages/platform/src/local-profiles") &
        Pick<
          typeof import("@suite/module-sdk"),
          "hydrateModule" | "createModuleClient"
        > &
        Pick<
          typeof import("../../packages/app-web/src/local-module-download"),
          "resumeLocalDownload"
        >;
      const pass = "correct horse battery staple";
      let session = await sdk.createLocalProfile("Download contracts", pass);
      const profile = session.id,
        source = { userId: "account-one", workspaceId: "personal-one" };
      const definitions = [provider, root].map((p) =>
        sdk.hydrateModule(
          p.pkg
            .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
        ),
      );
      const id = await session.beginDownload(
        root.pkg.module_id,
        source,
        definitions,
      );
      const failure = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return "NOT_REJECTED";
        } catch (error) {
          return (error as Error).message;
        }
      };
      const repeated = await session.beginDownload(
        root.pkg.module_id,
        source,
        definitions,
      );
      const invalid = structuredClone(provider.pkg);
      invalid.artifact.name = "Invalid";
      const corrupt = await failure(() =>
        session.saveDownload(id, invalid, provider.publicKey),
      );
      const changed = await failure(() =>
        session.saveDownload(id, newer.pkg, newer.publicKey),
      );
      const incomplete = await failure(() => session.installDownload(id, {}));
      await session.saveDownload(id, provider.pkg, provider.publicKey);
      await session.saveDownload(id, provider.pkg, provider.publicKey);
      session.lock();
      session = await sdk.unlockLocalProfile(profile, pass);
      const recovered = session.data.downloads![id].modules.filter(
        (m) => m.release,
      ).length;
      const offline = await failure(() =>
        sdk.resumeLocalDownload(
          session,
          id,
          undefined,
          new AbortController().signal,
        ),
      );
      let networkCalls = 0;
      const foreign = await failure(() =>
        sdk.resumeLocalDownload(
          session,
          id,
          {
            userId: "account-two",
            workspaceId: source.workspaceId,
            online: true,
            client: {
              request: async () => {
                networkCalls++;
                throw Error("Network must not run");
              },
            } as unknown as import("../../packages/api-client/src").SuiteClient,
          },
          new AbortController().signal,
        ),
      );
      const abort = new AbortController();
      abort.abort();
      const cancelled = await failure(() =>
        session.saveDownload(id, root.pkg, root.publicKey, {
          signal: abort.signal,
        }),
      );
      const afterCancel = session.data.downloads![id].modules.filter(
        (m) => m.release,
      ).length;
      const competitor = await sdk.unlockLocalProfile(profile, pass);
      await session.saveDownload(id, root.pkg, root.publicKey);
      const stale = await failure(() =>
        competitor.saveDownload(id, root.pkg, root.publicKey),
      );
      competitor.lock();
      const invalidConfiguration = await failure(() =>
        session.installDownload(id, { [root.pkg.module_id]: { prefix: 1 } }),
      );
      const retained = Boolean(session.data.downloads?.[id]);
      session.lock();
      session = await sdk.unlockLocalProfile(profile, pass);
      await sdk.resumeLocalDownload(
        session,
        id,
        undefined,
        new AbortController().signal,
      );
      await session.installDownload(id, {
        [root.pkg.module_id]: { prefix: "Downloaded: " },
      });
      const accepted = Object.values(
        session.data.installationAttempts ?? {},
      ).every((a) => a.state === "accepted");
      const removed = !session.data.downloads?.[id];
      const client = sdk.createModuleClient(definitions[1], (call) =>
        session.execute(definitions[1], call),
      );
      await client.call("capture", { text: "Retained record" });
      const records = JSON.stringify(session.data.records);
      const other = await session.beginDownload(root.pkg.module_id, source, [
        definitions[1],
      ]);
      await session.saveDownload(other, root.pkg, root.publicKey);
      await session.dismissDownload(other);
      const preserved =
        JSON.stringify(session.data.records) === records &&
        session.data.modules?.[root.pkg.module_id].active;
      const isolated = await sdk.createLocalProfile(
        "Isolated download profile",
        pass,
      );
      const isolatedCount = Object.keys(isolated.data.downloads ?? {}).length;
      isolated.lock();
      session.lock();
      return {
        id,
        repeated,
        corrupt,
        changed,
        incomplete,
        recovered,
        offline,
        foreign,
        networkCalls,
        cancelled,
        afterCancel,
        stale,
        invalidConfiguration,
        retained,
        accepted,
        removed,
        preserved,
        isolatedCount,
      };
    },
    { provider, root, newer },
  );
  expect(result.repeated).toBe(result.id);
  expect(result.corrupt).toMatch(/signature|checksum/i);
  expect(result.changed).toContain("release changed");
  expect(result.incomplete).toContain("Finish downloading");
  expect(result.recovered).toBe(1);
  expect(result.offline).toContain("Reconnect");
  expect(result.foreign).toContain("original account");
  expect(result.networkCalls).toBe(0);
  expect(result.cancelled).toContain("cancelled");
  expect(result.afterCancel).toBe(1);
  expect(result.stale).toContain("another window");
  expect(result.invalidConfiguration).not.toBe("NOT_REJECTED");
  expect(
    result.retained && result.accepted && result.removed && result.preserved,
  ).toBe(true);
  expect(result.isolatedCount).toBe(0);
});

test("cross-module reference grants persist and stale, foreign or unverified workers cannot reuse them", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await page.context().setOffline(true);
  const result = await page.evaluate(async () => {
    const path = "/local-profile-proof.mjs";
    const sdk = (await import(
      path
    )) as typeof import("../../packages/platform/src/local-profiles") &
      typeof import("../../packages/platform/src/local-worker") & {
        module: typeof import("../../modules/contacts/module").default;
        projects: typeof import("../../modules/projects/module").default;
        createModuleClient: typeof import("@suite/module-sdk").createModuleClient;
      };
    const password = "correct horse battery staple";
    let owner = await sdk.createLocalProfile("Scoped references", password);
    const profileId = owner.id;
    const created = await sdk
      .createModuleClient(sdk.module, (call) => owner.execute(sdk.module, call))
      .resource("contacts")
      .create({
        name: "Scoped contact",
        kind: "person",
        relationship: "customer",
      });
    const references = (session: typeof owner) =>
      sdk
        .createModuleClient(sdk.projects, (call) =>
          session.execute(sdk.projects, call),
        )
        .resource("projects")
        .references({ field: "/properties/contactId" });
    const code = async (action: () => Promise<unknown>) => {
      try {
        await action();
        return "unexpected success";
      } catch (error) {
        return (error as { code: string }).code;
      }
    };
    const denied = await code(() => references(owner));
    await owner.setReferenceAccess("projects", "contacts", "contacts", true);
    owner.lock();
    owner = await sdk.unlockLocalProfile(profileId, password);
    const allowed = await references(owner);
    const competing = await sdk.unlockLocalProfile(profileId, password);
    await competing.setReferenceAccess(
      "projects",
      "contacts",
      "contacts",
      false,
    );
    const staleRead = await code(() => references(owner));
    const staleWrite = await code(() =>
      sdk
        .createModuleClient(sdk.projects, (call) =>
          owner.execute(sdk.projects, call),
        )
        .resource("projects")
        .create({
          name: "Must not commit",
          status: "planned",
          contactId: created.id,
        }),
    );
    competing.lock();
    owner.lock();
    owner = await sdk.unlockLocalProfile(profileId, password);
    const revoked = await code(() => references(owner));
    const unchanged = owner.data.records["projects/projects"] ?? [];
    const foreign = await sdk.createLocalProfile("Other scope", password);
    const foreignDenied = await code(() => references(foreign));
    await foreign.setReferenceAccess("projects", "contacts", "contacts", true);
    const foreignRows = await references(foreign);
    const worker = new sdk.LocalWorkerHost();
    const unverified = await code(() =>
      worker.run(sdk.projects, {
        profileId,
        configuration: {},
        snapshot: { records: {}, receipts: {} },
        call: {
          moduleId: "projects",
          moduleVersion: sdk.projects.version,
          action: "references",
          resource: "projects",
          input: { field: "/properties/contactId" },
        },
        referenceProviders: [
          {
            profileId,
            module: { ...sdk.module, name: "Forged provider" },
            resources: ["contacts"],
            records: { contacts: [created] },
          },
        ],
      }),
    );
    worker.close();
    owner.lock();
    const locked = await code(() => references(owner));
    foreign.lock();
    await sdk.removeLocalProfile(profileId);
    await sdk.removeLocalProfile(foreign.id);
    return {
      denied,
      allowed: allowed.items,
      staleRead,
      staleWrite,
      revoked,
      unchanged,
      foreignDenied,
      foreignRows: foreignRows.items,
      unverified,
      locked,
    };
  });
  expect(result).toMatchObject({
    denied: "LOCAL_SCOPE_DENIED",
    allowed: [{ label: "Scoped contact" }],
    staleRead: "PROFILE_CHANGED",
    staleWrite: "PROFILE_CHANGED",
    revoked: "LOCAL_SCOPE_DENIED",
    unchanged: [],
    foreignDenied: "LOCAL_SCOPE_DENIED",
    foreignRows: [],
    unverified: "LOCAL_OPERATION_FAILED",
    locked: "PROFILE_LOCKED",
  });
});

test("signed local reference providers require renewed consent after updates and uninstall", async ({
  page,
}) => {
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKey = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const base = {
    version: "1.0.0",
    host: "^1",
    backend: "^1",
    publisher: "suite",
    description: "Reference grant acceptance",
    configuration: Type.Object({}),
    operations: {},
  };
  const target = defineModule({
    ...base,
    id: "grant-target",
    name: "Grant target",
    dependencies: {},
    permissions: ["grant-target.targets.read", "grant-target.targets.write"],
    resources: {
      targets: resource(
        { name: field.text() },
        { title: "Targets", standalone: true },
      ),
    },
  });
  const source = defineModule({
    ...base,
    id: "grant-source",
    name: "Grant source",
    dependencies: { "grant-target": "^1" },
    permissions: ["grant-source.notes.read", "grant-source.notes.write"],
    resources: {
      notes: resource(
        { name: field.text(), targetId: field.reference(target.id, "targets") },
        { title: "Notes", standalone: true },
      ),
    },
  });
  const packages = {
    target: signPackage(target, privateKey),
    source: signPackage(source, privateKey),
    targetNext: signPackage({ ...target, version: "1.1.0" }, privateKey),
    sourceNext: signPackage({ ...source, version: "1.1.0" }, privateKey),
  };
  await fixture(page);
  await page.goto("/");
  await page.context().setOffline(true);
  const result = await page.evaluate(
    async ({ packages, publicKey }) => {
      const path = "/local-profile-proof.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../packages/platform/src/local-profiles") &
        typeof import("../../packages/platform/src/local-worker") & {
          createModuleClient: typeof import("@suite/module-sdk").createModuleClient;
          hydrateModule: typeof import("@suite/module-sdk").hydrateModule;
        };
      const session = await sdk.createLocalProfile(
        "Signed grants",
        "correct horse battery staple",
      );
      const moduleOf = (pkg: typeof packages.source) =>
        sdk.hydrateModule(
          pkg.artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
        );
      const client = (pkg: typeof packages.source) =>
        sdk.createModuleClient(moduleOf(pkg), (call) =>
          session.execute(moduleOf(pkg), call),
        );
      const references = (pkg: typeof packages.source) =>
        client(pkg)
          .resource("notes")
          .references({ field: "/properties/targetId" });
      const code = async (action: () => Promise<unknown>) => {
        try {
          await action();
          return "unexpected success";
        } catch (error) {
          return (error as { code?: string }).code ?? "rejected";
        }
      };
      await session.installSet(
        "grant-source",
        [packages.target, packages.source].map((pkg) => ({
          package: pkg,
          publicKey,
          configuration: {},
        })),
      );
      const target = await client(packages.target)
        .resource("targets")
        .create({ name: "Signed target" });
      const denied = await code(() => references(packages.source));
      await session.setReferenceAccess(
        "grant-source",
        "grant-target",
        "targets",
        true,
      );
      const first = await references(packages.source);
      const note = await client(packages.source)
        .resource("notes")
        .create({ name: "Retained link", targetId: target.id });
      await session.install(packages.sourceNext, publicKey);
      const consumerUpdate = await code(() => references(packages.sourceNext));
      await session.setReferenceAccess(
        "grant-source",
        "grant-target",
        "targets",
        true,
      );
      await session.install(packages.targetNext, publicKey);
      const providerUpdate = await code(() => references(packages.sourceNext));
      await session.setReferenceAccess(
        "grant-source",
        "grant-target",
        "targets",
        true,
      );
      const next = await references(packages.sourceNext);
      const worker = new sdk.LocalWorkerHost();
      const corrupt = await code(() =>
        worker.run(
          moduleOf(packages.sourceNext),
          {
            profileId: session.id,
            configuration: {},
            snapshot: { records: {}, receipts: {} },
            call: {
              moduleId: "grant-source",
              moduleVersion: "1.1.0",
              action: "references",
              resource: "notes",
              input: { field: "/properties/targetId" },
            },
            referenceProviders: [
              {
                profileId: session.id,
                module: moduleOf(packages.targetNext),
                resources: ["targets"],
                records: {
                  targets: [{ ...target, data: { name: "Signed target" } }],
                },
              },
            ],
          },
          {
            artifact: { package: packages.sourceNext, publicKey },
            referenceArtifacts: {
              "grant-target": {
                package: { ...packages.targetNext, signature: "invalid" },
                publicKey,
              },
            },
          },
        ),
      );
      worker.close();
      await session.uninstall("grant-source");
      await session.install(packages.sourceNext, publicKey);
      const reinstall = await code(() => references(packages.sourceNext));
      const retained = session.data.records["grant-source/notes"].map(
        (row) => row.id,
      );
      session.lock();
      await sdk.removeLocalProfile(session.id);
      return {
        denied,
        first: first.items.map((row) => row.label),
        consumerUpdate,
        providerUpdate,
        next: next.items.map((row) => row.label),
        corrupt,
        reinstall,
        retained: retained.includes(note.id),
      };
    },
    { packages, publicKey },
  );
  expect(result).toEqual({
    denied: "LOCAL_SCOPE_DENIED",
    first: ["Signed target"],
    consumerUpdate: "LOCAL_SCOPE_DENIED",
    providerUpdate: "LOCAL_SCOPE_DENIED",
    next: ["Signed target"],
    corrupt: "LOCAL_OPERATION_FAILED",
    reinstall: "LOCAL_SCOPE_DENIED",
    retained: true,
  });
});
