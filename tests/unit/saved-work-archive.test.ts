import { expect, it, vi, afterEach } from "vitest";
import {
  randomUUID,
  generateKeyPairSync,
  pbkdf2Sync,
  createDecipheriv,
  createCipheriv,
} from "node:crypto";
import { signPackage } from "@suite/module-sdk/node/signing";
import { canonical } from "@suite/module-sdk/registry";
import {
  openSavedWorkArchive,
  sealSavedWorkArchive,
  parseSavedWorkArchive,
  collectSavedWorkArchive,
  encryptedWorkArchiveLimit,
  savedWorkArchiveLimit,
  type SavedWorkArchive,
} from "../../packages/client/src/recovery/archive";
import { savedWorkFingerprint } from "../../packages/client/src/recovery/import/format";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import definition from "../fixtures/queued-notes/module";

afterEach(() => vi.restoreAllMocks());
const passphrase = "correct portable archive passphrase";
const check = () => {};
function fixture(): SavedWorkArchive {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const id = randomUUID();
  return {
    kind: "corporate-saved-work",
    formatVersion: 1,
    ...scope,
    createdAt: Date.now(),
    copies: [
      {
        kind: "module-work-recovery",
        formatVersion: 1,
        ...scope,
        moduleId: definition.id,
        moduleVersion: definition.version,
        selection: "request",
        entry: {
          id,
          ...scope,
          call: {
            moduleId: definition.id,
            moduleVersion: definition.version,
            action: "operation",
            operation: "capture",
            key: id,
            input: { name: "Unsent café 文書" },
          },
          state: "pending",
          attempts: 1,
          delivery: "uncertain",
          dependencies: ["captured-parent"],
          createdAt: 20,
        },
      },
    ],
  };
}

it("round-trips exact scoped observations with randomized authenticated encryption and no visible identity", async () => {
  const archive = fixture();
  const before = structuredClone(archive);
  const first = await sealSavedWorkArchive(archive, passphrase, check);
  const second = await sealSavedWorkArchive(archive, passphrase, check);
  const a = JSON.parse(first),
    b = JSON.parse(second);
  expect(a.salt).not.toBe(b.salt);
  expect(a.iv).not.toBe(b.iv);
  expect(a.ciphertext).not.toBe(b.ciphertext);
  for (const secret of [
    archive.userId,
    archive.workspaceId,
    definition.id,
    "Unsent",
    passphrase,
  ])
    expect(first).not.toContain(secret);
  expect(await openSavedWorkArchive(first, passphrase, archive, check)).toEqual(
    before,
  );
  expect(archive).toEqual(before);
});

it("rejects wrong secrets, altered ciphertext, and swapped salts or IVs without returning partial input", async () => {
  const archive = fixture();
  const text = await sealSavedWorkArchive(archive, passphrase, check);
  await expect(
    openSavedWorkArchive(
      text,
      "another sufficiently long passphrase",
      archive,
      check,
    ),
  ).rejects.toThrow(/could not be unlocked/);
  const second = JSON.parse(
    await sealSavedWorkArchive(archive, passphrase, check),
  );
  for (const field of ["salt", "iv", "ciphertext"] as const) {
    const corrupted = { ...JSON.parse(text), [field]: second[field] };
    await expect(
      openSavedWorkArchive(
        JSON.stringify(corrupted),
        passphrase,
        archive,
        check,
      ),
    ).rejects.toThrow(/could not be unlocked/);
  }
});

it("bounds and validates untrusted encryption parameters before deriving any key", async () => {
  const archive = fixture();
  const envelope = JSON.parse(
    await sealSavedWorkArchive(archive, passphrase, check),
  );
  const derive = vi.spyOn(crypto.subtle, "deriveKey");
  for (const patch of [
    { iterations: 1 },
    { iterations: 999999999 },
    { formatVersion: 2 },
    { cipher: "AES-CBC" },
    { lease: "unexpected" },
    { iv: "_".repeat(16) },
    { ciphertext: "not-base64" },
  ])
    await expect(
      openSavedWorkArchive(
        JSON.stringify({ ...envelope, ...patch }),
        passphrase,
        archive,
        check,
      ),
    ).rejects.toThrow();
  await expect(
    openSavedWorkArchive(
      " ".repeat(encryptedWorkArchiveLimit + 1),
      passphrase,
      archive,
      check,
    ),
  ).rejects.toThrow(/too large/);
  expect(derive).not.toHaveBeenCalled();
});

