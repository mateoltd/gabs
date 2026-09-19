import { expect, it } from "vitest";
import {
  defineModule,
  field,
  operation,
  resource,
  Type,
} from "@suite/module-sdk";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import notes from "../fixtures/queued-resources/module";

const links = Type.Array(
  Type.Object({ owner: field.reference(notes.id, "notes") }),
);
const module = defineModule({
  ...notes,
  resources: {
    notes: resource(
      { name: field.text(), links: Type.Optional(links) },
      { title: "Notes" },
    ),
  },
  operations: {
    capture: operation({
      title: "Link notes",
      policy: "queued",
      permission: "custom-notes.capture",
      input: Type.Object({ links }),
      output: Type.Null(),
    }),
  },
});

it("simulates same-record ordering and independent progress after a conflict", async () => {
  const sim = createModuleSimulator(module);
  const client = sim.client.resource("notes");
  const base = await client.create({ name: "Original" });
  sim.setOnline(false);
  const first = await client.queue.update(base.id, { name: "First" }, base);
  const second = await client.queue.update(base.id, { name: "Second" }, base);
  const independent = await client.queue.create({ name: "Independent" });
  expect(second.dependencies).toEqual([first.key]);
  sim.setOnline(true);
  await client.update(base.id, { name: "Remote" }, base);
  await sim.sync();
  expect(
    sim.snapshot().journal.map(({ id, state }) => ({ id, state })),
  ).toEqual([
    { id: first.key, state: "conflict" },
    { id: second.key, state: "pending" },
    { id: independent.key, state: "accepted" },
  ]);
  expect((await client.get(base.id)).data.name).toBe("Remote");
});

it("derives nested reference prerequisites for resource and command captures", async () => {
  const sim = createModuleSimulator(module);
  const client = sim.client.resource("notes");
  const existing = await client.create({ name: "Existing" });
  sim.setOnline(false);
  const parent = await client.queue.create(
    { name: "Separate" },
    { id: existing.id },
  );
  const linked = { links: [{ owner: existing.id }] };
  const child = await client.queue.create({ name: "Child", ...linked });
  const command = await sim.client.queue("capture", linked);
  expect(child.dependencies).toEqual([parent.key]);
  expect(command.dependencies).toEqual([parent.key]);
  sim.setOnline(true);
  await sim.sync();
  expect(sim.snapshot().journal.map((entry) => entry.state)).toEqual([
    "conflict",
    "pending",
    "pending",
  ]);
});

it("rejects a newly closed dependency cycle without changing the simulated journal", async () => {
  const sim = createModuleSimulator(module);
  const firstKey = crypto.randomUUID();
  const secondKey = crypto.randomUUID();
  await sim.client
    .resource("notes")
    .queue.create(
      { name: "First" },
      { key: firstKey, dependencies: [secondKey] },
    );
  const before = sim.snapshot().journal;
  await expect(
    sim.client.queue(
      "capture",
      { links: [] },
      {
        key: secondKey,
        dependencies: [firstKey],
      },
    ),
  ).rejects.toThrow("depend on each other");
  expect(sim.snapshot().journal).toEqual(before);
});

it("compares retry prerequisites as a set while preserving the original capture", async () => {
  const sim = createModuleSimulator(module);
  const queue = sim.client.resource("notes").queue;
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
  const dependencies = [crypto.randomUUID(), crypto.randomUUID()];
  const original = await queue.create(
    { name: "Same" },
    { key, id, dependencies },
  );
  expect(
    await queue.create(
      { name: "Same" },
      {
        key,
        id,
        dependencies: [...dependencies].reverse(),
      },
    ),
  ).toEqual(original);
  expect(sim.snapshot().journal).toHaveLength(1);
  expect(sim.snapshot().journal[0].captureDependencies).toEqual(dependencies);
});

it("uses the same scheduling for preview submit and the typed queue", async () => {
  const sim = createModuleSimulator(module);
  const client = sim.client.resource("notes");
  const base = await client.create({ name: "Original" });
  sim.setOnline(false);
  const first = await client.queue.update(base.id, { name: "First" }, base);
  const key = crypto.randomUUID();
  await sim.submit({
    moduleId: module.id,
    resource: "notes",
    action: "archive",
    key,
    input: { id: base.id, baseVersion: base.version },
  });
  expect(
    sim.snapshot().journal.find((entry) => entry.id === key)?.dependencies,
  ).toEqual([first.key]);
});
