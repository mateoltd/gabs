import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { FeatureProps, Platform } from "../../packages/client/src";
import type { ModuleCall, ModuleDefinition } from "@suite/module-sdk";
import { signPackage } from "../../packages/sdk/node/signing";
import notes from "../fixtures/queued-notes/module";
import {
  changeModuleStorage,
  enqueue,
  readModuleStorage,
} from "../../packages/client/src/modules/storage";
import {
  commandContinuation,
  commandDependents,
  replaceCommand,
  saveCommandReview,
} from "../../packages/client/src/modules/command-recovery";
import {
  canContinue,
  prepareContinuation,
} from "../../packages/shell/src/features/modules/recovery/continuation";
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const scope = { userId: "user", workspaceId: "workspace" };
const other: ModuleDefinition = {
  ...notes,
  id: "other-notes",
  name: "Other notes",
  permissions: notes.permissions.map((p) => p.replace(notes.id, "other-notes")),
  operations: {
    ...notes.operations,
    names: { ...notes.operations.names, permission: "other-notes.notes.read" },
    capture: { ...notes.operations.capture, permission: "other-notes.capture" },
  },
};
const call = (module: ModuleDefinition, key: string): ModuleCall => ({
  moduleId: module.id,
  moduleVersion: module.version,
  action: "operation",
  operation: "capture",
  input: { name: key },
  key,
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (name: string, run: () => Promise<unknown>) => {
        const next = (locks.get(name) ?? Promise.resolve())
          .catch(() => {})
          .then(run);
        locks.set(name, next);
        return next;
      },
    },
  });
  const records = new Map<string, unknown>();
  const platform = {
    load: async (_: unknown, key: string) => structuredClone(records.get(key)),
    save: async (_: unknown, key: string, value: unknown) => {
      records.set(key, structuredClone(value));
    },
    pruneModuleArtifacts: async () => {},
  } as unknown as Platform;
  for (const module of [notes, other]) {
    const signed = signPackage(
      { ...module, views: undefined, navigation: undefined },
      privateKey,
    );
    await changeModuleStorage(platform, scope, (state) => {
      state.installed[module.id] = {
        version: signed.version,
        signed,
        artifact: signed.artifact,
        publicKey,
        verifiedAt: Date.now(),
      };
    });
  }
  const props = {
    bootstrap: {
      permissions: [...notes.permissions, ...other.permissions],
      modules: [notes, other].map((m) => ({
        moduleId: m.id,
        state: "enabled",
        entitled: true,
        assigned: true,
      })),
    },
  } as FeatureProps;
  await enqueue(platform, scope, call(notes, "original"));
  await changeModuleStorage(platform, scope, (state) => {
    state.journal[0].state = "rejected";
    delete state.journal[0].delivery;
  });
  return { platform, props, read: () => readModuleStorage(platform, scope) };
}

it("continues only selected cross-module commands and resource writes with exact requests", async () => {
  const f = await fixture();
  for (const key of ["selected", "unselected", "submitted"])
    await enqueue(f.platform, scope, call(other, key), ["original"]);
  for (const action of ["create", "update", "archive"] as const)
    await enqueue(
      f.platform,
      scope,
      {
        moduleId: other.id,
        moduleVersion: other.version,
        resource: "notes",
        action,
        key: `${action}-key`,
        input: {
          id: `${action}-record`,
          ...(action !== "archive" ? { data: { name: action } } : {}),
          ...(action !== "create" ? { baseVersion: 2 } : {}),
        },
      },
      ["original"],
    );
  await changeModuleStorage(f.platform, scope, (state) => {
    state.journal[3].delivery = "uncertain";
    state.journal[3].attempts = 1;
  });
  const before = await f.read();
  const children = commandDependents(before, scope, "original").filter(
    (e) => e.id !== "unselected",
  );
  expect(children.map((e) => e.id)).toEqual([
    "selected",
    "create-key",
    "update-key",
    "archive-key",
  ]);
  const choices = children.map(commandContinuation);
  const contracts = await Promise.all(
    children.map((e) => prepareContinuation(f.props, before, e.call)),
  );
  const authorized = (request: ModuleCall, state: typeof before) =>
    request.moduleId === notes.id ||
    canContinue(
      f.props,
      request,
      contracts[children.findIndex((e) => e.id === request.key)],
      state,
    );
  const review = await saveCommandReview(
    f.platform,
    scope,
    "original",
    notes.version,
    { name: "Corrected" },
    0,
    authorized,
    choices,
  );
  expect((await f.read()).commandReviews?.original).toEqual(review);
  expect(
    await replaceCommand(
      f.platform,
      scope,
      "original",
      review.revision,
      "replacement",
      choices,
      async () => ({ key: "original", outcome: "cancelled" }),
      authorized,
    ),
  ).toBe("replaced");
  const after = await f.read();
  for (const child of children) {
    const result = after.journal.find((e) => e.id === child.id)!;
    expect(result.call).toEqual(child.call);
    expect(result.dependencies).toEqual(["replacement"]);
    expect(result).toMatchObject({
      state: "pending",
      delivery: "unsubmitted",
      attempts: 0,
    });
  }
  expect(after.journal[2]).toEqual(before.journal[2]);
  expect(after.journal[3]).toEqual(before.journal[3]);
});

