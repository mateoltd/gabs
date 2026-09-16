import { publishLocalPackage } from "../local-package-fixture";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
async function fixture(page: Page) {
  const source = await build({
    stdin: {
      contents: `export * from './packages/platform/src/local-profiles';export {createModuleClient,hydrateModule} from '@suite/module-sdk';export {default as module} from './modules/contacts/module';`,
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
  expect(workers).toBeGreaterThanOrEqual(5);
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