it("refuses cross-account/workspace archives after authentication and rejects authority fields", async () => {
  const archive = fixture();
  const text = await sealSavedWorkArchive(archive, passphrase, check);
  for (const patch of [{ userId: randomUUID() }, { workspaceId: randomUUID() }])
    await expect(
      openSavedWorkArchive(text, passphrase, { ...archive, ...patch }, check),
    ).rejects.toThrow(/another account or workspace/);
  for (const extra of [{ credentials: {} }, { leases: [] }, { bootstrap: {} }])
    expect(() =>
      parseSavedWorkArchive(JSON.stringify({ ...archive, ...extra }), archive),
    ).toThrow();
  const withAuthority = {
    ...archive,
    copies: [{ ...archive.copies[0], permissions: ["admin"] }],
  };
  expect(() =>
    parseSavedWorkArchive(JSON.stringify(withAuthority), archive),
  ).toThrow();
});

it("preserves historical versions and competing snapshots but rejects exact duplicates and excessive nesting or size", () => {
  const archive = fixture();
  const changed = structuredClone(archive.copies[0]);
  if (changed.selection !== "request") throw Error("fixture");
  changed.entry.call.input = { name: "Another snapshot" };
  expect(
    parseSavedWorkArchive(
      JSON.stringify({ ...archive, copies: [archive.copies[0], changed] }),
      archive,
    ).copies,
  ).toHaveLength(2);
  expect(() =>
    parseSavedWorkArchive(
      JSON.stringify({
        ...archive,
        copies: [archive.copies[0], archive.copies[0]],
      }),
      archive,
    ),
  ).toThrow(/duplicate/);
  expect(() =>
    parseSavedWorkArchive(JSON.stringify({ ...archive, copies: [] }), archive),
  ).toThrow();
  expect(() =>
    parseSavedWorkArchive(
      JSON.stringify({ ...archive, copies: Array(257).fill(changed) }),
      archive,
    ),
  ).toThrow();
  expect(() =>
    parseSavedWorkArchive(" ".repeat(savedWorkArchiveLimit + 1), archive),
  ).toThrow(/16 MiB/);
  changed.entry.call.input = { value: "x".repeat(1024 * 1024) };
  expect(() =>
    parseSavedWorkArchive(
      JSON.stringify({ ...archive, copies: [changed] }),
      archive,
    ),
  ).toThrow(/1 MiB/);
  let nested: unknown = {};
  for (let i = 0; i < 70; i++) nested = { nested };
  changed.entry.call.input = nested;
  expect(() =>
    parseSavedWorkArchive(
      JSON.stringify({ ...archive, copies: [changed] }),
      archive,
    ),
  ).toThrow(/nested too deeply/);
});

it("honors access cancellation around expensive crypto and keeps derived keys nonextractable", async () => {
  const archive = fixture();
  const text = await sealSavedWorkArchive(archive, passphrase, check);
  const derive = vi.spyOn(crypto.subtle, "deriveKey");
  const encrypt = vi.spyOn(crypto.subtle, "encrypt");
  const decrypt = vi.spyOn(crypto.subtle, "decrypt");
  const cancelled = () => {
    throw Error("Profile locked");
  };
  await expect(
    openSavedWorkArchive(text, passphrase, archive, cancelled),
  ).rejects.toThrow(/Profile locked/);
  expect(derive).not.toHaveBeenCalled();
  let checks = 0;
  await expect(
    sealSavedWorkArchive(archive, passphrase, () => {
      if (++checks === 2) cancelled();
    }),
  ).rejects.toThrow(/Profile locked/);
  expect(encrypt).not.toHaveBeenCalled();
  checks = 0;
  await expect(
    openSavedWorkArchive(text, passphrase, archive, () => {
      if (++checks === 2) cancelled();
    }),
  ).rejects.toThrow(/Profile locked/);
  expect(decrypt).not.toHaveBeenCalled();
  expect(derive.mock.calls.every((args) => args[3] === false)).toBe(true);
});

it("rejects short or excessive secrets before deriving a key", async () => {
  const derive = vi.spyOn(crypto.subtle, "deriveKey");
  for (const secret of ["short", "x".repeat(1025)])
    await expect(
      sealSavedWorkArchive(fixture(), secret, check),
    ).rejects.toThrow(/passphrase between/);
  expect(derive).not.toHaveBeenCalled();
});

