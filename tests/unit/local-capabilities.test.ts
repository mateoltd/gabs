import { it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { defineModule } from "@suite/module-sdk";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import { signPackage } from "@suite/module-sdk/node/signing";
import {
  grantedLocalCapability,
  localCapabilityAccess,
} from "../../packages/client/src/identity/local-capabilities";
import type { LocalData } from "../../packages/client/src/identity/local-profiles";
import module from "../fixtures/local-capabilities";

const call = {
  moduleId: module.id,
  moduleVersion: module.version,
  capability: "export",
  input: { filename: "notes.txt", content: "Private" },
};
const keys = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const catalog = createModuleCatalog([]);
const data = (): LocalData => ({
  records: {},
  modules: {
    [module.id]: {
      active: true,
      version: module.version,
      releases: {
        [module.version]: {
          package: signPackage(module, keys.privateKey),
          publicKey: keys.publicKey,
          configuration: {},
        },
      },
    },
  },
});
async function grant(state: LocalData, source = catalog) {
  const choice = (await localCapabilityAccess(state, source)).find(
    (choice) => choice.capability === "export",
  )!;
  state.capabilityGrants = [
    {
      id: "reviewed-grant",
      grantedAt: 1,
      moduleId: module.id,
      moduleVersion: module.version,
      capability: choice.capability,
      releaseDigest: choice.releaseDigest,
      ...choice.declaration,
    },
  ];
}
it("verifies signed release bytes before granting device authority and rejects replaced bytes even at the same version", async () => {
  const state = data();
  await grant(state);
  expect(await grantedLocalCapability(state, catalog, call)).toMatchObject({
    id: "reviewed-grant",
    kind: "files.export",
  });
  const release = state.modules![module.id].releases[module.version];
  release.package = signPackage(
    defineModule({ ...module, description: "Different reviewed bytes" }),
    keys.privateKey,
  );
  await expect(
    grantedLocalCapability(state, catalog, call),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  release.package.artifact.description = "Tampered bytes";
  await expect(grantedLocalCapability(state, catalog, call)).rejects.toThrow(
    /checksum/,
  );
});
it("binds bundled grants to the complete module contract and excludes corporate-only definitions", async () => {
  const state: LocalData = { records: {} },
    source = createModuleCatalog([module]);
  await grant(state, source);
  expect(await grantedLocalCapability(state, source, call)).toMatchObject({
    id: "reviewed-grant",
  });
  const updated = createModuleCatalog([
    defineModule({ ...module, description: "Updated bundled contract" }),
  ]);
  await expect(
    grantedLocalCapability(state, updated, call),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  const corporate = createModuleCatalog([
    defineModule({ ...module, resources: {} }),
  ]);
  expect(await localCapabilityAccess(state, corporate)).toEqual([]);
});
it("does not reuse a grant for another alias, permission or inactive installation", async () => {
  const state = data();
  await grant(state);
  await expect(
    grantedLocalCapability(state, catalog, {
      ...call,
      capability: "notify",
      input: { title: "Private", message: "Hello" },
    }),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  state.capabilityGrants![0].permission = "device-notes.notify";
  await expect(
    grantedLocalCapability(state, catalog, call),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  state.modules![module.id].active = false;
  expect(await localCapabilityAccess(state, catalog)).toEqual([]);
});
