import assert from "node:assert/strict";
import { defineModuleScenarios } from "@suite/module-sdk/scenarios";
import module from "./module";

export default defineModuleScenarios(module, {
  fixtures: {
    contacts: [
      { name: "Example customer", kind: "person", relationship: "customer" },
    ],
  },
  scenarios: {
    "keeps a rejected offline contact out of accepted records": async (
      simulation,
    ) => {
      simulation.setOnline(false);
      const result = await simulation.submit({
        moduleId: module.id,
        resource: "contacts",
        action: "create",
        key: crypto.randomUUID(),
        input: {
          data: {
            name: "Captured offline",
            kind: "person",
            relationship: "customer",
          },
        },
      });
      assert.equal(result.state, "pending");
      simulation.setPermissions(["contacts.contacts.read"]);
      simulation.setOnline(true);
      await simulation.sync();
      assert.equal(simulation.snapshot().journal[0].state, "rejected");
      const records = await simulation.client.resource("contacts").list();
      assert.deepEqual(
        records.items.map((record) => record.data.name),
        ["Example customer"],
      );
    },
    "rejects stale contact edits without losing the accepted change": async ({
      client,
    }) => {
      const contacts = client.resource("contacts");
      const record = (await contacts.list()).items[0];
      await contacts.update(
        record.id,
        { ...record.data, name: "Accepted name" },
        record,
      );
      await assert.rejects(
        contacts.update(
          record.id,
          { ...record.data, name: "Stale name" },
          record,
        ),
        { code: "VERSION_CONFLICT" },
      );
      assert.equal((await contacts.get(record.id)).data.name, "Accepted name");
    },
  },
});
