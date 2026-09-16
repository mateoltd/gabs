import { expect, it } from "vitest";
import {
  defineModuleScenarios,
  runModuleScenarios,
} from "@suite/module-sdk/scenarios";
import contacts from "../modules/contacts/module";
import contactScenarios from "../modules/contacts/module.scenarios";
import { defineModuleServer } from "@suite/module-sdk/server";

it("runs Contacts-owned offline authorization and stale-edit scenarios", async () => {
  const results = await runModuleScenarios(contactScenarios);
  expect(results).toHaveLength(2);
  expect(results.every((result) => result.passed)).toBe(true);
});

it("isolates fixtures, network, permissions and receipts between scenarios and reports failures", async () => {
  const fixtures = {
    contacts: [
      {
        name: "Original",
        kind: "person" as const,
        relationship: "customer" as const,
      },
    ],
  };
  const results = await runModuleScenarios(
    defineModuleScenarios(contacts, {
      scenarios: {
        "mutates then fails": async (simulation) => {
          const record = (await simulation.client.resource("contacts").list())
            .items[0];
          await simulation.client
            .resource("contacts")
            .update(
              record.id,
              { ...record.data, name: "Changed" },
              record,
              "shared-key",
            );
          simulation.setOnline(false);
          simulation.setPermissions([]);
          throw Error("Intentional assertion failure");
        },
        "starts clean": async ({ client, snapshot }) => {
          expect(snapshot()).toMatchObject({
            online: true,
            journal: [],
            events: [],
          });
          const record = (await client.resource("contacts").list()).items[0];
          expect(record.data.name).toBe("Original");
          await client
            .resource("contacts")
            .update(
              record.id,
              { ...record.data, name: "Independent" },
              record,
              "shared-key",
            );
        },
      },
    }),
    { fixtures },
  );
  expect(results.map((result) => result.passed)).toEqual([false, true]);
  expect(results[0].error).toContain("Intentional assertion failure");
  expect(fixtures.contacts[0].name).toBe("Original");
});

it("rejects empty suites and preserves inferred fixture and client types", () => {
  expect(() => defineModuleScenarios(contacts, { scenarios: {} })).toThrow(
    "at least one",
  );
  defineModuleScenarios(contacts, {
    scenarios: {
      typed: async ({ client }) => {
        if (false) {
          // @ts-expect-error Unknown resource names must fail when authoring scenarios.
          client.resource("unknown");
          // @ts-expect-error Required fields remain inferred in module-owned tests.
          await client.resource("contacts").create({ name: "Missing kind" });
          await client.resource("contacts").create({
            name: "Wrong",
            // @ts-expect-error Enums are inferred rather than accepting arbitrary strings.
            kind: "invalid",
            relationship: "customer",
          });
        }
      },
    },
    fixtures: {
      contacts: [
        // @ts-expect-error Fixture data uses the same resource schema.
        { name: "Wrong fixture", kind: "invalid", relationship: "customer" },
      ],
    },
  });
});

it("rejects a scenario backend from a different release", () => {
  expect(() =>
    defineModuleScenarios(contacts, {
      server: defineModuleServer({ ...contacts, version: "1.2.0" })({}),
      scenarios: { smoke: async () => {} },
    }),
  ).toThrow("match the module contract exactly");
});
