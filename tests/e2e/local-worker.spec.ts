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
