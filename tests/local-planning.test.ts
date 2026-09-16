import { expect, it } from "vitest";
import {
  resolveReleaseSet,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import {
  planLocalInstallation,
  type LocalData,
} from "../packages/platform/src/local-profiles";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import type { ModuleDefinition } from "@suite/module-sdk";
const release = (
  id: string,
  version: string,
  dependencies: Record<string, string> = {},
): ReleaseManifest => ({
  id,
  version,
  dependencies,
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  permissions: [],
});
it("coordinates all active consumers while retaining compatible preferred releases", () => {
  const releases = [
    release("provider", "1.0.0"),
    release("provider", "2.0.0"),
    release("consumer", "1.0.0", { provider: "^1" }),
    release("consumer", "2.0.0", { provider: "^2" }),
    release("unrelated", "1.0.0"),
    release("unrelated", "2.0.0"),
  ];
  const resolved = resolveReleaseSet(
    ["provider", "consumer", "unrelated"],
    releases,
    "1.0.0",
    "1.0.0",
    { provider: "2.0.0" },
    { provider: "1.0.0", consumer: "1.0.0", unrelated: "1.0.0" },
  );
  expect(resolved.map((m) => [m.id, m.version])).toEqual([
    ["provider", "2.0.0"],
    ["consumer", "2.0.0"],
    ["unrelated", "1.0.0"],
  ]);
  expect(() =>
    resolveReleaseSet(
      ["provider", "consumer"],
      releases.filter((m) => m.id !== "consumer" || m.version === "1.0.0"),
      "1.0.0",
      "1.0.0",
      { provider: "2.0.0" },
    ),
  ).toThrow(/compatible official release set/);
  expect(() =>
    resolveReleaseSet(["provider", "consumer"], releases, "1.0.0", "1.0.0", {
      provider: "2.0.0",
      consumer: "1.0.0",
    }),
  ).toThrow(/compatible official release set/);
});
it("backtracks across root requests and refuses cycles and incompatible hosts", () => {
  const releases = [
    release("provider", "1.0.0"),
    release("provider", "2.0.0"),
    release("consumer", "1.0.0", { provider: "^1" }),
  ];
  expect(
    resolveReleaseSet(["provider", "consumer"], releases, "1.0.0", "1.0.0").map(
      (m) => m.version,
    ),
  ).toEqual(["1.0.0", "1.0.0"]);
  expect(() =>
    resolveReleaseSet(
      ["a"],
      [release("a", "1.0.0", { b: "*" }), release("b", "1.0.0", { a: "*" })],
      "1.0.0",
      "1.0.0",
    ),
  ).toThrow();
  expect(() =>
    resolveReleaseSet(
      ["a"],
      [{ ...release("a", "1.0.0"), host: "^2" }],
      "1.0.0",
      "1.0.0",
    ),
  ).toThrow();
});
it("plans only changed local releases and restores retained dependency sets", () => {
  const module = (
    id: string,
    version: string,
    dependencies: Record<string, string> = {},
  ) =>
    defineModule({
      id,
      name: id,
      description: "Local planning fixture",
      version,
      host: "^1.0.0",
      backend: "^1.0.0",
      publisher: "suite",
      dependencies,
      configuration: Type.Object({}),
      permissions: [`${id}.items.read`, `${id}.items.write`],
      resources: {
        items: resource(
          { text: field.text() },
          { title: "Items", policy: "local", standalone: true },
        ),
      },
      operations: {},
    });
  const provider = module("provider", "1.0.0"),
    consumer = module("consumer", "1.0.0", { provider: "^1" });
  const installed = (m: ModuleDefinition) => ({
    active: true,
    version: m.version,
    releases: {
      [m.version]: {
        package: {
          module_id: m.id,
          version: m.version,
          artifact: m,
          manifest: {},
          digest: "fixture",
          signature: "fixture",
          key_id: "fixture",
        },
        publicKey: "fixture",
        configuration: {},
      },
    },
  });
  const data = {
    records: {},
    modules: { provider: installed(provider), consumer: installed(consumer) },
  } as unknown as LocalData;
  const nextProvider = module("provider", "2.0.0"),
    nextConsumer = module("consumer", "2.0.0", { provider: "^2" });
  expect(
    planLocalInstallation(data, nextProvider, [nextProvider, nextConsumer]).map(
      (m) => m.id,
    ),
  ).toEqual(["provider", "consumer"]);
  expect(
    planLocalInstallation(data, consumer, [provider, consumer]).map(
      (m) => m.id,
    ),
  ).toEqual(["consumer"]);
  data.modules!.provider.active = false;
  data.modules!.consumer.active = false;
  expect(
    planLocalInstallation(data, consumer, [provider, consumer]).map(
      (m) => m.id,
    ),
  ).toEqual(["provider", "consumer"]);
});
