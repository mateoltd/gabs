import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { defineModule } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import {
  capabilityContractDigest,
  type CapabilityLeasePayload,
} from "@suite/module-sdk/capability-leases";
import base from "../fixtures/local-capabilities";

declare global {
  interface Window {
    leaseStoreTest: typeof import("../../packages/client/src/adapters/browser");
    leaseCheckStarted?: boolean;
    releaseLeaseCheck?: () => void;
    pendingLeaseCheck?: Promise<string>;
    pendingLeasePurge?: Promise<void>;
  }
}
const module = defineModule({
  ...base,
  capabilities: {
    ...base.capabilities,
    export: { ...base.capabilities.export, offline: "lease" },
  },
});
const call = {
  moduleId: module.id,
  moduleVersion: module.version,
  capability: "export",
  input: { filename: "notes.txt", content: "Cached notes" },
};

test("browser lease storage survives page restart, shares revocations across tabs and follows account/workspace purges", async ({
  page,
  context,
}) => {
  const output = await build({
    stdin: {
      contents:
        'export { browserCapabilityLeases, browserPlatform } from "./packages/client/src/adapters/browser";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2023",
  });
  const bundle = output.outputFiles[0].text;
  async function load(target: Page) {
    await target.route("**/lease-storage-test", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Lease storage acceptance</title>",
      }),
    );
    await target.goto("/lease-storage-test");
    await target.evaluate(async (code) => {
      const url = URL.createObjectURL(
        new Blob([code], { type: "text/javascript" }),
      );
      try {
        window.leaseStoreTest = await import(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }, bundle);
  }
  const signer = generateKeyPairSync("ed25519"),
    authority = {
      issuer: "https://api.suite.test",
      keyId: createHash("sha256")
        .update(signer.publicKey.export({ type: "spki", format: "der" }))
        .digest("hex"),
      publicKey: signer.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
    scope = { userId: randomUUID(), workspaceId: randomUUID() },
    foreign = { userId: randomUUID(), workspaceId: scope.workspaceId },
    expiresAt = Date.now() + 120000;
  const access = { policyRevision: "3", offlineEnabled: true, expiresAt };
  async function grant(target: Page, selected = scope, revision = "3") {
    const payload: CapabilityLeasePayload = {
      purpose: "suite:corporate-device:v1",
      id: randomUUID(),
      issuer: authority.issuer,
      membershipId: randomUUID(),
      ...selected,
      moduleId: module.id,
      moduleVersion: module.version,
      capability: "export",
      kind: "files.export",
      permission: base.capabilities.export.permission,
      contractDigest: await capabilityContractDigest(module),
      policyRevision: revision,
      issuedAt: Date.now(),
      expiresAt,
    };
    const lease = {
      payload,
      keyId: authority.keyId,
      signature: sign(
        null,
        Buffer.from(canonical(payload)),
        signer.privateKey,
      ).toString("base64"),
    };
    await target.evaluate(
      async ({ scope, module, access, authority, lease }) => {
        const host = window.leaseStoreTest.browserCapabilityLeases;
        await host.observePolicy(scope, access.policyRevision, true);
        await host.refresh(
          scope,
          module,
          "export",
          () => access,
          async () => ({ authority, lease }),
        );
      },
      {
        scope: selected,
        module,
        access: { ...access, policyRevision: revision },
        authority,
        lease,
      },
    );
  }
  async function check(target: Page, selected = scope, revision = "3") {
    return target.evaluate(
      async ({ scope, module, call, access }) => {
        try {
          const prepared =
            await window.leaseStoreTest.browserCapabilityLeases.prepare(
              scope,
              module,
              call,
              () => access,
            );
          await prepared.recheck();
          return "authorized";
        } catch (error) {
          return (error as Error).message;
        }
      },
      {
        scope: selected,
        module,
        call,
        access: { ...access, policyRevision: revision },
      },
    );
  }
  await load(page);
  await grant(page);
  await grant(page, foreign);
  expect(await check(page)).toBe("authorized");
  await page.close();
  const restarted = await context.newPage();
  await load(restarted);
  expect(await check(restarted)).toBe("authorized");
  const other = await context.newPage();
  await load(other);
  await other.evaluate(
    async (scope) =>
      window.leaseStoreTest.browserCapabilityLeases.observePolicy(
        scope,
        "4",
        false,
      ),
    scope,
  );
  expect(await check(restarted)).toContain("disabled");
  expect(await check(restarted, foreign)).toBe("authorized");
  await grant(other, scope, "5");
  expect(await check(restarted, scope, "5")).toBe("authorized");
  // Hold real signature verification while a second tab starts a workspace purge.
  await restarted.evaluate(
    ({ scope, module, call, access }) => {
      const verify = crypto.subtle.verify.bind(crypto.subtle);
      crypto.subtle.verify = async (
        ...args: Parameters<SubtleCrypto["verify"]>
      ) => {
        window.leaseCheckStarted = true;
        await new Promise<void>((resolve) => {
          window.releaseLeaseCheck = resolve;
        });
        return verify(...args);
      };
      window.pendingLeaseCheck = window.leaseStoreTest.browserCapabilityLeases
        .prepare(scope, module, call, () => access)
        .then(
          () => "authorized",
          (error: Error) => error.message,
        )
        .finally(() => {
          crypto.subtle.verify = verify;
        });
    },
    { scope, module, call, access: { ...access, policyRevision: "5" } },
  );
  await restarted.waitForFunction(() => window.leaseCheckStarted);
  await other.evaluate((scope) => {
    window.pendingLeasePurge =
      window.leaseStoreTest.browserPlatform.purgeWorkspace(scope);
  }, scope);
  await expect
    .poll(() =>
      other.evaluate(
        async () =>
          (await navigator.locks.query()).pending?.some(
            (lock) => lock.name === "suite-capability-leases",
          ) ?? false,
      ),
    )
    .toBe(true);
  await restarted.evaluate(() => window.releaseLeaseCheck!());
  await restarted.evaluate(() => window.pendingLeaseCheck);
  await other.evaluate(() => window.pendingLeasePurge);
  expect(await check(restarted, scope, "5")).toContain("No offline");
  expect(await check(restarted, foreign)).toBe("authorized");
  await other.evaluate(
    async (userId) => window.leaseStoreTest.browserPlatform.purgeUser(userId),
    foreign.userId,
  );
  expect(await check(restarted, foreign)).toContain("No offline");
  // A key learned under another account invalidates retained grants throughout the origin.
  await grant(restarted, scope, "5");
  await grant(restarted, foreign);
  const rotatedSigner = generateKeyPairSync("ed25519");
  const rotatedAuthority = {
    issuer: authority.issuer,
    keyId: createHash("sha256")
      .update(rotatedSigner.publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
    publicKey: rotatedSigner.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
  await other.evaluate(
    async ({ scope, authority }) => {
      await window.leaseStoreTest.browserCapabilityLeases.observeAuthority(
        scope,
        async () => authority,
        () => {},
      );
    },
    { scope: foreign, authority: rotatedAuthority },
  );
  expect(await check(restarted, scope, "5")).toContain("authority changed");
  // Removing the account that learned the key must not erase public trust history.
  await other.evaluate(async (userId) => {
    await window.leaseStoreTest.browserPlatform.purgeUser(userId);
  }, foreign.userId);
  await other.close();
  await restarted.close();
  const afterRotation = await context.newPage();
  await load(afterRotation);
  expect(await check(afterRotation, scope, "5")).toContain("No offline");
  await expect(grant(afterRotation, foreign)).rejects.toThrow(/retired/);
  await afterRotation.close();
});
