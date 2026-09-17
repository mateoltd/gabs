import { expect, it } from "vitest";
import {
  createModuleClient,
  defineModule,
  field,
  operation,
  resource,
  Type,
  type ModuleCall,
} from "@suite/module-sdk";
import {
  defineLocalModule,
  executeLocalCall,
  type LocalSnapshot,
} from "@suite/module-sdk/local";
import {
  createModuleSimulator,
  defineSimulationModule,
} from "@suite/module-sdk/simulator";
import { defineModuleServer } from "@suite/module-sdk/server";
const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const missingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const provider = defineModule({
  id: "integrity-provider",
  name: "Provider",
  version: "1.0.0",
  description: "Reference tests",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  configuration: Type.Object({}),
  operations: {},
  permissions: [
    "integrity-provider.targets.read",
    "integrity-provider.targets.write",
  ],
  resources: {
    targets: resource(
      { name: field.text() },
      { title: "Targets", standalone: true },
    ),
  },
});
const link = () => field.reference("reference-integrity", "targets");
const atomic = <const P extends "local" | "online">(policy: P) =>
  operation({
    title: "Atomic",
    policy,
    permission: "reference-integrity.run",
    input: Type.Object({ fail: Type.Boolean() }),
    output: Type.String(),
  });
const module = defineModule({
  id: "reference-integrity",
  name: "Integrity",
  version: "1.0.0",
  description: "Reference tests",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: { "integrity-provider": "^1" },
  configuration: Type.Object({}),
  permissions: [
    "reference-integrity.run",
    ...["notes", "targets", "corporate"].flatMap((name) =>
      ["read", "write"].map(
        (action) => `reference-integrity.${name}.${action}`,
      ),
    ),
  ],
  resources: {
    targets: resource(
      { name: field.text() },
      { title: "Targets", standalone: true },
    ),
    corporate: resource({ name: field.text() }, { title: "Corporate" }),
    notes: resource(
      {
        name: field.text(),
        nested: Type.Optional(
          Type.Object({
            links: Type.Array(link()),
            map: Type.Record(Type.String(), link()),
            choice: Type.Union([
              Type.Object({ kind: Type.Literal("link"), value: link() }),
              Type.Object({ kind: Type.Literal("text"), value: Type.String() }),
            ]),
          }),
        ),
        external: Type.Optional(field.reference(provider.id, "targets")),
        member: Type.Optional(field.member()),
        corporate: Type.Optional(
          field.reference("reference-integrity", "corporate"),
        ),
      },
      { title: "Notes", standalone: true },
    ),
  },
  operations: { localatomic: atomic("local"), serveratomic: atomic("online") },
});
const nested = (id = targetId) => ({
  links: [id, id.toUpperCase()],
  map: { a: id },
  choice: { kind: "link" as const, value: id },
});
const record = {
  id: targetId,
  data: { name: "Target" },
  version: 1,
  archived: false,
  updatedAt: new Date().toISOString(),
};
const initial = (): LocalSnapshot => ({
  records: { targets: [structuredClone(record)] },
  receipts: {},
});
const request = (call: ModuleCall, snapshot: LocalSnapshot) => ({
  profileId: "integrity-profile",
  configuration: {},
  call,
  snapshot,
});
function local(snapshot = initial()) {
  return {
    get snapshot() {
      return snapshot;
    },
    client: createModuleClient(module, async (call) => {
      const result = await executeLocalCall(module, request(call, snapshot));
      snapshot = result.snapshot;
      return result.result;
    }),
  };
}
const fixture = () =>
  defineSimulationModule(module, {
    records: { targets: [{ id: targetId, data: record.data }] },
  });
