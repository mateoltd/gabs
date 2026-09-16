import { expect, it } from "vitest";
import {
  resolveReleaseSet,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import {
  planLocalInstallation,
  localReleaseIssue,
  localLifecycleHistory,
  planRetainedLocalInstallation,
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

it("excludes incompatible dependency data, blocks destructive rollback and requires a full forward path", () => {
  const module = (
    id: string,
    version: string,
    dependencies: Record<string, string> = {},
    localStorage?: ModuleDefinition["localStorage"],
  ) =>
    defineModule({
      id,
      name: id,
      version,
      description: "Storage planning",
      host: "^1",
      backend: "^1",
      publisher: "suite",
      dependencies,
      configuration: Type.Object({}),
      resources: {},
      operations: {},
      permissions: [],
      ...(localStorage ? { localStorage } : {}),
    });
  const old = module("provider", "1.0.0"),
    compatible = module(
      "provider",
      "1.1.0",
      {},
      { version: 1, compatible: { minimum: 1, maximum: 2 }, migrations: {} },
    ),
    active = module(
      "provider",
      "2.0.0",
      {},
      {
        version: 2,
        compatible: { minimum: 2, maximum: 2 },
        migrations: { upgrade: { from: 1, to: 2 } },
      },
    ),
    consumer = module("consumer", "1.0.0", { provider: "^1" });
  const retained = [old, compatible, active];
  const data = {
    records: {},
    modules: {
      provider: {
        active: true,
        version: active.version,
        schemaVersion: 2,
        releases: Object.fromEntries(
          retained.map((m) => [
            m.version,
            {
              package: { module_id: m.id, version: m.version, artifact: m },
              publicKey: "fixture",
              configuration: {},
            },
          ]),
        ),
      },
    },
  } as unknown as LocalData;
  expect(localReleaseIssue(data, old)).toContain(
    "cannot use local data version 2",
  );
  expect(() =>
    planRetainedLocalInstallation(data, old.id, old.version),
  ).toThrow(/local data version 2/);
  expect(
    planRetainedLocalInstallation(data, compatible.id, compatible.version).map(
      (r) => r.package.version,
    ),
  ).toEqual(["1.1.0"]);
  expect(
    planLocalInstallation(data, consumer, [old, compatible]).map((m) => [
      m.id,
      m.version,
    ]),
  ).toEqual([
    ["provider", "1.1.0"],
    ["consumer", "1.0.0"],
  ]);
  const missing = module(
    "provider",
    "3.0.0",
    {},
    { version: 3, compatible: { minimum: 3, maximum: 3 }, migrations: {} },
  );
  expect(localReleaseIssue(data, missing)).toContain(
    "migration from local data version 2 to 3",
  );
  expect(() => planLocalInstallation(data, missing, [])).toThrow(/migration/);
});

it("combines durable lifecycle events with legacy accepted requests without duplicating or inventing completion dates", () => {
  const modules = [
    { moduleId: "notes", moduleVersion: "1.0.0", title: "Notes" },
  ];
  const data: LocalData = {
    records: {},
    lifecycle: [
      {
        id: "accepted",
        action: "installed",
        at: 200,
        time: "completed",
        modules,
      },
      { id: "removed", action: "removed", at: 200, time: "completed", modules },
    ],
    installationAttempts: {
      accepted: { ...modules[0], createdAt: 100, state: "accepted" },
      legacy: { ...modules[0], createdAt: 50, state: "accepted" },
    },
  };
  expect(
    localLifecycleHistory(data).map((e) => [e.id, e.action, e.time, e.at]),
  ).toEqual([
    ["removed", "removed", "completed", 200],
    ["accepted", "installed", "completed", 200],
    ["legacy", "installed", "requested", 50],
  ]);
  expect(data.lifecycle?.[0].id).toBe("accepted");
});
