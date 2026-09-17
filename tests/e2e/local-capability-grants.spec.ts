import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import module from "../fixtures/local-capabilities";
import { defineModule } from "@suite/module-sdk";
import { signPackage } from "@suite/module-sdk/node/signing";

test("local device grants bind encrypted profiles and exact releases, revoke pending guards and survive unlock", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const first = signPackage(module, keys.privateKey),
    second = signPackage(
      defineModule({ ...module, version: "1.1.0" }),
      keys.privateKey,
    );
  const helper = await build({
    stdin: {
      contents:
        "export * from './composition/src/local/product';export {createModuleClient,hydrateModule} from '@suite/module-sdk';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  const worker = await build({
    entryPoints: [resolve("composition/src/local/worker-entry.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await context.route("**/capability-profile.mjs", (route) =>
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
    async ({ module, first, second, publicKey }) => {
      const path = "/capability-profile.mjs";
      const sdk = (await import(
        path
      )) as typeof import("../../composition/src/local/product") &
        typeof import("@suite/module-sdk");
      const password = "correct horse battery staple";
      let session = await sdk.createLocalProfile("Device profile", password);
      const id = session.id;
      const code = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return "accepted";
        } catch (error) {
          return (error as { code?: string }).code ?? "rejected";
        }
      };
      const call = {
        moduleId: module.id,
        moduleVersion: module.version,
        capability: "export",
        input: { filename: "private.txt", content: "Private text" },
      };
      await session.install(first, publicKey);
      const definition = sdk.hydrateModule(module);
      await sdk
        .createModuleClient(definition, (call) =>
          session.execute(definition, call),
        )
        .resource("notes")
        .create({ name: "Preserved note" });
      const denied = await code(() => session.prepareCapability(call));
      await session.setCapabilityAccess(module.id, "export", true);
      const guard = await session.prepareCapability(call);
      await session.install(first, publicKey);
      await guard.assertCurrent();
      const scoped =
        guard.authorization.profileId === id &&
        guard.authorization.releaseDigest === first.digest &&
        guard.authorization.permission === "device-notes.export";
      const notify = await code(() =>
        session.prepareCapability({
          ...call,
          capability: "notify",
          input: { title: "Private", message: "Hello" },
        }),
      );
      const undeclared = await code(() =>
        session.prepareCapability({ ...call, capability: "missing" }),
      );
      const malformed = await code(() =>
        session.prepareCapability({
          ...call,
          input: { filename: "../../private.txt", content: "Private" },
        }),
      );
      let immutable = false;
      try {
        (guard.call.input as { content: string }).content = "Changed";
      } catch {}
      immutable =
        (guard.call.input as { content: string }).content === "Private text";
      await session.setCapabilityAccess(module.id, "export", false);
      const revoked = await code(() => guard.assertCurrent());
      await session.setCapabilityAccess(module.id, "export", true);
      const regranted = await code(() => guard.assertCurrent());
      const unlockedGuard = await session.prepareCapability(call);
      session.lock();
      const locked = await code(() => unlockedGuard.assertCurrent());
      session = await sdk.unlockLocalProfile(id, password);
      await (await session.prepareCapability(call)).assertCurrent();
      const foreign = await sdk.createLocalProfile(
        "Other device profile",
        password,
      );
      await foreign.install(first, publicKey);
      const isolated = await code(() => foreign.prepareCapability(call));
      await foreign.setCapabilityAccess(module.id, "export", true);
      const foreignGuard = await foreign.prepareCapability(call);
      await sdk.removeLocalProfile(foreign.id);
      const removedProfile = await code(() => foreignGuard.assertCurrent());
      foreign.lock();
      const stale = await sdk.unlockLocalProfile(id, password);
      const staleGuard = await stale.prepareCapability(call);
      await session.setCapabilityAccess(module.id, "export", false);
      const otherWindow = await code(() => staleGuard.assertCurrent());
      stale.lock();
      await session.setCapabilityAccess(module.id, "export", true);
      await session.install(second, publicKey);
      const oldRelease = await code(() => session.prepareCapability(call));
      const nextCall = { ...call, moduleVersion: "1.1.0" };
      const update = await code(() => session.prepareCapability(nextCall));
      await session.install(first, publicKey);
      const rollback = await code(() => session.prepareCapability(call));
      await session.setCapabilityAccess(module.id, "export", true);
      const removedGuard = await session.prepareCapability(call);
      await session.uninstall(module.id);
      const removed = await code(() => removedGuard.assertCurrent());
      await session.install(first, publicKey);
      const reinstall = await code(() => session.prepareCapability(call));
      const records = session.data.records[`${module.id}/notes`].map(
        (record) => record.data.name,
      );
      session.lock();
      return {
        denied,
        scoped,
        notify,
        undeclared,
        malformed,
        immutable,
        revoked,
        regranted,
        locked,
        isolated,
        removedProfile,
        otherWindow,
        oldRelease,
        update,
        rollback,
        removed,
        reinstall,
        records,
      };
    },
    { module, first, second, publicKey: keys.publicKey },
  );
  expect(result).toEqual({
    denied: "CAPABILITY_DENIED",
    scoped: true,
    notify: "CAPABILITY_DENIED",
    undeclared: "CAPABILITY_UNDECLARED",
    malformed: "INVALID_INPUT",
    immutable: true,
    revoked: "CAPABILITY_DENIED",
    regranted: "CAPABILITY_DENIED",
    locked: "PROFILE_LOCKED",
    isolated: "CAPABILITY_DENIED",
    removedProfile: "PROFILE_CHANGED",
    otherWindow: "PROFILE_CHANGED",
    oldRelease: "LOCAL_UPDATE_REQUIRED",
    update: "CAPABILITY_DENIED",
    rollback: "CAPABILITY_DENIED",
    removed: "CAPABILITY_UNDECLARED",
    reinstall: "CAPABILITY_DENIED",
    records: ["Preserved note"],
  });
});
