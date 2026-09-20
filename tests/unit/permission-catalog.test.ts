import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { Tx } from "../../packages/server/src/persistence/database";
import { workspacePermissionCatalog } from "../../packages/server/src/registry/module-releases";
import { signPackage } from "../../packages/sdk/node/signing";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import original from "../fixtures/queued-notes/module";
const pair = generateKeyPairSync("ed25519");
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
afterEach(() => vi.unstubAllEnvs());
it("derives current and historical declarations from exact verified content, excluding platform grants", async () => {
  vi.stubEnv("MODULE_SIGNING_PUBLIC_KEY", publicKey);
  const historical = {
    ...original,
    views: undefined,
    navigation: undefined,
    permissions: [...original.permissions, "members.manage"],
  };
  const current = {
    ...historical,
    version: "2.0.0",
    permissions: historical.permissions.filter(
      (p) => p !== "custom-notes.capture",
    ),
    operations: { names: original.operations.names },
  };
  const signed = signPackage(historical, privateKey);
  let content = JSON.stringify(signed);
  const query = {
    select: () => query,
    distinct: () => query,
    where: () => query,
    execute: async () => [
      { module_id: signed.module_id, version: signed.version, content },
    ],
  };
  const tx = { selectFrom: () => query } as unknown as Tx;
  const catalog = createModuleCatalog([current]);
  const read = () =>
    workspacePermissionCatalog(tx, "workspace", catalog, [current]);
  const permissions = await read();
  expect(
    permissions.find((p) => p.permission === "custom-notes.capture"),
  ).toEqual({
    permission: "custom-notes.capture",
    moduleId: original.id,
    current: false,
    versions: [original.version],
  });
  expect(
    permissions.find((p) => p.permission === "custom-notes.notes.read"),
  ).toMatchObject({
    current: true,
    versions: [original.version, current.version],
  });
  expect(permissions.some((p) => p.permission === "members.manage")).toBe(
    false,
  );
  const historyOnly = await workspacePermissionCatalog(
    tx,
    "workspace",
    catalog,
    [],
  );
  expect(historyOnly.some((entry) => entry.current)).toBe(false);
  expect(historyOnly.map((entry) => entry.permission)).toContain(
    "custom-notes.capture",
  );
  const shared = await workspacePermissionCatalog(tx, "workspace", catalog, [
    current,
    {
      ...current,
      id: "another-module",
      version: "3.0.0",
      permissions: ["custom-notes.capture"],
    },
  ]);
  expect(
    shared.filter((entry) => entry.permission === "custom-notes.capture"),
  ).toEqual([
    {
      permission: "custom-notes.capture",
      moduleId: "another-module",
      current: true,
      versions: ["3.0.0"],
    },
    {
      permission: "custom-notes.capture",
      moduleId: original.id,
      current: false,
      versions: [original.version],
    },
  ]);
  const altered = structuredClone(signed);
  altered.artifact.permissions = [
    ...historical.permissions,
    "custom-notes.forged",
  ];
  content = JSON.stringify(altered);
  await expect(read()).rejects.toThrow("signature or checksum");
  content = JSON.stringify(signed);
  expect(await read()).toEqual(permissions);
  vi.stubEnv(
    "MODULE_SIGNING_PUBLIC_KEY",
    generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString(),
  );
  await expect(read()).rejects.toThrow("signature or checksum");
});