it("local writes validate nested links, reject missing/archived targets and preserve failed edits and receipts", async () => {
  const session = local();
  const notes = session.client.resource("notes");
  const saved = await notes.create(
    { name: "Valid", nested: nested() },
    "accepted",
  );
  const before = structuredClone(session.snapshot);
  for (const data of [
    { name: "Missing", nested: nested(missingId) },
    {
      name: "Missing map",
      nested: { ...nested(), map: { hidden: missingId } },
    },
  ]) {
    await expect(
      notes.update(saved.id, data, saved, "rejected"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(session.snapshot).toEqual(before);
  }
  await session.client.resource("targets").archive(targetId, 1);
  await expect(
    notes.update(saved.id, { name: "Archived", nested: nested() }, saved),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  // Receipt recovery returns the already accepted result, even if its target later archives.
  expect(
    await notes.create({ name: "Valid", nested: nested() }, "accepted"),
  ).toEqual(saved);
  expect(session.snapshot.records.notes).toHaveLength(1);
  // Removing the stale link is an explicit valid correction.
  expect(
    (await notes.update(saved.id, { name: "Repaired" }, saved, "rejected"))
      .data,
  ).toEqual({ name: "Repaired" });
});
it("standalone writes reject cross-module, member and corporate targets without fabricating authority", async () => {
  const session = local();
  for (const [data, code] of [
    [{ name: "Member", member: targetId }, "MEMBERSHIP_UNAVAILABLE"],
    [{ name: "Cross module", external: targetId }, "LOCAL_SCOPE_DENIED"],
    [{ name: "Corporate", corporate: targetId }, "LOCAL_ONLY"],
  ] as const) {
    await expect(
      session.client.resource("notes").create(data),
    ).rejects.toMatchObject({ code });
    expect(session.snapshot).toEqual(initial());
  }
  // Unmatched free-text union branch is not a reference.
  await expect(
    session.client.resource("notes").create({
      name: "Text",
      nested: {
        links: [],
        map: {},
        choice: { kind: "text", value: missingId },
      },
    }),
  ).resolves.toMatchObject({ version: 1 });
});
it("local atomic operations resolve earlier writes and roll back even when a rejected reference is caught", async () => {
  const implementation = defineLocalModule(module)({
    async localatomic(ctx, input) {
      const target = await ctx
        .resource("targets")
        .create({ name: "Created inside transaction" });
      const note = await ctx.resource("notes").create({
        name: "Linked inside transaction",
        nested: nested(target.id),
      });
      if (input.fail)
        try {
          await ctx
            .resource("notes")
            .create({ name: "Invalid", nested: nested(missingId) });
        } catch {}
      return note.id;
    },
  });
  const snapshot = initial();
  const call = (fail: boolean): ModuleCall => ({
    moduleId: module.id,
    moduleVersion: module.version,
    action: "operation",
    operation: "localatomic",
    input: { fail },
    key: "atomic",
  });
  await expect(
    executeLocalCall(module, request(call(true), snapshot), implementation),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(snapshot).toEqual(initial());
  const accepted = await executeLocalCall(
    module,
    request(call(false), snapshot),
    implementation,
  );
  expect(accepted.snapshot.records.notes).toHaveLength(1);
  expect(accepted.snapshot.records.targets).toHaveLength(2);
  expect(Object.keys(accepted.snapshot.receipts)).toEqual(["atomic"]);
});
it("simulated corporate writes recheck references, memberships, dependencies and explicit read grants", async () => {
  const sim = createModuleSimulator(module, {
    ...fixture(),
    providers: [
      defineSimulationModule(provider, {
        records: { targets: [{ id: targetId, data: record.data }] },
      }),
    ],
    members: [{ id: targetId, name: "Member" }],
  });
  const notes = sim.client.resource("notes");
  await expect(
    notes.create({ name: "Missing", nested: nested(missingId) }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    notes.create({ name: "Ungrant", external: targetId }),
  ).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
  sim.setReadGrants([{ consumerId: module.id, providerId: provider.id }]);
  const saved = await notes.create(
    { name: "Valid", nested: nested(), external: targetId, member: targetId },
    "saved",
  );
  sim.setModulePermissions(provider.id, []);
  const denied = structuredClone(sim.snapshot());
  await expect(notes.update(saved.id, saved.data, saved)).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  expect(sim.snapshot()).toEqual(denied);
  sim.setModulePermissions(provider.id, provider.permissions);
  sim.setMembers([{ id: targetId, name: "Revoked", userActive: false }]);
  await expect(notes.update(saved.id, saved.data, saved)).rejects.toMatchObject(
    { code: "INVALID_MEMBER" },
  );
  sim.setMembers([{ id: targetId, name: "Revoked", active: false }]);
  await expect(notes.update(saved.id, saved.data, saved)).rejects.toMatchObject(
    { code: "INVALID_MEMBER" },
  );
  expect(
    await notes.create(
      { name: "Valid", nested: nested(), external: targetId, member: targetId },
      "saved",
    ),
  ).toEqual(saved);
  expect(sim.snapshot().audits).toHaveLength(1);
  await sim.client.resource("targets").archive(targetId, 1);
  await expect(
    notes.create({ name: "Archived", nested: nested() }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("offline simulation rejects newly invalid links on reconnect without blocking unrelated pending work", async () => {
  const sim = createModuleSimulator(module, fixture());
  sim.setOnline(false);
  for (const [key, data] of [
    ["invalid", { name: "Provisional", nested: nested(missingId) }],
    ["valid", { name: "Independent" }],
  ] as const)
    await sim.submit({
      moduleId: module.id,
      resource: "notes",
      action: "create",
      input: { data },
      key,
    });
  expect(sim.snapshot().records.notes).toHaveLength(0);
  sim.setOnline(true);
  await sim.sync();
  expect(sim.snapshot().journal.map((e) => e.state)).toEqual([
    "rejected",
    "accepted",
  ]);
  expect(sim.snapshot().records.notes.map((r) => r.data.name)).toEqual([
    "Independent",
  ]);
  expect(sim.snapshot().audits).toHaveLength(1);
});
it("simulated server operations roll back preceding writes and effects after a caught reference rejection", async () => {
  const server = defineModuleServer(module)({
    async serveratomic(ctx, input) {
      const target = await ctx.resource("targets").create({ name: "New" });
      const note = await ctx
        .resource("notes")
        .create({ name: "New note", nested: nested(target.id) });
      if (input.fail)
        try {
          await ctx
            .resource("notes")
            .create({ name: "Invalid", nested: nested(missingId) });
        } catch {}
      return note.id;
    },
  });
  const sim = createModuleSimulator(module, { ...fixture(), server });
  const before = sim.snapshot();
  await expect(
    sim.client.call("serveratomic", { fail: true }, "atomic"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(sim.snapshot()).toEqual(before);
  await sim.client.call("serveratomic", { fail: false }, "atomic");
  expect(sim.snapshot().records.notes).toHaveLength(1);
});
