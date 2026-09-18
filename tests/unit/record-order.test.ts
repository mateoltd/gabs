import { expect, it } from "vitest";
import type { ModuleCall } from "@suite/module-sdk";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";
import {
  recordDependencies,
  recoverRecordOrder,
} from "../../packages/client/src/modules/journal";

it("joins independent older writes without waiting for another account, workspace, module, resource or record", () => {
  const scope = { userId: "user", workspaceId: "company" };
  const first: JournalEntry = {
    ...scope,
    id: "first",
    createdAt: 1,
    attempts: 0,
    state: "pending",
    delivery: "uncertain",
    dependencies: [],
    call: {
      moduleId: "contacts",
      resource: "contacts",
      action: "update",
      input: { id: "ABC" },
    },
  };
  const prior: JournalEntry[] = [
    first,
    { ...first, id: "parallel", state: "rejected" as const },
    { ...first, id: "foreign-user", userId: "other" },
    { ...first, id: "foreign-workspace", workspaceId: "other" },
    {
      ...first,
      id: "foreign-module",
      call: { ...first.call, moduleId: "other" },
    },
    {
      ...first,
      id: "foreign-resource",
      call: { ...first.call, resource: "other" },
    },
    {
      ...first,
      id: "foreign-record",
      call: { ...first.call, input: { id: "DEF" } },
    },
    { ...first, id: "custom", call: { ...first.call, action: "operation" } },
    { ...first, id: "accepted", state: "accepted" as const },
    { ...first, id: "replaced", supersededBy: "first" },
  ];
  const next: ModuleCall = {
    ...first.call,
    action: "archive",
    input: { id: "abc" },
    key: "next",
  };
  expect(recordDependencies(next, prior, scope)).toEqual(["first", "parallel"]);
  expect(
    recordDependencies({ ...next, resource: undefined }, prior, scope),
  ).toEqual([]);
  expect(
    recordDependencies({ ...next, action: "operation" }, prior, scope),
  ).toEqual([]);
  expect(
    recordDependencies(
      next,
      [...prior, { ...first, id: "tail", dependencies: ["first", "parallel"] }],
      scope,
    ),
  ).toEqual(["tail"]);
});

function legacyEntries(): JournalEntry[] {
  return ["old", "later", "independent"].map((id, createdAt) => ({
    id,
    userId: "user",
    workspaceId: "company",
    createdAt,
    attempts: 0,
    state: "pending",
    dependencies: [],
    call: {
      moduleId: "contacts",
      resource: "contacts",
      action: "update",
      key: id,
      input: {
        id: id === "independent" ? "other" : "record",
        baseVersion: 1,
        data: { phone: id },
      },
    },
  }));
}
const legacyScope = { userId: "user", workspaceId: "company" };

it("durably gates unordered uncertain effects while unrelated work proceeds and settlement releases only known unsent work", async () => {
  let entries = legacyEntries();
  entries[1].delivery = "unsubmitted";
  entries[2].delivery = "unsubmitted";
  const calls = structuredClone(entries.map((e) => e.call));
  expect(recoverRecordOrder(entries, legacyScope)).toBe(true);
  expect(entries.map((e) => e.orderingRecovery)).toEqual([
    "outcome",
    "waiting",
    undefined,
  ]);
  expect(entries[1].dependencies).toEqual(["old"]);
  expect(recoverRecordOrder(entries, legacyScope)).toBe(false);
  entries = structuredClone(entries); // durable restart
  const sent: string[] = [];
  const store = {
    list: async () => structuredClone(entries),
    put: async (entry: JournalEntry) => {
      entries = entries.map((e) =>
        e.id === entry.id ? structuredClone(entry) : e,
      );
    },
  };
  await flushJournal(
    store,
    async (call) => {
      sent.push(call.key!);
      return {};
    },
    () => true,
  );
  expect(sent).toEqual(["independent"]);
  expect(entries.map((e) => e.call)).toEqual(calls);
  entries[0].state = "accepted";
  delete entries[0].orderingRecovery;
  delete entries[0].delivery;
  expect(recoverRecordOrder(entries, legacyScope)).toBe(true);
  await flushJournal(
    store,
    async (call) => {
      sent.push(call.key!);
      return {};
    },
    () => true,
  );
  expect(sent).toEqual(["independent", "later"]);
  expect(entries[0].attempts).toBe(0);
});

it("does not dispatch known unsent predecessors before later uncertain outcomes are resolved", () => {
  const entries = legacyEntries();
  entries[0].delivery = "unsubmitted";
  recoverRecordOrder(entries, legacyScope);
  expect(entries.slice(0, 2).map((e) => e.orderingRecovery)).toEqual([
    "waiting",
    "outcome",
  ]);
  entries[1].state = "rejected";
  entries[1].settlement = "cancelled";
  recoverRecordOrder(entries, legacyScope);
  expect(entries.slice(0, 2).map((e) => e.orderingRecovery)).toEqual([
    undefined,
    undefined,
  ]);
  expect(entries[1].dependencies).toEqual(["old"]);
});

it("preserves explicit reverse and cross-record transitive dependencies instead of reconstructing them by timestamps", () => {
  const entries = legacyEntries();
  entries[0].dependencies = ["independent"];
  entries[2].dependencies = ["later"];
  const before = structuredClone(entries);
  expect(recoverRecordOrder(entries, legacyScope)).toBe(false);
  expect(entries).toEqual(before);
});

it("sequences only scoped resource writes, preserves input and stable equal-time capture order, and never repairs existing cycles by guessing", () => {
  const entries = legacyEntries();
  for (const entry of entries) {
    entry.delivery = "unsubmitted";
    entry.createdAt = 1;
  }
  entries.push({
    ...structuredClone(entries[0]),
    id: "foreign",
    userId: "other",
  });
  entries.push({
    ...structuredClone(entries[0]),
    id: "command",
    call: { ...entries[0].call, action: "operation" },
  });
  const calls = structuredClone(entries.map((e) => e.call));
  recoverRecordOrder(entries, legacyScope);
  expect(entries.map((e) => e.dependencies)).toEqual([[], ["old"], [], [], []]);
  expect(entries.map((e) => e.call)).toEqual(calls);
  expect(entries.every((e) => !e.orderingRecovery)).toBe(true);
  const cyclic = legacyEntries();
  cyclic[0].dependencies = ["later"];
  cyclic[1].dependencies = ["old"];
  expect(recoverRecordOrder(cyclic, legacyScope)).toBe(false);
});

it("requires outcome recovery for an older uncertain request when a later unordered effect is already accepted", () => {
  const entries = legacyEntries();
  entries[1].state = "accepted";
  expect(recoverRecordOrder(entries, legacyScope)).toBe(true);
  expect(entries[0].orderingRecovery).toBe("outcome");
  expect(entries[1].dependencies).toEqual([]);
  const sequenced = legacyEntries();
  sequenced[1].state = "accepted";
  sequenced[1].dependencies = [sequenced[0].id];
  expect(recoverRecordOrder(sequenced, legacyScope)).toBe(false);
});
