import { expect, it } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signPackage } from "@suite/module-sdk/node/signing";
import { assertSchema } from "@suite/module-sdk";
import { SavedWorkRecoverySchema } from "@suite/module-sdk/platform";
import definition from "../fixtures/queued-notes/module";
const module = { ...definition, views: {}, navigation: undefined };
import {
  createSavedWorkRecovery,
  checkSavedWorkPermissions,
} from "../../packages/client/src/recovery/work";
import { validateRecoveryInput } from "../../packages/client/src/recovery/input";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const keys = generateKeyPairSync("ed25519");
  const call = {
    moduleId: module.id,
    moduleVersion: module.version,
    action: "operation" as const,
    operation: "capture",
    key: randomUUID(),
    input: { name: "Original command" },
  };
  const entry = {
    id: call.key,
    ...scope,
    call,
    dependencies: ["prior-request"],
    state: "conflict" as const,
    attempts: 1,
    createdAt: 42,
    delivery: "uncertain" as const,
    errorCode: "VERSION_CONFLICT",
  };
  const state: ModuleStorage = {
    installed: {},
    pages: {},
    drafts: {},
    journal: [entry],
    responseContracts: {
      [`${module.id}@${module.version}`]: {
        signed: signPackage(
          module,
          keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        ),
        publicKey: keys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
    },
    commandReviews: {
      [entry.id]: {
        source: call,
        moduleVersion: module.version,
        input: { name: "Reviewed command" },
        revision: 1,
        updatedAt: 43,
        continuations: [
          { id: "child", fingerprint: "original child identity" },
        ],
      },
    },
  };
  return { scope, state, entry };
}

it("exports original command identity, uncertainty, dependencies and separate review without mutating storage", async () => {
  const f = fixture(),
    before = structuredClone(f.state);
  const exported = await createSavedWorkRecovery(f.state, f.scope, module.id, {
    requestId: f.entry.id,
  });
  expect(exported).toMatchObject({
    kind: "module-work-recovery",
    selection: "request",
    entry: f.entry,
    review: f.state.commandReviews![f.entry.id],
  });
  expect(f.state).toEqual(before);
  expect(() =>
    checkSavedWorkPermissions(exported, module, [module], () => true),
  ).not.toThrow();
  expect(() =>
    checkSavedWorkPermissions(
      exported,
      module,
      [module],
      (p) => p !== module.operations.capture.permission,
    ),
  ).toThrow(/command/);
  expect(() =>
    validateRecoveryInput(
      { ...exported, userId: randomUUID() },
      f.scope,
      module.id,
    ),
  ).toThrow(/account/);
  if (exported.selection !== "request") throw Error("Expected request");
  expect(() =>
    validateRecoveryInput(
      {
        ...exported,
        review: {
          ...exported.review!,
          source: { ...f.entry.call, key: "different" },
        },
      },
      f.scope,
      module.id,
    ),
  ).toThrow(/original request/);
  const changed = {
    ...module,
    operations: {
      ...module.operations,
      capture: {
        ...module.operations.capture,
        permission: "custom-notes.new-grant",
      },
    },
  };
  expect(() =>
    checkSavedWorkPermissions(
      exported,
      changed,
      [module],
      (p) => p !== "custom-notes.new-grant",
    ),
  ).toThrow(/command/);
});

it("preserves archived collision input and both record snapshots without treating the later target as the original", async () => {
  const f = fixture();
  const record = {
    id: randomUUID(),
    version: 1,
    data: { name: "Original" },
    archived: false,
    updatedAt: new Date().toISOString(),
  };
  const call = {
    moduleId: module.id,
    moduleVersion: module.version,
    resource: "notes",
    action: "update" as const,
    key: randomUUID(),
    input: {
      id: record.id,
      data: { name: "Changed" },
      baseVersion: 1,
      baseData: record.data,
    },
  };
  f.state.journal = [{ ...f.entry, id: call.key, call }];
  const key = `${module.id}/notes/review/journal/${call.key}`;
  f.state.drafts[key] = { name: "Reviewed input" };
  f.state.draftVersions = { [key]: module.version };
  f.state.draftTargets = {
    [key]: { ...record, id: randomUUID(), archived: true, version: 2 },
  };
  f.state.draftReviews = {
    [key]: {
      entryId: call.key,
      recoveryInput: {
        recordId: record.id,
        moduleVersion: module.version,
        baseVersion: 1,
      },
      collision: {
        parentId: "separate-create",
        sourceData: { name: "Source input" },
        sourceTarget: record,
        targetId: f.state.draftTargets[key]!.id,
        moduleVersion: module.version,
        ready: true,
      },
    },
  };
  const before = structuredClone(f.state);
  const exported = await createSavedWorkRecovery(f.state, f.scope, module.id, {
    draftKey: key,
  });
  assertSchema(SavedWorkRecoverySchema, JSON.parse(JSON.stringify(exported)));
  expect(exported).toMatchObject({
    selection: "draft",
    data: f.state.drafts[key],
    entry: f.state.journal[0],
    target: f.state.draftTargets[key],
    review: f.state.draftReviews[key],
  });
  expect(f.state).toEqual(before);
  expect(() =>
    checkSavedWorkPermissions(
      exported,
      module,
      [module],
      (p) => p !== `${module.id}.notes.write`,
    ),
  ).toThrow(/resource input/);
  expect(() =>
    validateRecoveryInput(
      { ...exported, resource: "other" },
      f.scope,
      module.id,
    ),
  ).toThrow(/original resource/);
  delete f.state.draftVersions[key];
  await expect(
    createSavedWorkRecovery(f.state, f.scope, module.id, { draftKey: key }),
  ).rejects.toThrow();
});
