import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  Type,
  operation,
  type ModuleCall,
  type ModuleDefinition,
} from "@suite/module-sdk";
import type { Platform } from "../../packages/client/src";
import module from "../fixtures/queued-notes/module";
import { signPackage } from "../../packages/sdk/node/signing";
import {
  enqueue,
  changeModuleStorage,
  readModuleStorage,
} from "../../packages/client/src/modules/storage";
import {
  commandReview,
  commandContinuation,
  replaceCommand,
  saveCommandReview,
} from "../../packages/client/src/modules/command-recovery";
const scope = { userId: "user", workspaceId: "workspace" };
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const yes = () => true;
const makeCall = (
  key: string,
  input: unknown = { name: "Original" },
): ModuleCall => ({
  moduleId: module.id,
  moduleVersion: module.version,
  action: "operation",
  operation: "capture",
  input,
  key,
});
async function setup(
  definition: ModuleDefinition = module,
  id = "original-key",
) {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, run: () => Promise<unknown>) => {
        const next = (locks.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(run);
        locks.set(key, next);
        return next;
      },
    },
  });
  const records = new Map<string, unknown>();
  let stop = 0;
  const platform = {
    load: async (scope: { userId: string; workspaceId: string }, key: string) =>
      structuredClone(
        records.get(`${scope.userId}/${scope.workspaceId}/${key}`),
      ),
    save: async (
      scope: { userId: string; workspaceId: string },
      key: string,
      value: unknown,
    ) => {
      if (key === "module-state" && stop && --stop === 0)
        throw Error("Interrupted local commit");
      records.set(
        `${scope.userId}/${scope.workspaceId}/${key}`,
        structuredClone(value),
      );
    },
    pruneModuleArtifacts: async () => {},
  } as unknown as Platform;
  const install = async (definition: ModuleDefinition) => {
    const pkg = signPackage(
      { ...definition, views: undefined, navigation: undefined },
      privateKey,
    );
    await changeModuleStorage(platform, scope, (s) => {
      s.installed[module.id] = {
        signed: pkg,
        publicKey,
        artifact: pkg.artifact,
        version: pkg.version,
        verifiedAt: 1,
      };
    });
  };
  await install(definition);
  await enqueue(platform, scope, makeCall(id));
  await changeModuleStorage(platform, scope, (s) => {
    s.journal[0].state = "rejected";
    s.journal[0].delivery = undefined;
  });
  return {
    platform,
    install,
    read: () => readModuleStorage(platform, scope),
    interrupt: (n: number) => {
      stop = n;
    },
    id,
  };
}
afterEach(() => vi.unstubAllGlobals());

it("fences the exact original and continues only explicitly selected unsubmitted dependencies", async () => {
  const { platform, read } = await setup();
  for (const id of ["selected-child", "unselected-child", "submitted-child"])
    await enqueue(platform, scope, makeCall(id, { name: id }), [
      "original-key",
    ]);
  await changeModuleStorage(platform, scope, (s) => {
    s.journal[3].delivery = "uncertain";
    s.journal[3].attempts = 1;
  });
  const before = await read();
  const review = await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "Corrected" },
    0,
    yes,
    [commandContinuation(before.journal[1])],
  );
  const settle = vi.fn(async ({ body }) => ({
    key: body.key,
    outcome: "cancelled",
  }));
  expect(
    await replaceCommand(
      platform,
      scope,
      "original-key",
      review.revision,
      "replacement-key",
      [commandContinuation(before.journal[1])],
      settle,
      yes,
    ),
  ).toBe("replaced");
  expect(settle).toHaveBeenCalledWith({
    moduleId: module.id,
    moduleVersion: module.version,
    body: {
      key: "original-key",
      call: {
        action: "operation",
        operation: "capture",
        input: { name: "Original" },
      },
    },
  });
  const state = await read();
  expect(state.journal[0].call).toEqual(before.journal[0].call);
  expect(state.journal[0]).toMatchObject({
    state: "rejected",
    settlement: "cancelled",
    supersededBy: "replacement-key",
  });
  expect(state.journal[1].call).toEqual(before.journal[1].call);
  expect(state.journal[1].dependencies).toEqual(["replacement-key"]);
  expect(state.journal[2]).toEqual(before.journal[2]);
  expect(state.journal[3]).toEqual(before.journal[3]);
  expect(state.journal[4]).toMatchObject({
    state: "pending",
    delivery: "unsubmitted",
    attempts: 0,
    call: { key: "replacement-key", input: { name: "Corrected" } },
  });
});

it("retains the review and creates no replacement when a previously rejected request actually committed", async () => {
  const { platform, read } = await setup();
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "Review" },
    0,
    yes,
  );
  expect(
    await replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      async () => ({
        key: "original-key",
        outcome: "accepted",
        result: { id: "server-id" },
      }),
      yes,
    ),
  ).toBe("accepted");
  const state = await read();
  expect(state.journal).toHaveLength(1);
  expect(state.journal[0]).toMatchObject({
    state: "accepted",
    result: { id: "server-id" },
  });
  expect(commandReview(state, "original-key")?.input).toEqual({
    name: "Review",
  });
});

