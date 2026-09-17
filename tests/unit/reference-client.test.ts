import { expect, it, vi } from "vitest";
import {
  createModuleClient,
  defineModule,
  field,
  resource,
  Type,
  type ModuleCall,
  type ModuleRequestOptions,
} from "@suite/module-sdk";
import {
  createModuleSimulator,
  defineSimulationModule,
} from "@suite/module-sdk/simulator";
import { executeLocalCall, type LocalSnapshot } from "@suite/module-sdk/local";
import { SuiteClient, type Transport } from "../../packages/client/src/api";
import type {
  ReferenceLoader,
  ReferencePage,
} from "@suite/module-sdk/references";
const id = (value: number) =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const provider = defineModule({
  id: "reference-provider",
  name: "Provider",
  version: "1.0.0",
  description: "Reference fixture",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  configuration: Type.Object({}),
  operations: {},
  permissions: [
    "reference-provider.people.read",
    "reference-provider.people.write",
  ],
  resources: { people: resource({ name: field.text() }, { title: "People" }) },
});
const module = defineModule({
  id: "reference-client",
  name: "Reference client",
  version: "1.0.0",
  description: "Reference fixture",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: { "reference-provider": "^1" },
  configuration: Type.Object({}),
  operations: {},
  permissions: [
    "reference-client.notes.read",
    "reference-client.notes.write",
    "reference-client.targets.read",
    "reference-client.targets.write",
    "reference-client.corporate.read",
    "reference-client.corporate.write",
  ],
  resources: {
    notes: resource(
      {
        name: field.text(),
        link: field.optional(field.reference("reference-client", "targets")),
        external: field.optional(
          field.reference("reference-provider", "people"),
        ),
        member: field.optional(field.member()),
        corporate: field.optional(
          field.reference("reference-client", "corporate"),
        ),
      },
      { title: "Notes", standalone: true },
    ),
    targets: resource(
      { name: field.text() },
      { title: "Targets", standalone: true },
    ),
    corporate: resource({ name: field.text() }, { title: "Corporate" }),
  },
});
const query = { field: "/properties/link", limit: 2 };
const rows = Array.from({ length: 105 }, (_, i) => ({
  id: id(i + 1),
  data: { name: `Target ${String(i + 1).padStart(3, "0")}` },
  version: 1,
  archived: false,
  updatedAt: "2026-09-17T00:00:00Z",
}));
it("exposes a validated, cancellable resource lookup and structurally typed form loader", async () => {
  const send = vi.fn(
    async (
      _call: ModuleCall,
      _options?: ModuleRequestOptions,
    ): Promise<ReferencePage> => ({ items: [], nextCursor: null }),
  );
  const notes = createModuleClient(module, send).resource("notes");
  const controller = new AbortController();
  const loader: ReferenceLoader = notes.loadReferences;
  await loader(
    { kind: "resource", moduleId: module.id, resource: "targets" },
    { limit: 2 },
    controller.signal,
  );
  expect(send).toHaveBeenCalledWith(
    {
      moduleId: module.id,
      moduleVersion: module.version,
      resource: "notes",
      action: "references",
      input: query,
    },
    { signal: controller.signal },
  );
  const sent = send.mock.calls.length;
  await expect(notes.references({ field: "/properties/name" })).rejects.toThrow(
    /declared reference/,
  );
  await expect(notes.references({ ...query, limit: 101 })).rejects.toThrow();
  await expect(
    loader(
      { kind: "resource", moduleId: "other", resource: "hidden" },
      { limit: 2 },
      controller.signal,
    ),
  ).rejects.toThrow(/does not declare/);
  expect(send).toHaveBeenCalledTimes(sent);
  controller.abort();
  await expect(
    loader(
      { kind: "resource", moduleId: module.id, resource: "targets" },
      { limit: 2 },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    notes.references(query, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(send).toHaveBeenCalledTimes(sent);
  const invalid = createModuleClient(module, async () => ({
    items: [{ value: "not-a-uuid", label: "Invalid" }],
    nextCursor: null,
  }));
  await expect(invalid.resource("notes").references(query)).rejects.toThrow();
  const late = new AbortController();
  const delayed = createModuleClient(module, async () => {
    late.abort();
    return { items: [], nextCursor: null };
  });
  await expect(
    delayed.resource("notes").references(query, { signal: late.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  if (false) {
    // @ts-expect-error Only declared resources are available.
    createModuleClient(module, send).resource("missing");
    // @ts-expect-error Query limits must be numbers.
    notes.references({ field: "/properties/link", limit: "2" });
    // @ts-expect-error Callers cannot supply an arbitrary provider route.
    notes.references({ field: "/properties/link", moduleId: "other" });
    const page = await notes.references(query);
    // @ts-expect-error Labels have a declared string type.
    const label: number = page.items[0].label;
    void label;
  }
});
it("maps SDK lookups to the versioned GET endpoint and forwards cancellation", async () => {
  const controller = new AbortController();
  const transport = vi.fn<Transport>(async () => ({
    status: 200,
    body: { items: [], nextCursor: null },
  }));
  const client = new SuiteClient(transport);
  await client
    .module(module, id(900))
    .resource("notes")
    .references(query, { signal: controller.signal });
  expect(transport.mock.calls[0]?.[0]).toEqual({
    operation: "moduleReferences",
    params: { workspaceId: id(900), moduleId: module.id, resource: "notes" },
    query,
    moduleVersion: module.version,
  });
  controller.abort();
  if (false) {
    const page = await client
      .module(module, id(900))
      .resource("notes")
      .references(query);
    const typed: string | null = page.nextCursor;
    void typed;
  }
});
it("simulates paginated labels, selected IDs, explicit read grants, current permissions and membership", async () => {
  const sim = createModuleSimulator(module, {
    records: {
      targets: [
        ...rows.map(({ updatedAt: _updatedAt, ...row }) => row),
        { id: id(200), data: { name: "Archived" }, archived: true },
      ],
    },
    providers: [
      defineSimulationModule(provider, {
        records: { people: [{ id: id(300), data: { name: "External" } }] },
      }),
    ],
    members: [
      { id: id(400), name: "Active" },
      { id: id(401), name: "Inactive", active: false },
      { id: id(402), name: "Disabled", userActive: false },
    ],
  });
  const notes = sim.client.resource("notes");
  const first = await notes.references({
    ...query,
    selected: id(105).toUpperCase(),
  });
  expect(first.items.map((item) => item.value)).toEqual([id(1), id(2)]);
  expect(first.nextCursor).toBe(id(2));
  expect(first.selected).toEqual({ value: id(105), label: "Target 105" });
  expect(
    (await notes.references({ ...query, cursor: first.nextCursor! })).items[0]
      .value,
  ).toBe(id(3));
  expect((await notes.references({ ...query, search: "105" })).items).toEqual([
    { value: id(105), label: "Target 105" },
  ]);
  expect(
    (await notes.references({ ...query, selected: id(200) })).selected,
  ).toBeNull();
  expect(
    (await notes.references({ field: "/properties/member" })).items,
  ).toEqual([{ value: id(400), label: "Active" }]);
  sim.setMembers([{ id: id(400), name: "Active", active: false }]);
  expect(
    (await notes.references({ field: "/properties/member", selected: id(400) }))
      .selected,
  ).toBeNull();
  await expect(
    notes.references({ field: "/properties/external" }),
  ).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
  sim.setReadGrants([{ consumerId: module.id, providerId: provider.id }]);
  expect(
    (await notes.references({ field: "/properties/external" })).items,
  ).toEqual([{ value: id(300), label: "External" }]);
  sim.setModulePermissions(provider.id, []);
  await expect(
    notes.references({ field: "/properties/external" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  sim.setPermissions(["reference-client.notes.read"]);
  await expect(notes.references(query)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  sim.setPermissions(module.permissions);
  sim.setOnline(false);
  await expect(
    sim.submit({
      moduleId: module.id,
      action: "references",
      resource: "notes",
      input: query,
    }),
  ).rejects.toMatchObject({ code: "OFFLINE" });
  expect(sim.snapshot().journal).toEqual([]);
  expect(sim.snapshot().audits).toEqual([]);
  expect(sim.snapshot().events).toEqual([]);
});
it("reads only standalone resources in its own worker snapshot without changing records or receipts", async () => {
  const snapshot: LocalSnapshot = { records: { targets: rows }, receipts: {} };
  const before = structuredClone(snapshot);
  const send = async (call: ModuleCall) => {
    const result = await executeLocalCall(module, {
      profileId: "profile",
      call,
      snapshot,
      configuration: {},
    });
    expect(result.snapshot).toEqual(before);
    return result.result;
  };
  const notes = createModuleClient(module, send).resource("notes");
  expect(
    await notes.references({ ...query, search: "105", selected: id(1) }),
  ).toEqual({
    items: [{ value: id(105), label: "Target 105" }],
    nextCursor: null,
    selected: { value: id(1), label: "Target 001" },
  });
  await expect(
    notes.references({ field: "/properties/external" }),
  ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
  await expect(
    notes.references({ field: "/properties/member" }),
  ).rejects.toMatchObject({ code: "MEMBERSHIP_UNAVAILABLE" });
  await expect(
    notes.references({ field: "/properties/corporate" }),
  ).rejects.toMatchObject({ code: "LOCAL_ONLY" });
  expect(snapshot).toEqual(before);
});
