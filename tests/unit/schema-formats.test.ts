import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import { buildClientViews } from "@suite/module-sdk/node/build-client";
import { buildLocalBundle } from "@suite/module-sdk/node/build-local";
import { signPackage, verifyPackage } from "@suite/module-sdk/node/signing";
import { assertViewHost } from "@suite/module-sdk/host-ui";
import { referenceValues } from "@suite/module-sdk/references";
import { expect, it } from "vitest";
import { FormatRegistry } from "@sinclair/typebox";
import {
  assertSchema,
  checkSchema,
  defineModule,
  field,
  hydrateModule,
  hydrateSchema,
  supportedSchemaFormats,
  Type,
} from "@suite/module-sdk";
import { parseSchemaInput, createSchemaDraft } from "@suite/module-sdk/forms";
import { renderModuleDocumentation } from "@suite/module-sdk/documentation";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import { executeLocalCall, type LocalSnapshot } from "@suite/module-sdk/local";
import module, { schema, valid } from "../fixtures/schema-formats/module";
import local from "../fixtures/schema-formats/module-local";

const cases = [
  ["date", "2024-02-29", "2025-02-29"],
  ["time", "09:30:00+02:00", "09:30:00"],
  ["date-time", "2024-02-29T09:30:00Z", "2025-02-29T09:30:00Z"],
  ["duration", "P2DT3H", "P"],
  ["uri", "urn:example:office", "/office"],
  ["uri-reference", "../office?id=1", "%no"],
  ["uri-template", "https://example.com/{id}", "https://example.com/{"],
  ["email", "reader+office@example.com", "reader..office@example.com"],
  ["hostname", "office.example.com", "bad_name.example.com"],
  ["ipv4", "192.168.1.1", "256.1.1.1"],
  ["ipv6", "2001:db8::1", "2001:db8:::1"],
  ["regex", "^[a-z]+$", "["],
  ["uuid", valid.identifier, "11111111-1111-4111-8111-11111111111z"],
  ["json-pointer", "/office/~0/~1", "/office/~2"],
  ["relative-json-pointer", "1/office", "01/office"],
  ["json-pointer-uri-fragment", "#/office/~1", "office"],
  ["byte", "aGVsbG8=", "aGVsbG8!"],
] as const;

