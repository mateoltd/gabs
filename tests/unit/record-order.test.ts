import { expect, it } from "vitest";
import type { ModuleCall } from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import { recordDependencies } from "../../packages/client/src/modules/journal";

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