it("keeps a verified fence and saved input after an interrupted replacement, then recovers without duplicates", async () => {
  const { platform, read, interrupt } = await setup();
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "Review" },
    0,
    yes,
  );
  interrupt(2);
  const settle = async () => ({ key: "original-key", outcome: "cancelled" });
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      settle,
      yes,
    ),
  ).rejects.toThrow("Interrupted");
  expect((await read()).journal).toHaveLength(1);
  expect((await read()).journal[0].settlement).toBe("cancelled");
  expect(commandReview(await read(), "original-key")?.input).toEqual({
    name: "Review",
  });
  await replaceCommand(
    platform,
    scope,
    "original-key",
    1,
    "replacement-key",
    [],
    settle,
    yes,
  );
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      settle,
      yes,
    ),
  ).rejects.toThrow("no longer");
  expect((await read()).journal).toHaveLength(2);
});

it("rejects stale reviews, uncertain originals, submitted children, invalid input and changed authority", async () => {
  const { platform, read } = await setup();
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "" },
    0,
    yes,
  );
  await expect(
    saveCommandReview(
      platform,
      scope,
      "original-key",
      module.version,
      { name: "Other" },
      0,
      yes,
    ),
  ).rejects.toThrow("another view");
  const settle = vi.fn(async () => ({
    key: "original-key",
    outcome: "cancelled",
  }));
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      settle,
      yes,
    ),
  ).rejects.toThrow();
  expect(settle).not.toHaveBeenCalled();
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "Valid" },
    1,
    yes,
  );
  await enqueue(platform, scope, makeCall("submitted-child"), ["original-key"]);
  await changeModuleStorage(platform, scope, (s) => {
    s.journal[1].delivery = "uncertain";
    s.journal[1].attempts = 1;
  });
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      2,
      "replacement-key",
      [commandContinuation((await read()).journal[1])],
      settle,
      yes,
    ),
  ).rejects.toThrow("dependent");
  expect(settle).not.toHaveBeenCalled();
  let allowed = true;
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      2,
      "replacement-key",
      [],
      async () => {
        allowed = false;
        return { key: "original-key", outcome: "cancelled" };
      },
      () => allowed,
    ),
  ).rejects.toThrow("access changed");
  expect((await read()).journal[0].supersededBy).toBeUndefined();
  await changeModuleStorage(platform, scope, (s) => {
    s.journal[0].state = "pending";
    s.journal[0].delivery = "uncertain";
  });
  await expect(
    saveCommandReview(
      platform,
      scope,
      "original-key",
      module.version,
      { name: "Valid" },
      2,
      yes,
    ),
  ).rejects.toThrow("uncertain");
});

it("preserves opaque special-property identities and prevents unfenced generic replacement", async () => {
  const { platform, read } = await setup(module, "__proto__");
  const review = await saveCommandReview(
    platform,
    scope,
    "__proto__",
    module.version,
    { name: "Review" },
    0,
    yes,
  );
  expect(commandReview(await read(), "__proto__")).toEqual(review);
  expect(commandReview(await read(), "constructor")).toBeUndefined();
  await expect(
    enqueue(platform, scope, makeCall("replacement-key"), [], {
      draftKey: "review",
      supersedes: "__proto__",
    }),
  ).rejects.toThrow("authoritative command recovery");
  await replaceCommand(
    platform,
    scope,
    "__proto__",
    1,
    "replacement-key",
    [],
    async () => ({ key: "__proto__", outcome: "cancelled" }),
    yes,
  );
  expect((await read()).journal).toHaveLength(2);
});

it("supports null command input without resource-target assumptions and rejects malformed settlement results", async () => {
  const definition = {
    ...module,
    operations: {
      ...module.operations,
      capture: operation({
        ...module.operations.capture,
        input: Type.Union([module.operations.capture.input, Type.Null()]),
      }),
    },
  };
  const { platform, read } = await setup(definition);
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    null,
    0,
    yes,
  );
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      async () => ({
        key: "original-key",
        outcome: "accepted",
        result: { id: 42 },
      }),
      yes,
    ),
  ).rejects.toThrow();
  expect((await read()).journal[0].settlement).toBeUndefined();
  await replaceCommand(
    platform,
    scope,
    "original-key",
    1,
    "replacement-key",
    [],
    async () => ({ key: "original-key", outcome: "cancelled" }),
    yes,
  );
  expect((await read()).journal[1].call.input).toBeNull();
});

it("preserves a newer concurrent review instead of overwriting it after server cancellation", async () => {
  const { platform, read } = await setup();
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "First review" },
    0,
    yes,
  );
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      async () => {
        await saveCommandReview(
          platform,
          scope,
          "original-key",
          module.version,
          { name: "Concurrent review" },
          1,
          yes,
        );
        return { key: "original-key", outcome: "cancelled" };
      },
      yes,
    ),
  ).rejects.toThrow("review changed");
  expect((await read()).journal).toHaveLength(1);
  expect((await read()).journal[0].settlement).toBe("cancelled");
  expect(commandReview(await read(), "original-key")?.input).toEqual({
    name: "Concurrent review",
  });
});

