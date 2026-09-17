import { it, expect } from "vitest";
import { createModuleClient, type ModuleDefinition } from "@suite/module-sdk";
import {
  executeLocalCall,
  type LocalReferenceProvider,
  type LocalSnapshot,
} from "@suite/module-sdk/local";
import {
  localReferenceAccess,
  type LocalData,
} from "../packages/platform/src/local-profiles";
import contacts from "../modules/contacts/module";
import projects from "../modules/projects/module";

const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const provider = (): LocalReferenceProvider => ({
  profileId: "profile",
  module: structuredClone(contacts),
  resources: ["contacts"],
  records: {
    contacts: [
      {
        id: targetId,
        data: {
          name: "Local customer",
          kind: "person",
          relationship: "customer",
        },
        archived: false,
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    ],
  },
});
const local = (
  providers: LocalReferenceProvider[] = [],
  module: ModuleDefinition = projects,
) => {
  let snapshot: LocalSnapshot = { records: {}, receipts: {} };
  return {
    get snapshot() {
      return snapshot;
    },
    client: createModuleClient(module, async (call) => {
      const result = await executeLocalCall(module, {
        profileId: "profile",
        call,
        configuration: {},
        snapshot,
        referenceProviders: providers,
      });
      snapshot = result.snapshot;
      return result.result;
    }),
  };
};
it("resolves explicitly granted foreign references and validates local writes without copying provider records into consumer state", async () => {
  const supplied = provider();
  const state = local([supplied]);
  const choices = await state.client
    .resource("projects")
    .references({ field: "/properties/contactId", selected: targetId });
  expect(choices.items).toEqual([{ value: targetId, label: "Local customer" }]);
  expect(choices.selected).toEqual(choices.items[0]);
  const created = await state.client
    .resource("projects")
    .create({ name: "Linked project", status: "planned", contactId: targetId });
  expect(created.data).toMatchObject({ contactId: targetId });
  expect(Object.keys(state.snapshot.records)).toEqual(["projects"]);
  expect(supplied.records.contacts[0].version).toBe(1);
  const archived = provider();
  archived.records.contacts[0].archived = true;
  const denied = local([archived]);
  expect(
    (
      await denied.client
        .resource("projects")
        .references({ field: "/properties/contactId" })
    ).items,
  ).toEqual([]);
  await expect(
    denied.client
      .resource("projects")
      .create({ name: "Must fail", status: "planned", contactId: targetId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(denied.snapshot).toEqual({ records: {}, receipts: {} });
});
it("denies missing grants, foreign profiles, ungranted resources, incompatible dependencies and corporate providers", async () => {
  const altered = [provider(), provider(), provider(), provider(), provider()];
  altered[0].profileId = "foreign";
  altered[1].resources = [];
  altered[2].module.version = "2.0.0";
  altered[3].module.resources.contacts.standalone = false;
  altered[4].module.permissions = [];
  for (const supplied of [undefined, ...altered]) {
    await expect(
      local(supplied ? [supplied] : [])
        .client.resource("projects")
        .references({ field: "/properties/contactId" }),
    ).rejects.toThrow();
  }
  await expect(
    local([provider()], { ...projects, dependencies: {} })
      .client.resource("projects")
      .references({ field: "/properties/contactId" }),
  ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
});
it("defaults declared local reference access to denied and binds consent to both exact releases and the resource", () => {
  const data: LocalData = { records: {} };
  const choice = () =>
    localReferenceAccess(data).find(
      (entry) =>
        entry.consumer.id === projects.id && entry.provider.id === contacts.id,
    )!;
  expect(choice()).toMatchObject({ resource: "contacts", granted: false });
  data.referenceGrants = [
    {
      consumerId: projects.id,
      consumerVersion: projects.version,
      providerId: contacts.id,
      providerVersion: contacts.version,
      resource: "contacts",
      grantedAt: Date.now(),
    },
  ];
  expect(choice().granted).toBe(true);
  data.referenceGrants[0].consumerVersion = "1.0.0";
  expect(choice().granted).toBe(false);
  data.referenceGrants[0].consumerVersion = projects.version;
  data.referenceGrants[0].providerVersion = "1.0.0";
  expect(choice().granted).toBe(false);
  data.referenceGrants[0].providerVersion = contacts.version;
  data.referenceGrants[0].resource = "notes";
  expect(choice().granted).toBe(false);
});
