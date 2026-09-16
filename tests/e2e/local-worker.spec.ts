import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
async function fixture(page: Page) {
  const source = await build({
    stdin: {
      contents: `export * from './packages/platform/src/local-profiles';export {createModuleClient} from '@suite/module-sdk';export {default as module} from './modules/contacts/module';`,
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
