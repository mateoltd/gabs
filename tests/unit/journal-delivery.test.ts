import { expect, it } from "vitest";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";

function fixture() {
  let entries: JournalEntry[] = ["original", "dependent", "independent"].map(
    (id, createdAt) => ({
      id,
      userId: "user",
      workspaceId: "company",
      call: { moduleId: "contacts", action: "create", input: { id } },
      dependencies: id === "dependent" ? ["original"] : [],
      state: "pending",
      delivery: "unsubmitted",
      createdAt,
      attempts: 0,
    }),
  );
  const store = {
    list: async () => structuredClone(entries),
    put: async (entry: JournalEntry) => {
      entries = entries.map((e) =>
        e.id === entry.id ? structuredClone(entry) : e,
      );
    },
  };
  return { store, entries: () => structuredClone(entries) };
}

it("persists dispatch before effects and retains an uncertain identity through denial, then recovers its receipt", async () => {
  const { store, entries } = fixture();
  const effects = new Map<string, unknown>();
  const send = async (key: string) => {
    expect(entries().find((e) => e.id === key)).toMatchObject({
      delivery: "uncertain",
    });
    if (!effects.has(key)) effects.set(key, { id: key });
    return effects.get(key);
  };
  await flushJournal(
    store,
    async (call) => {
      await send(call.key!);
      throw new TypeError("Reply lost");
    },
    () => true,
  );
  expect(entries()[0]).toMatchObject({
    state: "pending",
    attempts: 1,
    delivery: "uncertain",
  });
  expect(entries()[0].error).not.toContain("Reply lost");
  const denied: string[] = [];
  await flushJournal(
    store,
    async (call) => {
      denied.push(call.key!);
      if (call.key === "original")
        throw { status: 403, message: "Permission revoked" };
      return send(call.key!);
    },
    () => true,
  );
  expect(denied).toEqual(["original", "independent"]);
  expect(entries().map((e) => e.state)).toEqual([
    "pending",
    "pending",
    "accepted",
  ]);
  expect(entries()[0].error).toContain(
    "outcome of an earlier attempt is unknown",
  );
  await flushJournal(
    store,
    (call) => send(call.key!),
    () => true,
  );
  expect(entries().map((e) => e.state)).toEqual([
    "accepted",
    "accepted",
    "accepted",
  ]);
  expect(entries().every((e) => !e.delivery && !e.error)).toBe(true);
  expect([...effects.keys()]).toEqual(["original", "independent", "dependent"]);
});

it("never dispatches when recording an attempt fails and survives a crash after dispatch", async () => {
  const { store, entries } = fixture();
  let sent = 0;
  await expect(
    flushJournal(
      {
        ...store,
        put: async () => {
          throw Error("Disk full");
        },
      },
      async () => {
        sent++;
      },
      () => true,
    ),
  ).rejects.toThrow("Disk full");
  expect(sent).toBe(0);
  expect(entries()[0].delivery).toBe("unsubmitted");
  let writes = 0;
  await expect(
    flushJournal(
      {
        ...store,
        put: async (entry) => {
          if (++writes === 2) throw Error("Process stopped");
          await store.put(entry);
        },
      },
      async () => {
        sent++;
        return { id: "original" };
      },
      () => true,
    ),
  ).rejects.toThrow("Process stopped");
  expect(sent).toBe(1);
  expect(entries()[0]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    attempts: 1,
  });
  await flushJournal(
    store,
    async () => {
      throw { status: 401, message: "Sign in again" };
    },
    () => true,
  );
  expect(entries()[0]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    attempts: 2,
  });
});

it("treats missing legacy delivery evidence as unknown even with zero recorded attempts", async () => {
  const { store, entries } = fixture();
  const old = entries()[0];
  delete old.delivery;
  await store.put(old);
  await flushJournal(
    store,
    async () => {
      throw { status: 412, message: "Version changed" };
    },
    () => true,
  );
  expect(entries()[0]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    attempts: 1,
  });
  expect(entries()[2].state).toBe("conflict");
});

it("does not turn a malformed acceptance into a rejection on a later retry", async () => {
  const { store, entries } = fixture();
  await flushJournal(
    store,
    async () => {
      throw { code: "INVALID_RESOURCE_RESPONSE", message: "Invalid response" };
    },
    () => true,
  );
  await flushJournal(
    store,
    async () => {
      throw { status: 409, message: "Module unavailable" };
    },
    () => true,
  );
  expect(entries().map((e) => e.state)).toEqual([
    "pending",
    "pending",
    "pending",
  ]);
  expect(entries()[0].result).toBeUndefined();
});

