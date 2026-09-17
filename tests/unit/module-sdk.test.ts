import { defineModuleServer } from "@suite/module-sdk/server";
import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  defineModule,
  resource,
  operation,
  hydrateSchema,
  field,
  Type,
  assertSchema,
  createModuleClient,
  mergeFields,
  type ModuleCall,
} from "@suite/module-sdk";
import { resolveReleases } from "@suite/module-sdk/registry";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";
import {
  validateOrganization,
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import { signPackage, verifyPackage } from "../../packages/sdk/node/signing";
import contacts from "../../modules/contacts/module";
import projects from "../../modules/projects/module";
const policy: OrganizationPolicy = {
  rootId: "root",
  ranks: [
    {
      id: "root",
      name: "Administrador",
      parents: [],
      inherit: false,
      denies: [],
      x: 0,
      y: 0,
    },
    {
      id: "staff",
      name: "Staff",
      parents: ["root"],
      inherit: false,
      denies: [],
      x: 0,
      y: 100,
    },
  ],
  groups: [],
};
describe("Module authoring and trust", () => {
  it("retains the authored release identity on every typed resource request", async () => {
    const sent: ModuleCall[] = [];
    const client = createModuleClient(contacts, async (call) => {
      sent.push(structuredClone(call));
      const row = {
        id: "one",
        data: { name: "A", kind: "organization", relationship: "customer" },
        version: 1,
        archived: call.action === "archive",
        updatedAt: new Date().toISOString(),
      };
      return call.action === "list" ? { items: [row], nextCursor: null } : row;
    });
    await client.resource("contacts").list();
    await client.resource("contacts").get("one");
    await client
      .resource("contacts")
      .create({ name: "A", kind: "organization", relationship: "customer" });
    await client.resource("contacts").archive("one", 1);
    expect(sent).toHaveLength(4);
    expect(sent.every((call) => call.moduleVersion === contacts.version)).toBe(
      true,
    );
  });
  it("infers schemas and rejects invalid records at runtime", () => {
    expect(() =>
      assertSchema(contacts.resources.contacts.schema, {
        name: "Acme",
        kind: "alien",
        relationship: "customer",
      }),
    ).toThrow();
    expect(() =>
      assertSchema(contacts.resources.contacts.schema, {
        name: "Acme",
        kind: "organization",
        relationship: "customer",
        extra: true,
      }),
    ).toThrow();
    const client = createModuleClient(contacts, async () => ({}));
    if (false) {
      // @ts-expect-error Resource names are inferred from the module definition.
      client.resource("invoices");
      void client
        .resource("contacts")
        // @ts-expect-error Enum values are inferred, not widened to string.
        .create({ name: "Acme", kind: "alien", relationship: "customer" });
      // @ts-expect-error Required resource fields cannot be omitted.
      void client.resource("contacts").create({ name: "Acme" });
    }
  });
  it("preserves literal permission contracts", () => {
    if (false) {
      defineModule({
        ...contacts,
        operations: {
          // @ts-expect-error Operations cannot request an undeclared permission.
          invalid: operation({
            title: "Invalid",
            policy: "online",
            permission: "contacts.admin",
            input: Type.Object({}),
            output: Type.Object({}),
          }),
        },
      });
    }
  });
  it("resolves dependencies before dependents and fails closed on pins", () => {
    expect(
      resolveReleases("projects", [projects, contacts], "1.0.0", "1.0.0").map(
        (m) => m.id,
      ),
    ).toEqual(["contacts", "projects"]);
    expect(() =>
      resolveReleases("projects", [projects, contacts], "1.0.0", "1.0.0", {
        contacts: "9.0.0",
      }),
    ).toThrow();
  });
  it("requires explicit prerelease selection and still enforces consumer compatibility", () => {
    const preview = { ...contacts, version: "2.0.0-preview.1" };
    const releases = [contacts, preview, projects];
    expect(
      resolveReleases("contacts", releases, "1.0.0", "1.0.0").at(-1)?.version,
    ).toBe(contacts.version);
    expect(
      resolveReleases("contacts", releases, "1.0.0", "1.0.0", {
        contacts: preview.version,
      }).at(-1)?.version,
    ).toBe(preview.version);
    expect(() =>
      resolveReleases("projects", releases, "1.0.0", "1.0.0", {
        contacts: preview.version,
      }),
    ).toThrow();
    const compatible = {
      ...projects,
      dependencies: { contacts: preview.version },
    };
    expect(
      resolveReleases(
        "projects",
        [contacts, preview, compatible],
        "1.0.0",
        "1.0.0",
      ).map((m) => m.version),
    ).toEqual([preview.version, projects.version]);
  });
  it("detects modified artifacts and foreign signing keys", () => {
    const pair = generateKeyPairSync("ed25519"),
      other = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      publicKey = pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
    const pkg = signPackage(contacts, privateKey);
    expect(verifyPackage(pkg, publicKey)).toBe(pkg);
    expect(() =>
      verifyPackage(
        pkg,
        other.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toThrow();
    expect(() =>
      verifyPackage(
        { ...pkg, artifact: { ...pkg.artifact, name: "Altered" } },
        publicKey,
      ),
    ).toThrow();
  });
  it("preserves nested record and tuple validation across signed JSON transport", () => {
    const schema = Type.Object(
      {
        labels: Type.Record(
          Type.String(),
          Type.Object(
            { count: Type.Integer({ minimum: 0 }) },
            { additionalProperties: false },
          ),
        ),
        pair: Type.Tuple([Type.String(), Type.Integer()]),
      },
      { additionalProperties: false },
    );
    const restored = hydrateSchema(JSON.parse(JSON.stringify(schema)));
    expect(() =>
      assertSchema(restored, {
        labels: { item: { count: 2 } },
        pair: ["a", 1],
      }),
    ).not.toThrow();
    expect(() =>
      assertSchema(restored, {
        labels: { item: { count: "2" } },
        pair: ["a", 1],
      }),
    ).toThrow();
    expect(() =>
      assertSchema(restored, { labels: {}, pair: [1, "a"] }),
    ).toThrow();
    expect(() => hydrateSchema({ type: "unrecognized" } as never)).toThrow(
      "Unsupported transported schema",
    );
  });
  it("merges disjoint fields but returns conflicts for concurrent edits", () => {
    expect(
      mergeFields(
        { name: "A", phone: "1" },
        { name: "B", phone: "1" },
        { name: "A", phone: "2" },
      ),
    ).toEqual({ data: { name: "B", phone: "2" }, conflicts: [] });
    expect(
      mergeFields({ name: "A" }, { name: "B" }, { name: "C" }).conflicts,
    ).toEqual(["name"]);
  });
});
describe("Organization invariants", () => {
  it("does not inherit unless opted in and applies explicit denials", () => {
    const grants = {
      root: ["records.read", "records.write"],
      staff: ["records.read"],
    };
    expect(effectivePermissions(["staff"], grants, policy).permissions).toEqual(
      ["records.read"],
    );
    const inherited = {
      ...policy,
      ranks: policy.ranks.map((r) =>
        r.id === "staff"
          ? { ...r, inherit: true, denies: ["records.write"] }
          : r,
      ),
    };
    expect(
      effectivePermissions(["staff"], grants, inherited).permissions,
    ).toEqual(["records.read"]);
    expect(
      effectivePermissions(["staff"], grants, inherited).sources[
        "records.write"
      ].denies,
    ).toEqual(["staff"]);
  });
  it("rejects cycles, orphans, and altered roots", () => {
    expect(() =>
      validateOrganization({
        ...policy,
        ranks: [policy.ranks[0], { ...policy.ranks[1], parents: [] }],
      }),
    ).toThrow();
    expect(() =>
      validateOrganization({
        ...policy,
        ranks: [policy.ranks[0], { ...policy.ranks[1], parents: ["staff"] }],
      }),
    ).toThrow();
    expect(() =>
      validateOrganization({
        ...policy,
        ranks: [{ ...policy.ranks[0], name: "Changed" }, policy.ranks[1]],
      }),
    ).toThrow();
  });
});
describe("Durable journal", () => {
  it("keeps conflicts visible and continues independent operations", async () => {
    let entries: JournalEntry[] = ["a", "b", "c"].map((id, i) => ({
      id,
      userId: "u",
      workspaceId: "w",
      call: {
        moduleId: "contacts",
        resource: "contacts",
        action: "create",
        input: {},
      },
      dependencies: id === "c" ? ["a"] : [],
      state: "pending",
      createdAt: i,
      attempts: 0,
    }));
    const sent: string[] = [];
    await flushJournal(
      {
        list: async () => entries,
        put: async (e) => {
          entries = entries.map((v) => (v.id === e.id ? e : v));
        },
      },
      async (call) => {
        sent.push(call.key!);
        if (call.key === "a") throw { status: 412, message: "conflict" };
        return { id: "record" };
      },
      () => true,
    );
    expect(sent).toEqual(["a", "b"]);
    expect(entries.map((e) => e.state)).toEqual([
      "conflict",
      "accepted",
      "pending",
    ]);
  });
  it("does not submit after authorization expires", async () => {
    let calls = 0;
    await flushJournal(
      {
        list: async () => [
          {
            id: "a",
            userId: "u",
            workspaceId: "w",
            call: { moduleId: "m", action: "create", input: {} },
            dependencies: [],
            state: "pending",
            createdAt: 0,
            attempts: 0,
          },
        ],
        put: async () => {},
      },
      async () => {
        calls++;
      },
      () => false,
    );
    expect(calls).toBe(0);
  });
});

describe("Module storage contracts", () => {
  it("requires matching typed migration handlers and rejects ambiguous or backward paths", () => {
    const module = defineModule({
      ...contacts,
      storage: {
        version: 2,
        compatible: { minimum: 1, maximum: 2 },
        migrations: { upgrade: { from: 1, to: 2 } },
      },
    });
    defineModuleServer(module)({}, { upgrade: async () => {} });
    if (false) {
      // @ts-expect-error Declared migrations require a handler map.
      defineModuleServer(module)({});
      // @ts-expect-error The handler must use a declared migration identifier.
      defineModuleServer(module)({}, { typo: async () => {} });
    }
    expect(() =>
      defineModule({
        ...module,
        storage: {
          ...module.storage,
          migrations: { upgrade: { from: 2, to: 1 } },
        },
      }),
    ).toThrow(/migration/);
    expect(() =>
      defineModule({
        ...module,
        storage: {
          ...module.storage,
          migrations: {
            upgrade: { from: 1, to: 2 },
            duplicate: { from: 1, to: 2 },
          },
        },
      }),
    ).toThrow(/ambiguous/);
    expect(() =>
      defineModule({
        ...module,
        storage: { ...module.storage, compatible: { minimum: 1, maximum: 1 } },
      }),
    ).toThrow(/compatibility/);
  });
});
