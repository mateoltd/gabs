import { listModuleReferences } from "../../packages/server/src/runtime/references";
import {
  referenceFields,
  type ReferenceQuery,
} from "@suite/module-sdk/references";
import "dotenv/config";
import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  resource,
  field,
  Type,
  type ModuleDefinition,
} from "@suite/module-sdk";
import {
  connectDatabase,
  identify,
  inWorkspace,
} from "../../composition/src/server/product";
import { provisionWorkspace } from "../../composition/src/server/product";
import {
  authorize,
  type Actor,
  type Context,
} from "../../composition/src/server/product";
import { executeResource } from "../../packages/server/src/runtime/resources";
import contacts from "../../modules/contacts/module";
const db = connectDatabase();
const workspace = randomUUID(),
  foreign = randomUUID();
let actor: Actor,
  member: string,
  foreignMember: string,
  contactId: string,
  foreignContact: string,
  projectId: string;
const contract: ModuleDefinition = {
  ...contacts,
  dependencies: { projects: "^1.0.0" },
  resources: {
    ...contacts.resources,
    notes: resource(
      {
        links: Type.Array(
          Type.Object({ contact: field.reference("contacts", "contacts") }),
          { maxItems: 700 },
        ),
        assignments: Type.Record(Type.String(), field.member()),
        destination: Type.Union([
          Type.Object({
            kind: Type.Literal("project"),
            id: field.reference("projects", "projects"),
          }),
          Type.Object({ kind: Type.Literal("text"), id: Type.String() }),
        ]),
      },
      { title: "Structured notes" },
    ),
  },
};
const context = (
  tx: Parameters<Parameters<typeof inWorkspace>[2]>[0],
  scope = workspace,
) => authorize(tx, actor, scope, randomUUID());
beforeAll(async () => {
  const user = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    name: "Reference owner",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  actor = {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    mfa: true,
  };
  for (const id of [workspace, foreign])
    await inWorkspace(db, id, (tx) =>
      provisionWorkspace(tx, {
        id,
        userId: user.id,
        name: "Nested reference acceptance",
        kind: "company",
      }),
    );
  for (const scope of [workspace, foreign])
    await inWorkspace(db, scope, async (tx) => {
      const ctx = await context(tx, scope);
      const record = (await executeResource(tx, ctx, "contacts", {
        resource: "contacts",
        action: "create",
        input: {
          data: {
            name: "Referenced contact",
            kind: "person",
            relationship: "other",
          },
        },
      })) as { id: string };
      if (scope === workspace) {
        member = ctx.membershipId;
        contactId = record.id;
      } else {
        foreignMember = ctx.membershipId;
        foreignContact = record.id;
      }
    });
  await inWorkspace(db, workspace, async (tx) => {
    const ctx = await context(tx);
    projectId = (
      (await executeResource(tx, ctx, "projects", {
        resource: "projects",
        action: "create",
        input: { data: { name: "Referenced project", status: "active" } },
      })) as { id: string }
    ).id;
    await tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: workspace,
        key: "grant:contacts:projects",
        value: { read: true },
        version: 1,
      })
      .execute();
  });
});
afterAll(() => db.destroy());
function data() {
  return {
    links: [{ contact: contactId }],
    assignments: { reviewer: member },
    destination: { kind: "project", id: projectId },
  };
}
const save = (
  value: unknown,
  definition = contract,
  changeContext?: (ctx: Context) => Context,
) =>
  inWorkspace(db, workspace, async (tx) => {
    const ctx = await context(tx);
    return executeResource(
      tx,
      changeContext?.(ctx) ?? ctx,
      "contacts",
      {
        resource: "notes",
        action: "create",
        input: { data: value as Record<string, unknown> },
      },
      definition,
    );
  });