it.each(cases)(
  "validates %s identically for authored, transported and generated forms",
  (format, accepted, rejected) => {
    for (const schema of [
      Type.String({ format }),
      hydrateSchema(JSON.parse(JSON.stringify(Type.String({ format })))),
    ]) {
      expect(checkSchema(schema, accepted)).toBe(true);
      expect(() => assertSchema(schema, accepted)).not.toThrow();
      expect(parseSchemaInput(schema, accepted)).toEqual({
        ok: true,
        value: accepted,
      });
      expect(checkSchema(schema, rejected)).toBe(false);
      expect(() => assertSchema(schema, rejected)).toThrow(/format/);
      expect(parseSchemaInput(schema, rejected).ok).toBe(false);
    }
  },
);
it("covers every supported format and preserves caller registry state even on failure", () => {
  expect([...supportedSchemaFormats].sort()).toEqual(
    cases.map(([name]) => name).sort(),
  );
  const before = FormatRegistry.Get("email");
  const hostile = () => true;
  FormatRegistry.Set("email", hostile);
  try {
    expect(() =>
      assertSchema(Type.String({ format: "email" }), "invalid"),
    ).toThrow();
    expect(FormatRegistry.Get("email")).toBe(hostile);
    FormatRegistry.Delete("email");
    assertSchema(Type.String({ format: "email" }), valid.email);
    expect(FormatRegistry.Has("email")).toBe(false);
  } finally {
    if (before) FormatRegistry.Set("email", before);
    else FormatRegistry.Delete("email");
  }
});
it("rejects unsupported formats in unused branches and module-owned schema positions", () => {
  const bad = Type.String({ format: "email-address" });
  const nested = Type.Object({
    optional: Type.Optional(Type.Union([Type.Null(), bad])),
  });
  expect(() => assertSchema(nested, {})).toThrow(
    /properties\/optional\/anyOf\/1\/format.*email-address.*Use pattern/,
  );
  for (const override of [
    { configuration: nested },
    { resources: { records: { ...module.resources.records, schema: nested } } },
    { operations: { capture: { ...module.operations.capture, output: bad } } },
    { events: { sent: bad } },
    {
      views: {
        home: { ...module.views.home, state: { version: 1, schema: nested } },
      },
    },
  ])
    expect(() => defineModule({ ...module, ...override })).toThrow(
      /Unsupported schema format/,
    );
  expect(() => assertSchema(Type.Number({ format: "int32" }), 1)).toThrow(
    /Use a string schema/,
  );
  expect(() =>
    createSchemaDraft(Type.String({ format: "date", default: "2025-02-29" })),
  ).toThrow();
  // Data that happens to contain a property named format is never a schema.
  assertSchema(Type.Unknown({ default: { format: "custom-data" } }), {});
  if (false) {
    // @ts-expect-error The convenient field API infers the supported format vocabulary.
    field.text({ format: "email-address" });
  }
});
it("preserves constraints, nested issue paths and signed/documented schemas", () => {
  const authored = JSON.stringify(module);
  expect(JSON.stringify(hydrateModule(JSON.parse(authored)))).toBe(authored);
  const documentation = renderModuleDocumentation(module);
  expect(documentation).toContain('"format": "email"');
  expect(documentation).toContain('"format": "date-time"');
  expect(JSON.stringify(module)).toBe(authored);
  expect(() =>
    assertSchema(Type.String({ format: "email", maxLength: 5 }), valid.email),
  ).toThrow();
  expect(() => assertSchema(schema, { ...valid, extra: "no" })).toThrow();
  const parsed = parseSchemaInput(Type.Object({ rows: Type.Array(schema) }), {
    rows: [{ ...valid, date: "2025-02-29" }],
  });
  expect(parsed).toMatchObject({
    ok: false,
    issues: [{ path: "/rows/0/date" }],
  });
});
it("validates simulated corporate and personal records and preserves accepted state after rejection", async () => {
  for (const personal of [false, true]) {
    const sim = createModuleSimulator(module, {
      personal,
      ...(personal ? { local } : {}),
    });
    const client = personal ? sim.localClient : sim.client;
    await client.resource("records").create(valid, "accepted");
    const before = sim.snapshot();
    expect(() =>
      client
        .resource("records")
        .create({ ...valid, date: "2025-02-29" }, "rejected"),
    ).toThrow();
    await expect(
      sim.send({
        moduleId: module.id,
        moduleVersion: module.version,
        resource: "records",
        action: "create",
        input: { data: { ...valid, date: "2025-02-29" } },
        key: "untrusted",
      }),
    ).rejects.toThrow();
    expect(sim.snapshot()).toEqual(before);
    expect((await client.resource("records").list()).items[0].data).toEqual(
      valid,
    );
  }
});
it("validates local operations before committing data or receipts and replays exact accepted results", async () => {
  const snapshot: LocalSnapshot = { records: {}, receipts: {} };
  const request = {
    profileId: "format-profile",
    configuration: {},
    snapshot,
    call: {
      moduleId: module.id,
      moduleVersion: module.version,
      action: "operation" as const,
      operation: "capture",
      input: valid,
      key: "accepted",
    },
  };
  const accepted = await executeLocalCall(module, request, local);
  expect(accepted.result).toEqual(valid);
  expect(accepted.snapshot.records.records).toHaveLength(1);
  expect(
    await executeLocalCall(
      module,
      { ...request, snapshot: accepted.snapshot },
      local,
    ),
  ).toEqual(accepted);
  await expect(
    executeLocalCall(
      module,
      {
        ...request,
        snapshot: accepted.snapshot,
        call: {
          ...request.call,
          key: "rejected",
          input: { ...valid, email: "invalid" },
        },
      },
      local,
    ),
  ).rejects.toThrow();
  expect(accepted.snapshot.records.records).toHaveLength(1);
  expect(Object.keys(accepted.snapshot.receipts)).toHaveLength(1);
  expect(snapshot).toEqual({ records: {}, receipts: {} });
});

it("preserves format constraints in signed bundles and rejects hosts without the format contract", async () => {
  const directory = resolve("tests/fixtures/schema-formats");
  const client = await buildClientViews(module, directory);
  const local = await buildLocalBundle(module, directory);
  expect(client.home.requires!["client.formats"]).toBe(1);
  const host = Object.fromEntries(
    Object.entries(client.home.requires!).map(([name, revision]) => [
      name,
      [revision],
    ]),
  );
  assertViewHost(client.home.requires!, host);
  delete host["client.formats"];
  expect(() => assertViewHost(client.home.requires!, host)).toThrow(
    /client.formats revision 1/,
  );
  const pair = generateKeyPairSync("ed25519");
  const signed = signPackage(
    module,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client,
    local,
  );
  const key = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  verifyPackage(signed, key);
  expect(signed.artifact.resources).toEqual(
    JSON.parse(JSON.stringify(module.resources)),
  );
  const tampered = structuredClone(signed);
  const resources = tampered.artifact.resources as typeof module.resources;
  resources.records.schema.properties.email.format = "uri";
  expect(() => verifyPackage(tampered, key)).toThrow(/signature|checksum/);
});
it("selects format-bearing reference union branches using the same validators", () => {
  const branch = Type.Union([
    Type.Object({
      tag: Type.String({ format: "email" }),
      link: field.reference("contacts", "contacts"),
    }),
    Type.Object({ tag: Type.Literal("none"), link: Type.Null() }),
  ]);
  expect(
    referenceValues(branch, { tag: valid.email, link: valid.identifier }),
  ).toHaveLength(1);
  expect(referenceValues(branch, { tag: "none", link: null })).toEqual([]);
});
