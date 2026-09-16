import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { buildClientViews } from "../packages/module-sdk/node/build-client";
import {
  signPackage,
  verifyPackage,
} from "../packages/module-sdk/node/signing";
import {
  validateClientArtifacts,
  moduleContract,
} from "@suite/module-sdk/client-artifact";
import {
  defineView,
  checkpointValue,
  restoreViewCheckpoint,
  type ViewStateMetadata,
} from "@suite/module-sdk/ui";
import { defineModule, hydrateModule, Type } from "@suite/module-sdk";
import module from "./fixtures/custom-notes/module";
import editable from "./fixtures/editable-notes/module";

describe("Independent executable client packages", () => {
  it("infers editable state from its declared view and rejects invalid contracts", () => {
    defineView(editable, "home", ({ state }) => {
      state.save({ name: "Typed input" });
      if (false) {
        // @ts-expect-error The declared editable state requires name.
        state.save({ title: "Wrong shape" });
        // @ts-expect-error Editable field types are inferred.
        state.save({ name: 3 });
        // @ts-expect-error Undeclared state fields cannot be accessed.
        state.value?.title;
        if (state.value) {
          // @ts-expect-error Host-owned editable state is read-only.
          state.value.name = "Cannot mutate the checkpoint";
        }
      }
      return null;
    });
    if (false) {
      // @ts-expect-error A stateless view cannot use the editable-state overload.
      defineView(module, "home", () => null);
      // @ts-expect-error Only declared view identifiers are accepted.
      defineView(editable, "missing", () => null);
      defineView(editable, "home", () => null, {
        // @ts-expect-error Restore output must match the target state's schema.
        restore: () => ({ name: 3 }),
      });
    }
    expect(() =>
      defineModule({
        ...editable,
        views: {
          home: {
            ...editable.views.home,
            state: { ...editable.views.home.state, version: 0 },
          },
        },
      }),
    ).toThrow(/editable-state/);
  });

  it("signs the stateful ABI and validates conversion after transported schema hydration", async () => {
    const client = await buildClientViews(
      editable,
      resolve("tests/fixtures/editable-notes"),
    );
    expect(client.home.format).toBe("suite-view-v2");
    const entry = await import(
      `data:text/javascript;base64,${Buffer.from(client.home.javascript).toString("base64")}`
    );
    const View = entry.createView({ react: React, jsx, ui: {} }) as {
      suiteViewState: ViewStateMetadata;
    };
    expect(View.suiteViewState).toMatchObject({ viewId: "home", version: 1 });
    const hydrated = hydrateModule(JSON.parse(JSON.stringify(editable)));
    const snapshot = {
      viewId: "home",
      version: 1,
      moduleVersion: "1.0.0",
      value: { name: "Keep this" },
    };
    expect(
      restoreViewCheckpoint(hydrated, "home", View.suiteViewState, snapshot)
        ?.value,
    ).toEqual({ name: "Keep this" });
    const target = defineModule({
      ...editable,
      version: "1.1.0",
      views: {
        home: {
          ...editable.views.home,
          state: {
            version: 2,
            schema: Type.Object(
              { title: Type.String() },
              { additionalProperties: false },
            ),
          },
        },
      },
    });
    const metadata = { viewId: "home", version: 2 };
    expect(() =>
      restoreViewCheckpoint(target, "home", metadata, snapshot),
    ).toThrow(/cannot convert/);
    expect(() =>
      restoreViewCheckpoint(
        target,
        "home",
        { ...metadata, restore: () => ({ title: 3 }) },
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      restoreViewCheckpoint(
        target,
        "home",
        { ...metadata, version: 3 },
        snapshot,
      ),
    ).toThrow(/does not match/);
    const restored = restoreViewCheckpoint(
      target,
      "home",
      { ...metadata, restore: () => ({ title: "Keep this" }) },
      snapshot,
    )!;
    expect(restored).toMatchObject({
      version: 2,
      moduleVersion: "1.1.0",
      value: { title: "Keep this" },
    });
    expect(Object.isFrozen(restored.value)).toBe(true);
    expect(snapshot.value).toEqual({ name: "Keep this" });
    expect(() =>
      validateClientArtifacts({
        ...editable,
        client: { home: { ...client.home, format: "suite-view-v1" } },
      }),
    ).toThrow(/Unsupported/);
  });

  it("rejects lossy, cyclic, oversized and invalid editable state without mutating input", () => {
    const schema = editable.views.home.state.schema;
    const input = { name: "Original" };
    const value = checkpointValue(schema, input);
    input.name = "Changed later";
    expect(value).toEqual({ name: "Original" });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const bad of [
      undefined,
      NaN,
      Infinity,
      new Date(),
      cyclic,
      { a: undefined },
      [undefined],
      new Array(2),
      { fn: () => {} },
      1n,
    ])
      expect(() => checkpointValue(Type.Unknown(), bad)).toThrow();
    expect(() => checkpointValue(schema, { name: 3 })).toThrow();
    expect(() => checkpointValue(Type.Unknown(), "x".repeat(65536))).toThrow(
      /64 KiB/,
    );
  });
  it("builds a typed TSX view with the host React runtime and signs all code and style bytes", async () => {
    const client = await buildClientViews(
      module,
      resolve("tests/fixtures/custom-notes"),
    );
    const pair = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const publicKey = pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const pkg = signPackage(module, privateKey, client);
    expect(verifyPackage(pkg, publicKey)).toBe(pkg);
    expect(moduleContract(pkg.artifact)).not.toHaveProperty("client");
    const entry = await import(
      `data:text/javascript;base64,${Buffer.from(client.home.javascript).toString("base64")}`
    );
    expect(typeof entry.createView({ react: React, jsx, ui: {} })).toBe(
      "function",
    );
    for (const key of ["javascript", "css"] as const) {
      const altered = structuredClone(pkg);
      validateClientArtifacts(altered.artifact).home[key] += "\n/* altered */";
      expect(() => verifyPackage(altered, publicKey)).toThrow(
        /signature|checksum/,
      );
    }
    const other = generateKeyPairSync("ed25519");
    expect(() =>
      verifyPackage(
        pkg,
        other.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toThrow();
    const malformed = structuredClone(pkg.artifact);
    (malformed.client as Record<string, unknown>).home = {
      format: "future-v9",
      javascript: "x",
      css: "",
    };
    expect(() => validateClientArtifacts(malformed)).toThrow(/Unsupported/);
    expect(() => signPackage(module, privateKey)).toThrow(/signed executable/);
  });

  it("rejects missing view contracts and paths outside a module", async () => {
    expect(() =>
      defineModule({
        ...module,
        // @ts-expect-error Unknown navigation view also fails at compile time.
        navigation: { ...module.navigation, view: "missing" },
      }),
    ).toThrow(/Unknown/);
    expect(() =>
      defineModule({
        ...module,
        views: { home: { ...module.views.home, entry: "../elsewhere.tsx" } },
      }),
    ).toThrow(/relative path/);
    await expect(
      buildClientViews(
        {
          ...module,
          views: {
            home: {
              ...module.views.home,
              entry: "../custom-notes/../../module-client.test.ts",
            },
          },
        },
        resolve("tests/fixtures/custom-notes"),
      ),
    ).rejects.toThrow(/escapes/);
  });

  it("infers custom-view resources, input and permissions", () => {
    defineView(module, ({ client, hasPermission }) => {
      if (false) {
        // @ts-expect-error Unknown resource must not compile.
        client.resource("invoices");
        // @ts-expect-error Schema-derived required field.
        void client.resource("notes").create({ title: "Incorrect" });
        // @ts-expect-error Only module-declared permission identifiers.
        hasPermission("workspace.manage");
      }
      return null;
    });
  });
});
