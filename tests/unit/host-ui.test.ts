import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ui from "@suite/ui-web";
import {
  assertViewHost,
  describeViewHost,
  validateViewRequirements,
  viewUIExports,
  viewReactExports,
} from "@suite/module-sdk/host-ui";
import {
  assertClientHost,
  assertManifestHost,
} from "@suite/module-sdk/client-artifact";
import { canonical } from "@suite/module-sdk/registry";
import { verifyArtifact } from "@suite/module-sdk/verification";
import { buildClientViews } from "../../packages/sdk/node/build-client";
import { signPackage, verifyPackage } from "../../packages/sdk/node/signing";
import module from "../fixtures/custom-notes/module";
const host = {
  react: React,
  jsx,
  ui,
  capabilities: describeViewHost({ react: React, jsx, ui }),
};
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
async function build(source: string, files: Record<string, string> = {}) {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/host-ui-"));
  try {
    for (const [name, contents] of Object.entries({
      "view.tsx": source,
      ...files,
    }))
      await writeFile(resolve(directory, name), contents);
    return await buildClientViews(
      {
        ...module,
        views: { home: { ...module.views.home, stylesheet: undefined } },
      },
      directory,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
it("derives named, aliased and reexported value requirements without type-only dependencies", async () => {
  const client = await build(
    `
    import { Action } from "./controls";
    import type { Input } from "@suite/ui-web";
    import { useState as state } from "react";
    export default function View() { const [value] = state("Ready"); return <Action>{value}</Action>; }
  `,
    { "controls.ts": "export { Button as Action } from '@suite/ui-web';" },
  );
  expect(client.home.requires).toEqual({
    "view.context": 1,
    "client.resources": 3,
    "ui.Button": 1,
    "react.useState": 1,
    "jsx.jsx": 1,
    "jsx.jsxs": 1,
    "jsx.Fragment": 1,
  });
  const entry = await import(
    `data:text/javascript;base64,${Buffer.from(client.home.javascript).toString("base64")}`
  );
  expect(typeof entry.createView(host)).toBe("function");
});
it("conservatively requires namespace and dynamic host exports", async () => {
  for (const source of [
    `import * as ui from '@suite/ui-web'; export default function View() { return ui.Button; }`,
    `export default async function View() { return (await import('@suite/ui-web')).Button; }`,
  ]) {
    const client = await build(source);
    expect(
      Object.keys(client.home.requires!)
        .filter((name) => name.startsWith("ui."))
        .sort(),
    ).toEqual(viewUIExports.map((name) => `ui.${name}`).sort());
  }
});
it("recognizes React default reexports and literal CommonJS host imports", async () => {
  const client = await build(
    `import { React } from './bridge'; export default function View(){ return React.createElement('p',null,'Ready'); }`,
    { "bridge.ts": "export { default as React } from 'react';" },
  );
  expect(
    Object.keys(client.home.requires!)
      .filter((name) => name.startsWith("react."))
      .sort(),
  ).toEqual(viewReactExports.map((name) => `react.${name}`).sort());
  const common = await build(
    `const { Button } = require('@suite/ui-web'); export default Button;`,
  );
  expect(
    Object.keys(common.home.requires!)
      .filter((name) => name.startsWith("ui."))
      .sort(),
  ).toEqual(viewUIExports.map((name) => `ui.${name}`).sort());
});
it("rejects old or incompatible hosts before executing module initialization", async () => {
  const client = await build(
    `import { Button } from '@suite/ui-web'; globalThis.__suiteCompatibilityProbe = 'executed'; export default Button;`,
  );
  const entry = await import(
    `data:text/javascript;base64,${Buffer.from(client.home.javascript).toString("base64")}`
  );
  const global = globalThis as typeof globalThis & {
    __suiteCompatibilityProbe?: string;
  };
  try {
    expect(() =>
      entry.createView({
        ...host,
        capabilities: { ...host.capabilities, "client.resources": [1, 2] },
      }),
    ).toThrow(/client.resources revision 3/);
    expect(global.__suiteCompatibilityProbe).toBeUndefined();
    expect(() => entry.createView({ react: React, jsx, ui })).toThrow(
      /view.context revision 1/,
    );
    expect(() =>
      entry.createView({
        ...host,
        capabilities: describeViewHost({ react: React, jsx, ui: {} }),
      }),
    ).toThrow(/ui.Button revision 1/);
    expect(() =>
      entry.createView({
        ...host,
        capabilities: { ...host.capabilities, "ui.Button": [2] },
      }),
    ).toThrow(/ui.Button revision 1/);
    expect(global.__suiteCompatibilityProbe).toBeUndefined();
    expect(entry.createView(host)).toBe(ui.Button);
    expect(global.__suiteCompatibilityProbe).toBe("executed");
  } finally {
    delete global.__suiteCompatibilityProbe;
  }
});
it("signs the exact requirements and verifies correspondence in both verifiers", async () => {
  const client = await build(
    `import { Button } from '@suite/ui-web'; export default Button;`,
  );
  const pkg = signPackage(module, privateKey, client);
  expect(pkg.manifest.clientRequirements).toEqual({
    home: client.home.requires,
  });
  verifyPackage(pkg, publicKey);
  await verifyArtifact(pkg, publicKey);
  const mismatch = structuredClone(pkg);
  mismatch.manifest.clientRequirements = { home: { "ui.Button": 99 } };
  expect(() => verifyPackage(mismatch, publicKey)).toThrow(/signature/);
  mismatch.signature = sign(
    null,
    Buffer.from(
      canonical({ manifest: mismatch.manifest, digest: mismatch.digest }),
    ),
    privateKey,
  ).toString("base64");
  expect(() => verifyPackage(mismatch, publicKey)).toThrow(
    /requirements do not match/,
  );
  await expect(verifyArtifact(mismatch, publicKey)).rejects.toThrow(
    /requirements do not match/,
  );
  const future = signPackage(module, privateKey, {
    home: { ...client.home, requires: { "ui.Button": 99 } },
  });
  verifyPackage(future, publicKey);
  expect(() => assertManifestHost(future.manifest, host.capabilities)).toThrow(
    /ui.Button revision 99/,
  );
  expect(() => assertClientHost(future.artifact, host.capabilities)).toThrow(
    /ui.Button revision 99/,
  );
});
it("retains legacy packages and bounds malformed requirements", () => {
  const legacy = signPackage(module, privateKey, {
    home: {
      format: "suite-view-v1",
      javascript: "export const createView = () => null;",
      css: "",
    },
  });
  expect(legacy.manifest).not.toHaveProperty("clientRequirements");
  verifyPackage(legacy, publicKey);
  assertClientHost(legacy.artifact, {});
  assertManifestHost(legacy.manifest, {});
  for (const bad of [
    null,
    [],
    1,
    { "ui.Button": 0 },
    { "ui.Button": 1.5 },
    { "ui.Button": 1001 },
    { "arbitrary.Name": 1 },
    Object.fromEntries(
      Array.from({ length: 129 }, (_, i) => [`ui.Name${i}`, 1]),
    ),
  ])
    expect(() => validateViewRequirements(bad)).toThrow(/Invalid host/);
  expect(() =>
    assertViewHost({ "ui.FutureControl": 1 }, host.capabilities),
  ).toThrow(/Update the application/);
  expect(Object.isFrozen(host.capabilities)).toBe(true);
  expect(Object.isFrozen(host.capabilities["ui.Button"])).toBe(true);
  expect(
    describeViewHost({ react: {}, jsx: {}, ui: { Button: undefined } }),
  ).not.toHaveProperty("ui.Button");
});

it("requires host revision 2 for signed offline LAN declarations while keeping online LAN compatible", async () => {
  const { default: lan } = await import("../fixtures/lan-capabilities/module");
  const client = await buildClientViews(
    lan,
    resolve("tests/fixtures/lan-capabilities"),
  );
  const pkg = signPackage(lan, privateKey, client);
  expect(client.home.requires?.["client.host"]).toBe(2);
  verifyPackage(pkg, publicKey);
  await verifyArtifact(pkg, publicKey);
  const oldHost = { ...host.capabilities, "client.host": [1] };
  expect(() => assertManifestHost(pkg.manifest, oldHost)).toThrow(
    /client.host revision 2/,
  );
  expect(() => assertClientHost(pkg.artifact, oldHost)).toThrow(
    /client.host revision 2/,
  );
  const entry = await import(
    `data:text/javascript;base64,${Buffer.from(client.home.javascript).toString("base64")}`
  );
  expect(() => entry.createView({ ...host, capabilities: oldHost })).toThrow(
    /client.host revision 2/,
  );
  expect(() => assertClientHost(pkg.artifact, host.capabilities)).not.toThrow();
  const online = {
    ...lan,
    capabilities: Object.fromEntries(
      Object.entries(lan.capabilities).map(([name, declaration]) => {
        const { offline, ...rest } = declaration;
        return [name, rest];
      }),
    ),
  };
  const compatible = await buildClientViews(
    online,
    resolve("tests/fixtures/lan-capabilities"),
  );
  expect(compatible.home.requires?.["client.host"]).toBe(1);
});