it("retains review contracts across upgrades and requires fresh review of the installed release", async () => {
  const { platform, read, install } = await setup();
  const v2 = { ...module, version: "2.0.0" };
  await install(v2);
  await saveCommandReview(
    platform,
    scope,
    "original-key",
    v2.version,
    { name: "Retained review" },
    0,
    yes,
  );
  await install({ ...module, version: "3.0.0" });
  const state = await read();
  expect(state.responseContracts?.[`${module.id}@2.0.0`]?.signed.version).toBe(
    "2.0.0",
  );
  const settle = vi.fn(async () => ({
    key: "original-key",
    outcome: "cancelled",
  }));
  await expect(
    replaceCommand(
      platform,
      scope,
      "original-key",
      1,
      "replacement-key",
      [],
      settle,
      yes,
    ),
  ).rejects.toThrow("installed release changed");
  expect(settle).not.toHaveBeenCalled();
  expect(commandReview(await read(), "original-key")?.input).toEqual({
    name: "Retained review",
  });
});

it("requires fresh approval when selected dependent input changes and rechecks dependent access after verification", async () => {
  const { platform, read } = await setup();
  await enqueue(
    platform,
    scope,
    makeCall("selected-child", { name: "Original child" }),
    ["original-key"],
  );
  const selection = commandContinuation((await read()).journal[1]);
  await changeModuleStorage(platform, scope, (s) => {
    s.journal[1].call.input = { name: "Changed child" };
  });
  await expect(
    saveCommandReview(
      platform,
      scope,
      "original-key",
      module.version,
      { name: "Correction" },
      0,
      yes,
      [selection],
    ),
  ).rejects.toThrow("dependent changed");
  let checks = 0;
  const current = commandContinuation((await read()).journal[1]);
  await expect(
    saveCommandReview(
      platform,
      scope,
      "original-key",
      module.version,
      { name: "Correction" },
      0,
      (call) => call.key !== "selected-child" || ++checks === 1,
      [current],
    ),
  ).rejects.toThrow("access changed");
  expect(commandReview(await read(), "original-key")).toBeUndefined();
});

it("does not contact the settlement server after access expires during signed-contract verification", async () => {
  const { platform, read } = await setup();
  const review = await saveCommandReview(
    platform,
    scope,
    "original-key",
    module.version,
    { name: "Correction" },
    0,
    yes,
  );
  let allowed = true;
  const verify = crypto.subtle.verify.bind(crypto.subtle);
  const held = vi
    .spyOn(crypto.subtle, "verify")
    .mockImplementation(async (...args) => {
      const result = await verify(...args);
      allowed = false;
      return result;
    });
  const settle = vi.fn(async () => ({
    key: "original-key",
    outcome: "cancelled",
  }));
  try {
    await expect(
      replaceCommand(
        platform,
        scope,
        "original-key",
        review.revision,
        "replacement",
        [],
        settle,
        () => allowed,
      ),
    ).rejects.toThrow("access changed");
    expect(settle).not.toHaveBeenCalled();
  } finally {
    held.mockRestore();
  }
  expect((await read()).journal).toHaveLength(1);
  expect(commandReview(await read(), "original-key")).toEqual(review);
});

it("rechecks uncertain-outcome authority after storage reads and inside the final commit", async () => {
  const { settleJournalEntry } =
    await import("../../packages/client/src/modules/settlement");
  const { platform, read } = await setup();
  await changeModuleStorage(platform, scope, (state) => {
    state.journal[0].state = "pending";
    state.journal[0].delivery = "uncertain";
  });
  const before = (await read()).journal;
  let allowed = true;
  const load = platform.load.bind(platform);
  const delayed = vi
    .spyOn(platform, "load")
    .mockImplementation(async (...args) => {
      const result = await load(...args);
      allowed = false;
      return result;
    });
  const settle = vi.fn(async () => ({
    key: "original-key",
    outcome: "cancelled",
  }));
  await expect(
    settleJournalEntry(platform, scope, "original-key", settle, () => allowed),
  ).rejects.toThrow("access changed");
  expect(settle).not.toHaveBeenCalled();
  delayed.mockRestore();
  allowed = true;
  const prune = vi
    .spyOn(platform, "pruneModuleArtifacts")
    .mockImplementation(async () => {
      allowed = false;
    });
  await expect(
    settleJournalEntry(platform, scope, "original-key", settle, () => allowed),
  ).rejects.toThrow("before saving");
  expect(settle).toHaveBeenCalledOnce();
  prune.mockRestore();
  expect((await read()).journal).toEqual(before);
  await settleJournalEntry(platform, scope, "original-key", settle, yes);
  expect((await read()).journal[0]).toMatchObject({
    id: "original-key",
    state: "rejected",
    settlement: "cancelled",
    call: before[0].call,
  });
});
