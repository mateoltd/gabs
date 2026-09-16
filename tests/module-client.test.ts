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
import { defineView } from "@suite/module-sdk/ui";
import { defineModule } from "@suite/module-sdk";
import module from "./fixtures/custom-notes/module";

describe("Independent executable client packages", () => {
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