it.each([408, 429, 500, 401])(
  "retains ambiguous HTTP %i attempts before stopping the batch",
  async (status) => {
    const { store, entries } = fixture();
    await flushJournal(
      store,
      async () => {
        throw { status };
      },
      () => true,
    );
    expect(entries()[0]).toMatchObject({
      state: "pending",
      delivery: "uncertain",
      attempts: 1,
    });
    expect(entries()[2]).toMatchObject({
      delivery: "unsubmitted",
      attempts: 0,
    });
    await flushJournal(
      store,
      async () => {
        throw { status: 403 };
      },
      () => true,
    );
    expect(entries()[0]).toMatchObject({
      state: "pending",
      delivery: "uncertain",
      attempts: 2,
    });
    expect(entries()[2].state).toBe("rejected");
  },
);

it("retains a definitive collision code without treating an uncertain retry as rejected", async () => {
  const first = fixture();
  await flushJournal(
    first.store,
    async () => {
      throw { status: 409, code: "RECORD_EXISTS" };
    },
    () => true,
  );
  expect(first.entries()[0]).toMatchObject({
    state: "conflict",
    errorCode: "RECORD_EXISTS",
  });
  const uncertain = fixture();
  await flushJournal(
    uncertain.store,
    async () => {
      throw new TypeError("Lost reply");
    },
    () => true,
  );
  await flushJournal(
    uncertain.store,
    async () => {
      throw { status: 409, code: "RECORD_EXISTS" };
    },
    () => true,
  );
  expect(uncertain.entries()[0].state).toBe("pending");
  expect(uncertain.entries()[0].errorCode).toBeUndefined();
});

function reviewedGraph() {
  const template = fixture().entries()[0];
  let entries: JournalEntry[] = [
    ["grandchild", ["child", "child"]],
    ["child", ["replacement"]],
    ["independent", []],
    ["missing", ["absent"]],
    ["cycle-a", ["cycle-b"]],
    ["cycle-b", ["cycle-a"]],
    ["replacement", []],
  ].map(([id, dependencies], createdAt) => ({
    ...structuredClone(template),
    id: id as string,
    dependencies: dependencies as string[],
    call: {
      moduleId: id === "replacement" ? "contacts" : "consumer",
      action: "create",
      input: {},
    },
    createdAt,
  }));
  return {
    entries: () => structuredClone(entries),
    store: {
      list: async () => structuredClone(entries),
      put: async (entry: JournalEntry) => {
        entries = entries.map((e) =>
          e.id === entry.id ? structuredClone(entry) : e,
        );
      },
    },
  };
}

it("drains older cross-module dependents of a new reviewed replacement once, while leaving missing and cyclic prerequisites pending", async () => {
  const graph = reviewedGraph();
  const sent: string[] = [];
  await flushJournal(
    graph.store,
    async (call) => {
      expect(graph.entries().find((e) => e.id === call.key)?.delivery).toBe(
        "uncertain",
      );
      sent.push(call.key!);
      return { id: call.key };
    },
    () => true,
  );
  expect(sent).toEqual(["independent", "replacement", "child", "grandchild"]);
  expect(
    graph
      .entries()
      .filter((e) => e.state === "pending")
      .map((e) => e.id),
  ).toEqual(["missing", "cycle-a", "cycle-b"]);
  expect(
    graph
      .entries()
      .filter((e) => e.state === "accepted")
      .every((e) => e.attempts === 1),
  ).toBe(true);
});

it("does not spin or release dependents after an unverified replacement response", async () => {
  const graph = reviewedGraph();
  const sent: string[] = [];
  await flushJournal(
    graph.store,
    async (call) => {
      sent.push(call.key!);
      if (call.key === "replacement")
        throw { status: 502, code: "INVALID_RESOURCE_RESPONSE" };
      return { id: call.key };
    },
    () => true,
  );
  expect(sent).toEqual(["independent", "replacement"]);
  expect(graph.entries().find((e) => e.id === "replacement")).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    attempts: 1,
  });
  expect(graph.entries().find((e) => e.id === "child")).toMatchObject({
    state: "pending",
    delivery: "unsubmitted",
    attempts: 0,
  });
});

it("rechecks authority before each newly released dependent and resumes safely in a later pass", async () => {
  const graph = reviewedGraph();
  let authorized = true;
  const sent: string[] = [];
  await flushJournal(
    graph.store,
    async (call) => {
      sent.push(call.key!);
      if (call.key === "replacement") authorized = false;
      return { id: call.key };
    },
    () => authorized,
  );
  expect(sent).toEqual(["independent", "replacement"]);
  expect(graph.entries().find((e) => e.id === "child")!.attempts).toBe(0);
  await flushJournal(
    graph.store,
    async (call) => {
      sent.push(call.key!);
      return { id: call.key };
    },
    () => true,
  );
  expect(sent).toEqual(["independent", "replacement", "child", "grandchild"]);
});
