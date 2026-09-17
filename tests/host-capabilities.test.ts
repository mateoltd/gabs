import { it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonical } from "@suite/module-sdk/registry";
import { capability, createModuleHost, defineModule } from "@suite/module-sdk";
import { verifyCapabilityManifest } from "@suite/module-sdk/host-capabilities";
import { verifyArtifact } from "@suite/module-sdk/verification";
import { renderModuleDocumentation } from "@suite/module-sdk/documentation";
import {
  signPackage,
  verifyPackage,
} from "../packages/module-sdk/node/signing";
import { ModuleHostSessions } from "../apps/desktop/src/module-capabilities";
import module from "./fixtures/host-capabilities/module";
it("infers only declared capability names, inputs and outcomes and rejects malformed host replies", async () => {
  const calls: unknown[] = [];
  const host = createModuleHost(module, async (call) => {
    calls.push(call);
    return { status: "offered" };
  });
  expect(
    await host.call("export", { filename: "notes.txt", content: "Typed" }),
  ).toEqual({ status: "offered" });
  expect(calls[0]).toMatchObject({
    moduleId: module.id,
    moduleVersion: module.version,
    capability: "export",
  });
  if (false) {
    // @ts-expect-error Undeclared host actions cannot be called.
    await host.call("filesystem", {});
    // @ts-expect-error Export content stays a string.
    await host.call("export", { filename: "notes.txt", content: 42 });
    // @ts-expect-error Capability kinds cannot name arbitrary desktop APIs.
    capability({ kind: "shell.exec", permission: "custom-notes.export" });
    defineModule({
      ...module,
      capabilities: {
        // @ts-expect-error Host declarations must reference a declared permission.
        export: capability({ kind: "files.export", permission: "unknown" }),
      },
    });
    const result = await host.call("notify", {
      title: "Title",
      message: "Message",
    });
    // @ts-expect-error Notification results do not have export status.
    result.status;
  }
  await expect(
    host.call("export", { filename: "../../secret.txt", content: "x" }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
  await expect(
    createModuleHost(module, async () => ({ status: "confirmed" })).call(
      "export",
      { filename: "notes.txt", content: "x" },
    ),
  ).rejects.toMatchObject({ code: "CAPABILITY_RESPONSE_INVALID" });
  expect(() =>
    defineModule({
      ...module,
      capabilities: {
        export: { kind: "files.export", permission: "custom-notes.open.fake" },
      },
    } as never),
  ).toThrow();
  expect(() =>
    defineModule({
      ...module,
      permissions: [...module.permissions, "workspace.manage"],
      capabilities: {
        export: { kind: "files.export", permission: "workspace.manage" },
      },
    }),
  ).toThrow("Invalid or undeclared host capability");
});
it("signs and verifies exact capability metadata and generates schemas and permission documentation", async () => {
  const pair = generateKeyPairSync("ed25519"),
    privateKey = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKey = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  const generated = { ...module, views: undefined, navigation: undefined };
  const pkg = signPackage(generated, privateKey);
  expect(pkg.manifest.capabilities).toEqual(module.capabilities);
  verifyPackage(pkg, publicKey);
  await verifyArtifact(pkg, publicKey);
  expect(() =>
    verifyCapabilityManifest(pkg.artifact, {
      ...pkg.manifest,
      capabilities: {},
    }),
  ).toThrow("signed manifest");
  const manifest = { ...pkg.manifest, capabilities: {} };
  const mismatched = {
    ...pkg,
    manifest,
    signature: sign(
      null,
      Buffer.from(canonical({ manifest, digest: pkg.digest })),
      privateKey,
    ).toString("base64"),
  };
  expect(() => verifyPackage(mismatched, publicKey)).toThrow("signed manifest");
  await expect(verifyArtifact(mismatched, publicKey)).rejects.toThrow(
    "signed manifest",
  );
  const reference = renderModuleDocumentation(module);
  expect(reference).toContain("## Host capabilities");
  expect(reference).toContain("custom-notes.export");
  expect(reference).toContain("files.export");
  expect(reference).toContain('"offered"');
});
it("native sessions recheck authority after dialogs and reject closed, switched or mismatched contexts before an effect", async () => {
  let user: string | undefined = "actor";
  const sessions = new ModuleHostSessions(() => user),
    scope = { userId: "actor", workspaceId: "company" };
  const handle = sessions.open(scope, module.id, module.version);
  let grants = 0,
    effects = 0,
    deny = false;
  const authorize = async () => {
    grants++;
    if (deny) throw Error("Permission revoked");
    return {
      ...scope,
      moduleId: module.id,
      moduleVersion: module.version,
      capability: "export",
      kind: "files.export",
    };
  };
  const input = { filename: "notes.txt", content: "Typed" };
  await expect(
    sessions.execute(handle, "export", input, {
      authorize,
      invoke: async (_a, _i, recheck) => {
        deny = true;
        await recheck();
        effects++;
        return { status: "saved" };
      },
    }),
  ).rejects.toThrow("revoked");
  expect(grants).toBe(2);
  expect(effects).toBe(0);
  deny = false;
  await expect(
    sessions.execute(handle, "export", input, {
      authorize,
      invoke: async (_a, _i, recheck) => {
        sessions.close(handle);
        await recheck();
        effects++;
        return { status: "saved" };
      },
    }),
  ).rejects.toThrow("no longer active");
  const next = sessions.open(scope, module.id, module.version);
  user = "other";
  await expect(
    sessions.execute(next, "export", input, {
      authorize,
      invoke: async () => {
        effects++;
        return { status: "saved" };
      },
    }),
  ).rejects.toThrow("no longer active");
  user = "actor";
  await expect(
    sessions.execute(next, "export", input, {
      authorize: async () => ({ ...(await authorize()), workspaceId: "other" }),
      invoke: async () => {
        effects++;
        return { status: "saved" };
      },
    }),
  ).rejects.toThrow("does not match");
  expect(effects).toBe(0);
  sessions.clear();
  await expect(
    sessions.execute(next, "export", input, {
      authorize,
      invoke: async () => ({ status: "saved" }),
    }),
  ).rejects.toThrow("no longer active");
});