it.each(["uninstall", "permission", "assignment", "signature"] as const)(
  "retains the stopped original and review when child %s changes during settlement",
  async (change) => {
    const f = await fixture();
    const child = call(other, "child-key");
    await enqueue(f.platform, scope, child, ["original"]);
    const before = await f.read();
    const prepared = await prepareContinuation(f.props, before, child);
    const authorized = (request: ModuleCall, state: typeof before) =>
      request.moduleId === notes.id ||
      canContinue(f.props, request, prepared, state);
    const choices = [commandContinuation(before.journal[1])];
    const review = await saveCommandReview(
      f.platform,
      scope,
      "original",
      notes.version,
      { name: "Corrected" },
      0,
      authorized,
      choices,
    );
    await expect(
      replaceCommand(
        f.platform,
        scope,
        "original",
        review.revision,
        "replacement",
        choices,
        async () => {
          if (change === "permission")
            f.props.bootstrap.permissions =
              f.props.bootstrap.permissions.filter(
                (p) => p !== "other-notes.capture",
              );
          else if (change === "assignment")
            f.props.bootstrap.modules[1].assigned = false;
          else
            await changeModuleStorage(f.platform, scope, (state) => {
              if (change === "uninstall") delete state.installed[other.id];
              else state.installed[other.id].signed!.signature = "corrupt";
            });
          return { key: "original", outcome: "cancelled" };
        },
        authorized,
      ),
    ).rejects.toThrow("dependent changed");
    const after = await f.read();
    expect(after.journal).toHaveLength(2);
    expect(after.journal[0]).toMatchObject({
      settlement: "cancelled",
      call: before.journal[0].call,
    });
    expect(after.journal[1]).toEqual(before.journal[1]);
    expect(after.commandReviews?.original).toEqual(review);
  },
);

it("uses the child's original and installed permissions and resource policy", async () => {
  const f = await fixture();
  const command = call(other, "child-key");
  await enqueue(f.platform, scope, command, ["original"]);
  const upgraded = {
    ...other,
    version: "2.0.0",
    operations: {
      ...other.operations,
      capture: {
        ...other.operations.capture,
        permission: "other-notes.capture-next",
      },
    },
    permissions: [...other.permissions, "other-notes.capture-next"],
  };
  const signed = signPackage(
    { ...upgraded, views: undefined, navigation: undefined },
    privateKey,
  );
  await changeModuleStorage(f.platform, scope, (state) => {
    state.installed[other.id] = {
      version: signed.version,
      signed,
      artifact: signed.artifact,
      publicKey,
      verifiedAt: Date.now(),
    };
  });
  const state = await f.read();
  const prepared = await prepareContinuation(f.props, state, command);
  expect(canContinue(f.props, command, prepared, state)).toBe(false);
  f.props.bootstrap.permissions.push("other-notes.capture-next");
  expect(canContinue(f.props, command, prepared, state)).toBe(true);
  f.props.bootstrap.permissions = f.props.bootstrap.permissions.filter(
    (p) => p !== "other-notes.capture",
  );
  expect(canContinue(f.props, command, prepared, state)).toBe(false);
  const resource: ModuleCall = {
    moduleId: other.id,
    moduleVersion: other.version,
    action: "archive",
    resource: "notes",
    input: { id: "record", baseVersion: 1 },
  };
  const resourceAccess = await prepareContinuation(f.props, state, resource);
  expect(canContinue(f.props, resource, resourceAccess, state)).toBe(true);
  resourceAccess!.installed.resources.notes.policy = "online";
  expect(canContinue(f.props, resource, resourceAccess, state)).toBe(false);
});

it("requires every verified installed dependency at the transaction boundary", async () => {
  const f = await fixture();
  const definition = { ...other, dependencies: { [notes.id]: "^1.0.0" } };
  const signed = signPackage(
    { ...definition, views: undefined, navigation: undefined },
    privateKey,
  );
  await changeModuleStorage(f.platform, scope, (state) => {
    state.installed[other.id] = {
      version: signed.version,
      signed,
      artifact: signed.artifact,
      publicKey,
      verifiedAt: Date.now(),
    };
  });
  const request = call(other, "child-key");
  const state = await f.read();
  const prepared = await prepareContinuation(f.props, state, request);
  expect(canContinue(f.props, request, prepared, state)).toBe(true);
  delete state.installed[notes.id];
  expect(canContinue(f.props, request, prepared, state)).toBe(false);
  expect(await prepareContinuation(f.props, state, request)).toBeUndefined();
});

it("does not inherit parent authorization for same-module dependents without an embedded retry key", async () => {
  const f = await fixture();
  const child = { ...call(notes, "unused-key"), key: undefined };
  await enqueue(f.platform, scope, child, ["original"]);
  const before = await f.read();
  const choices = [commandContinuation(before.journal[1])];
  await expect(
    saveCommandReview(
      f.platform,
      scope,
      "original",
      notes.version,
      { name: "Corrected" },
      0,
      (_call, _state, dependentId) => !dependentId,
      choices,
    ),
  ).rejects.toThrow("selected dependent changed");
  expect((await f.read()).commandReviews?.original).toBeUndefined();
  const review = await saveCommandReview(
    f.platform,
    scope,
    "original",
    notes.version,
    { name: "Corrected" },
    0,
    () => true,
    choices,
  );
  const settle = vi.fn(async () => ({ key: "original", outcome: "cancelled" }));
  await expect(
    replaceCommand(
      f.platform,
      scope,
      "original",
      review.revision,
      "replacement",
      choices,
      settle,
      (_call, _state, dependentId) => !dependentId,
    ),
  ).rejects.toThrow("selected dependent is unavailable");
  expect(settle).not.toHaveBeenCalled();
  expect((await f.read()).journal).toEqual(before.journal);
});