it("accepts declared nested links and rejects foreign, missing, archived or inactive targets before writing", async () => {
  await expect(save(data())).resolves.toMatchObject({
    data: data(),
    version: 1,
  });
  await expect(
    save({ ...data(), destination: { kind: "text", id: "A free-text note" } }),
  ).resolves.toMatchObject({ version: 1 });
  for (const contact of [foreignContact, randomUUID()])
    await expect(
      save({ ...data(), links: [{ contact }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    save({ ...data(), assignments: { reviewer: foreignMember } }),
  ).rejects.toMatchObject({ code: "INVALID_MEMBER" });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ archived: true })
      .where("workspace_id", "=", workspace)
      .where("id", "=", contactId)
      .execute(),
  );
  await expect(save(data())).rejects.toMatchObject({ code: "NOT_FOUND" });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ archived: false })
      .where("workspace_id", "=", workspace)
      .where("id", "=", contactId)
      .execute(),
  );
  const inactive = randomUUID();
  const target = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    name: "Inactive assignee",
    email: `${randomUUID()}@test.local`,
    emailVerified: true,
  });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .insertInto("suite.memberships")
      .values({
        id: inactive,
        workspace_id: workspace,
        user_id: target.id,
        active: false,
      })
      .execute(),
  );
  await expect(
    save({ ...data(), assignments: { reviewer: inactive } }),
  ).rejects.toMatchObject({ code: "INVALID_MEMBER" });
  const notes = await inWorkspace(db, workspace, (tx) =>
    tx
      .selectFrom("suite.module_records")
      .select("id")
      .where("workspace_id", "=", workspace)
      .where("module_id", "=", "contacts")
      .where("resource", "=", "notes")
      .execute(),
  );
  expect(notes).toHaveLength(2);
});
it("applies dependency, grant and current permission checks inside nested union branches", async () => {
  await expect(
    save(data(), { ...contract, dependencies: {} }),
  ).rejects.toMatchObject({ code: "UNDECLARED_DEPENDENCY" });
  await expect(
    save(data(), contract, (ctx) => ({
      ...ctx,
      permissions: ctx.permissions.filter(
        (p) => p !== "projects.projects.read",
      ),
    })),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { read: false } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", "grant:contacts:projects")
      .execute(),
  );
  await expect(save(data())).rejects.toMatchObject({ code: "GRANT_REQUIRED" });
  await expect(
    save({ ...data(), destination: { kind: "text", id: "No provider call" } }),
  ).resolves.toMatchObject({ version: 1 });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { read: true } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", "grant:contacts:projects")
      .execute(),
  );
});
it("validates every chunk of large collections and deduplicates repeated identifiers", async () => {
  const ids = Array.from({ length: 501 }, () => randomUUID());
  await inWorkspace(db, workspace, (tx) =>
    tx
      .insertInto("suite.module_records")
      .values(
        ids.map((id) => ({
          id,
          workspace_id: workspace,
          module_id: "contacts",
          resource: "contacts",
          archived: false,
          version: 1,
          created_by: actor.id,
          data: {
            name: "Batch contact",
            kind: "person",
            relationship: "other",
          },
        })),
      )
      .execute(),
  );
  await expect(
    save({ ...data(), links: ids.map((contact) => ({ contact })) }),
  ).resolves.toMatchObject({ version: 1 });
  await expect(
    save({
      ...data(),
      links: [...ids.slice(0, 500), foreignContact].map((contact) => ({
        contact,
      })),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    save({
      ...data(),
      links: Array.from({ length: 600 }, () => ({
        contact: contactId.toUpperCase(),
      })),
    }),
  ).resolves.toMatchObject({ version: 1 });
});

it("resolves declared nested fields with bounded paging, separate selected labels and current authority", async () => {
  const declarations = referenceFields(contract.resources.notes.schema);
  const contactField = declarations.find(
    (field) =>
      field.target.kind === "resource" && field.target.moduleId === "contacts",
  )!.schemaPath;
  const projectField = declarations.find(
    (field) =>
      field.target.kind === "resource" && field.target.moduleId === "projects",
  )!.schemaPath;
  const memberField = declarations.find(
    (field) => field.target.kind === "member",
  )!.schemaPath;
  const lookup = (
    input: ReferenceQuery,
    definition = contract,
    changeContext?: (ctx: Context) => Context,
  ) =>
    inWorkspace(db, workspace, async (tx) => {
      const ctx = await context(tx);
      return listModuleReferences(
        tx,
        changeContext?.(ctx) ?? ctx,
        definition,
        "notes",
        input,
      );
    });
  const first = await lookup({
    field: contactField,
    search: "Batch contact",
    limit: 2,
    selected: contactId.toUpperCase(),
  });
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).toBe(first.items[1].value);
  expect(first.selected).toEqual({
    value: contactId,
    label: "Referenced contact",
  });
  expect(Object.keys(first.items[0]).sort()).toEqual(["label", "value"]);
  const next = await lookup({
    field: contactField,
    search: "Batch contact",
    limit: 2,
    cursor: first.nextCursor!,
  });
  expect(next.items).toHaveLength(2);
  expect(next.items.every((item) => item.value > first.nextCursor!)).toBe(true);
  expect(
    await lookup({
      field: contactField,
      search: "No such label",
      selected: foreignContact,
    }),
  ).toEqual({ items: [], nextCursor: null, selected: null });
  expect((await lookup({ field: memberField })).items).toEqual([
    { value: member, label: "Reference owner" },
  ]);
  expect(
    (await lookup({ field: memberField, selected: foreignMember })).selected,
  ).toBeNull();
  expect((await lookup({ field: projectField })).items).toEqual([
    { value: projectId, label: "Referenced project" },
  ]);
  await expect(
    lookup({ field: "/properties/destination/anyOf/1/properties/id" }),
  ).rejects.toMatchObject({ code: "INVALID_REFERENCE_FIELD" });
  await expect(
    lookup({ field: projectField }, { ...contract, dependencies: {} }),
  ).rejects.toMatchObject({ code: "UNDECLARED_DEPENDENCY" });
  for (const permission of [
    "contacts.notes.read",
    "contacts.contacts.read",
    "projects.projects.read",
  ])
    await expect(
      lookup(
        {
          field: permission.startsWith("projects")
            ? projectField
            : contactField,
        },
        contract,
        (ctx) => ({
          ...ctx,
          permissions: ctx.permissions.filter((p) => p !== permission),
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const input of [
    { field: contactField, limit: 101 },
    { field: contactField, selected: "not-a-uuid" },
    { field: contactField, moduleId: "inventory" },
  ])
    await expect(lookup(input)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { read: false } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", "grant:contacts:projects")
      .execute(),
  );
  await expect(lookup({ field: projectField })).rejects.toMatchObject({
    code: "GRANT_REQUIRED",
  });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.platform_settings")
      .set({ value: { read: true } })
      .where("workspace_id", "=", workspace)
      .where("key", "=", "grant:contacts:projects")
      .execute(),
  );
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ archived: true })
      .where("workspace_id", "=", workspace)
      .where("id", "=", contactId)
      .execute(),
  );
  const archived = await lookup({
    field: contactField,
    search: "Referenced",
    selected: contactId,
  });
  expect(archived).toEqual({ items: [], nextCursor: null, selected: null });
  await inWorkspace(db, workspace, (tx) =>
    tx
      .updateTable("suite.module_records")
      .set({ archived: false })
      .where("workspace_id", "=", workspace)
      .where("id", "=", contactId)
      .execute(),
  );
});
