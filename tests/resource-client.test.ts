import { it, expect } from "vitest";
import {
  createModuleClient,
  type ModuleCall,
  type ResourceRecord,
} from "@suite/module-sdk";
import { useResourceList } from "@suite/ui-web";
import contacts from "../modules/contacts/module";

it("keeps typed resource clients stable within a host context and separate across contexts", () => {
  const send = async () => ({});
  const first = createModuleClient(contacts, send);
  const second = createModuleClient(contacts, send);
  const resource = first.resource("contacts");
  expect(first.resource("contacts")).toBe(resource);
  expect(first.resource("contacts").loadReferences).toBe(
    resource.loadReferences,
  );
  expect(second.resource("contacts")).not.toBe(resource);
  expect(first.resource("notes")).not.toBe(resource);
  expect(() => first.resource("unknown" as "contacts")).toThrow(
    "Unknown resource",
  );
  function verifyTypes() {
    const list = useResourceList(resource, {
      where: { kind: "person" },
      orderBy: [{ field: "name", direction: "asc" }],
    });
    if (list.status === "success") {
      const kind: "person" | "organization" = list.page.items[0].data.kind;
      void kind;
      // @ts-expect-error Returned fields retain the resource schema.
      list.page.items[0].data.invoice;
    }
    // @ts-expect-error A field from another resource is invalid.
    useResourceList(resource, { where: { invoice: "one" } });
    // @ts-expect-error Filter values retain enum types.
    useResourceList(resource, { where: { kind: "unknown" } });
    useResourceList(resource, {
      // @ts-expect-error Invalid sort fields are rejected.
      orderBy: [{ field: "unknown", direction: "asc" }],
    });
    // @ts-expect-error The hook owns pagination cursors.
    useResourceList(resource, { cursor: "another-page" });
  }
  void verifyTypes;
});
it("cancels reads before dispatch and after an uncooperative transport resolves", async () => {
  const sent: { call: ModuleCall; signal?: AbortSignal }[] = [];
  let resolve: (value: unknown) => void = () => {};
  const client = createModuleClient(contacts, (call, options) => {
    sent.push({ call, signal: options?.signal });
    return new Promise((done) => {
      resolve = done;
    });
  }).resource("contacts");
  const stopped = new AbortController();
  stopped.abort();
  await expect(
    client.list({}, { signal: stopped.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    client.get("one", { signal: stopped.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(sent).toHaveLength(0);
  for (const action of ["list", "get"] as const) {
    const controller = new AbortController();
    const pending =
      action === "list"
        ? client.list({}, { signal: controller.signal })
        : client.get("one", { signal: controller.signal });
    expect(sent.at(-1)?.signal).toBe(controller.signal);
    expect(sent.at(-1)?.call.moduleVersion).toBe(contacts.version);
    controller.abort();
    resolve(
      action === "list" ? { items: [], nextCursor: null } : { id: "one" },
    );
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  }
});
it("reads normally through the same stable client and keeps mutation semantics", async () => {
  const row: ResourceRecord = {
    id: "one",
    version: 1,
    data: { name: "Contact", kind: "person", relationship: "customer" },
    archived: false,
    updatedAt: "now",
  };
  const sent: ModuleCall[] = [];
  const client = createModuleClient(contacts, async (call) => {
    sent.push(call);
    return call.action === "list" ? { items: [row], nextCursor: null } : row;
  }).resource("contacts");
  expect((await client.list()).items[0]).toBe(row);
  expect(await client.get("one")).toBe(row);
  await client.create(
    { name: "Contact", kind: "person", relationship: "customer" },
    "stable-key",
  );
  expect(sent.at(-1)?.key).toBe("stable-key");
});