it("interoperates with the declared Node cipher and authenticates metadata before validating hostile payloads", async () => {
  const archive = fixture();
  const text = await sealSavedWorkArchive(archive, passphrase, check);
  const { ciphertext, ...header } = JSON.parse(text);
  const key = pbkdf2Sync(
    passphrase,
    Buffer.from(header.salt, "base64"),
    600000,
    32,
    "sha256",
  );
  const bytes = Buffer.from(ciphertext, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(header.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(canonical(header)));
  decipher.setAuthTag(bytes.subarray(-16));
  expect(
    JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(0, -16)),
        decipher.final(),
      ]).toString(),
    ),
  ).toEqual(archive);
  // A valid tag proves file integrity, never that file-supplied authority is acceptable.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const forgedHeader = { ...header, iv: Buffer.from(iv).toString("base64") };
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(canonical(forgedHeader)));
  const forged = Buffer.concat([
    cipher.update(JSON.stringify({ ...archive, credentials: "injected" })),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  await expect(
    openSavedWorkArchive(
      JSON.stringify({
        ...forgedHeader,
        ciphertext: forged.toString("base64"),
      }),
      passphrase,
      archive,
      check,
    ),
  ).rejects.toThrow();
  key.fill(0);
});

it("supports archives larger than admission storage without truncating any source copies", async () => {
  const archive = fixture();
  archive.copies = Array.from({ length: 40 }, (_, index) => {
    const copy = structuredClone(archive.copies[0]);
    if (copy.selection !== "request") throw Error("fixture");
    copy.entry.id = copy.entry.call.key = randomUUID();
    copy.entry.call.input = {
      name: `Item ${index}`,
      detail: "x".repeat(30000),
    };
    return copy;
  });
  expect(JSON.stringify(archive).length).toBeGreaterThan(1024 * 1024);
  const text = await sealSavedWorkArchive(archive, passphrase, check);
  const restored = await openSavedWorkArchive(text, passphrase, archive, check);
  expect(restored.copies).toEqual(archive.copies);
  expect(restored.copies).toHaveLength(40);
});

it("collects requests, drafts and retained copies without credentials, cached data or promotion authority", async () => {
  const archive = fixture();
  const copy = archive.copies[0];
  if (copy.selection !== "request") throw Error("fixture");
  const pair = generateKeyPairSync("ed25519");
  const module = { ...definition, views: {}, navigation: undefined };
  const signed = signPackage(
    module,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  const digest = await savedWorkFingerprint(copy);
  const key = `${module.id}/notes/new`;
  const state: ModuleStorage = {
    journal: [copy.entry],
    pages: {},
    installed: {},
    drafts: { [key]: { name: "Independent draft" } },
    draftVersions: { [key]: module.version },
    recoveryImports: {
      [digest]: {
        input: copy,
        receivedAt: 1,
        promotion: {
          existingRequest: true,
          restoredAt: 2,
          requestId: copy.entry.id,
          outcome: "accepted",
        },
      },
    },
    responseContracts: {
      [`${module.id}@${module.version}`]: {
        signed,
        publicKey: pair.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
    },
  };
  const before = structuredClone(state);
  const collected = await collectSavedWorkArchive(
    state,
    archive,
    [
      { kind: "request", requestId: copy.entry.id },
      { kind: "draft", draftKey: key },
      { kind: "retained", digest },
    ],
    check,
  );
  expect(collected.copies).toHaveLength(2);
  expect(collected.copies[0]).toEqual(copy);
  expect(collected.copies[1]).toMatchObject({
    selection: "draft",
    data: { name: "Independent draft" },
  });
  expect(state).toEqual(before);
  expect(canonical(collected)).not.toContain("promotion");
  expect(canonical(collected)).not.toContain("responseContracts");
  await expect(
    collectSavedWorkArchive(
      state,
      archive,
      [{ kind: "retained", digest: "missing" }],
      check,
    ),
  ).rejects.toThrow(/no longer available/);
  state.recoveryImports![digest].input = { ...copy, moduleVersion: "2.0.0" };
  await expect(
    collectSavedWorkArchive(
      state,
      archive,
      [{ kind: "retained", digest }],
      check,
    ),
  ).rejects.toThrow();
});
