import { describe, it, expect } from "vitest";
import {
  createModuleSimulator,
  validateFixtures,
} from "@suite/module-sdk/simulator";
import contacts from "../../modules/contacts/module";
const data = {
  name: "Offline contact",
  kind: "person",
  relationship: "customer",
};
describe("Developer offline and permission simulation", () => {
  it("keeps offline captures provisional and rechecks revoked permissions on sync", async () => {
    const sim = createModuleSimulator(contacts);
    sim.setOnline(false);
    const result = await sim.submit({
      moduleId: "contacts",
      resource: "contacts",
      action: "create",
      input: { data },
      key: crypto.randomUUID(),
    });
    expect(result.state).toBe("pending");
    expect(sim.snapshot().records.contacts).toHaveLength(0);
    sim.setPermissions(["contacts.contacts.read"]);
    sim.setOnline(true);
    await sim.sync();
    expect(sim.snapshot().journal[0].state).toBe("rejected");
    expect(sim.snapshot().records.contacts).toHaveLength(0);
  });
  it("accepts a queued capture once and preserves idempotency after retries", async () => {
    const sim = createModuleSimulator(contacts);
    sim.setOnline(false);
    const key = crypto.randomUUID(),
      call = {
        moduleId: "contacts",
        resource: "contacts",
        action: "create" as const,
        input: { data },
        key,
      };
    await sim.submit(call);
    await sim.submit(call);
    expect(sim.snapshot().journal).toHaveLength(1);
    sim.setOnline(true);
    await sim.sync();
    await sim.sync();
    expect(sim.snapshot().records.contacts).toHaveLength(1);
    expect(sim.snapshot().journal[0].state).toBe("accepted");
    await expect(
      sim.send({ ...call, input: { data: { ...data, name: "Different" } } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("reports the fixture resource and index for invalid schemas", () => {
    expect(() =>
      validateFixtures(contacts, { contacts: [{ name: "Missing fields" }] }),
    ).toThrow("Fixture contacts[0]");
    expect(() => validateFixtures(contacts, { unknown: [] })).toThrow(
      "Invalid fixture resource",
    );
  });
});
