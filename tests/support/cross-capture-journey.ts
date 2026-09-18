import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";
import { publishExecutableFixture } from "./executable-fixture";

export async function crossCaptureJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  reconnect(): Promise<void>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  loseParentReply(key: string): Promise<void>;
  dispatched(): Promise<string[]>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const moduleId = "cross-capture";
  await publishExecutableFixture({
    id: moduleId,
    sourceDirectory: "tests/fixtures/cross-capture",
  });
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const response = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Cross-module offline acceptance",
      currency: "EUR",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [scope.workspaceId, moduleId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [scope.workspaceId, moduleId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
    [scope.workspaceId, moduleId],
  );
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      scope.workspaceId,
      ["records", "comments"].flatMap((r) =>
        ["read", "write"].map((a) => `${moduleId}.${r}.${a}`),
      ),
    ],
  );
  const grant = async (read: boolean) => {
    const previous = await pool.query(
      "select version from suite.platform_settings where workspace_id=$1 and key=$2",
      [scope.workspaceId, `grant:${moduleId}:contacts`],
    );
    const result = await api.post(
      `/api/v1/workspaces/${scope.workspaceId}/platform`,
      {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: {
          action: "grant",
          value: { source: moduleId, target: "contacts", read },
          version: previous.rows[0]?.version ?? 0,
        },
      },
    );
    expect(result.ok(), await result.text()).toBe(true);
  };
  const journal = async () => (await options.storage(page, scope)).journal;
  const nav = async (name: string) =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name, exact: true })
      .click();
  const dialog = () => page.getByRole("dialog");
  const save = async () => {
    await dialog()
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(dialog()).toHaveCount(0);
  };
  const contact = async (name: string) => {
    await nav("Contacts");
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "customer");
    await save();
    return (await journal()).at(-1)!;
  };
  const linked = async (name: string, parentId: string) => {
    await nav("Cross capture");
    await page.getByRole("tab", { name: "Records", exact: true }).click();
    await page
      .getByRole("button", { name: "New records", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "Add links item", exact: true })
      .click();
    await selectValue(page, "Linked contact", parentId);
    await page.getByLabel("New key for routes", { exact: true }).fill("a/b~c");
    await page
      .getByRole("button", { name: "Add routes entry", exact: true })
      .click();
    await selectValue(page, "Route contact", parentId);
    await selectValue(page, "Delivery format", "1");
    await selectValue(page, "Delivery contact", parentId);
    await expect(
      dialog().getByRole("combobox", { name: "Linked contact", exact: true }),
    ).toContainText("pending");
    return dialog();
  };
  const comment = async (name: string, parentId: string) => {
    await page.getByRole("tab", { name: "Comments", exact: true }).click();
    await page
      .getByRole("button", { name: "New comments", exact: true })
      .click();
    await selectValue(page, "Parent", parentId);
    await page.getByLabel("Text", { exact: true }).fill(name);
    await save();
    return (await journal()).at(-1)!;
  };
  const recordId = (entry: ModuleStorage["journal"][number]) =>
    (entry.call.input as { id: string }).id;
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await nav("Projects");
  await expect(
    page.getByRole("button", { name: "New projects", exact: true }),
  ).toBeVisible();
  await nav("Contacts");
  await expect(
    page.getByRole("button", { name: "New contacts", exact: true }),
  ).toBeVisible();
  await nav("Cross capture");
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "must grant" }).first(),
  ).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
  const unapproved = await contact("Before reference grant");
  await nav("Cross capture");
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await page.getByRole("button", { name: "New records", exact: true }).click();
  await page
    .getByRole("button", { name: "Add links item", exact: true })
    .click();
  const emptyPicker = dialog().getByRole("combobox", {
    name: "Linked contact",
    exact: true,
  });
  await expect(emptyPicker).toHaveAttribute("aria-busy", "false");
  await expect(emptyPicker).toBeDisabled();
  await expect(emptyPicker).toContainText("No choices available");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await dialog()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await grant(true);
  await options.offline(false);
  await expect.poll(async () => (await journal())[0]?.state).toBe("accepted");
  await expect
    .poll(async () =>
      Object.entries(
        (await options.storage(page, scope)).referenceOptions ?? {},
      ).some(
        ([key, values]) =>
          key.includes("/records/references-v1") &&
          Object.hasOwn(values, "resource:contacts/contacts"),
      ),
    )
    .toBe(true);
  // An open picker also closes when a connected denial removes every option.
  await page.getByRole("button", { name: "New records", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Preserved while choices disappear");
  await page
    .getByRole("button", { name: "Add links item", exact: true })
    .click();
  const livePicker = dialog().getByRole("combobox", {
    name: "Linked contact",
    exact: true,
  });
  await expect(livePicker).toBeEnabled();
  await livePicker.click();
  await expect(
    page.getByRole("option", { name: "Before reference grant", exact: true }),
  ).toBeVisible();
  await grant(false);
  await options.offline(true);
  await options.offline(false);
  await expect(livePicker).toBeDisabled();
  await expect(livePicker).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Preserved while choices disappear",
  );
  await grant(true);
  await options.offline(true);
  await options.offline(false);
  await expect(livePicker).toBeEnabled();
  await expect(livePicker).toHaveAttribute("aria-expanded", "false");
  await dialog()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await options.offline(true);
  const parent = await contact("Captured cross-module contact");
  await linked("Captured nested record", recordId(parent));
  await mkdir("docs/verification/cross-capture", { recursive: true });
  await page.screenshot({
    path: `docs/verification/cross-capture/${options.kind}-picker.png`,
  });
  await save();
  const child = (await journal()).at(-1)!;
  expect(child.dependencies).toEqual([parent.id]); // Three nested references deduplicate the prerequisite.
  const descendant = await comment(
    "Captured dependent comment",
    recordId(child),
  );
  expect(descendant.dependencies).toEqual([child.id]);
  await nav("Projects");
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unrelated project");
  await selectValue(page, "Status", "planned");
  await save();
  const independent = (await journal()).at(-1)!;
  const captured = await journal();
  page = await options.restartOffline();
  await nav("Cross capture");
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await expect(
    page.getByText(
      "Waiting for prerequisite changes to be accepted. Unrelated work can still synchronize.",
    ),
  ).toBeVisible();
  expect((await journal()).map((e) => e.call)).toEqual(
    captured.map((e) => e.call),
  );
  await grant(false);
  await options.loseParentReply(parent.id);
  await options.reconnect();
  await expect
    .poll(async () => (await journal()).map((e) => e.state), { timeout: 45000 })
    .toEqual(["accepted", "accepted", "rejected", "pending", "accepted"]);
  const dispatched = await options.dispatched();
  expect(dispatched.filter((k) => k === parent.id)).toHaveLength(2);
  expect(dispatched.indexOf(child.id)).toBeGreaterThan(
    dispatched.lastIndexOf(parent.id),
  );
  expect(dispatched).not.toContain(descendant.id);
  expect((await journal())[2].errorCode).toBe("GRANT_REQUIRED");
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, moduleId],
      )
    ).rows[0].n,
  ).toBe(0);
  await nav("Cross capture");
  await page.getByRole("tab", { name: "Records", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Captured nested record",
  );
  await expect
    .poll(async () =>
      JSON.stringify((await options.storage(page, scope)).referenceOptions),
    )
    .not.toContain("Captured cross-module contact");
  await options.offline(true);
  await expect(
    dialog().getByRole("combobox", { name: "Linked contact", exact: true }),
  ).not.toContainText("Captured cross-module contact");
  await options.narrow();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode()
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await dialog().evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: `docs/verification/cross-capture/${options.kind}-revoked-narrow.png`,
  });
  await options.wide();
  await grant(true);
  await options.offline(false);
  await expect(
    dialog().getByRole("combobox", { name: "Linked contact", exact: true }),
  ).toContainText("Captured cross-module contact");
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog()).toHaveCount(0);
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual([
      "accepted",
      "accepted",
      "rejected",
      "accepted",
      "accepted",
      "accepted",
    ]);
  const recovered = (await journal()).at(-1)!;
  expect((await journal())[2].supersededBy).toBe(recovered.id);
  expect((await journal())[3].dependencies).toEqual([recovered.id]);
  const expectedLinks = (id: string) => ({
    links: [{ contact: id }],
    routes: { "a/b~c": [id, false] },
    delivery: { kind: "linked", contact: id },
  });
  const rows = (
    await pool.query(
      "select id,resource,data from suite.module_records where workspace_id=$1 and module_id=$2 order by resource",
      [scope.workspaceId, moduleId],
    )
  ).rows;
  expect(rows).toEqual([
    {
      id: recordId(descendant),
      resource: "comments",
      data: { parent: recordId(child), text: "Captured dependent comment" },
    },
    {
      id: recordId(child),
      resource: "records",
      data: {
        name: "Captured nested record",
        ...expectedLinks(recordId(parent)),
      },
    },
  ]);
  // A rejected parent collision must remap every signed nested cross-module reference atomically.
  await options.offline(true);
  const collided = await contact("Colliding cross-module contact");
  await linked("Collision dependent", recordId(collided));
  await save();
  const linkedCollision = (await journal()).at(-1)!;
  const collisionComment = await comment(
    "Collision comment",
    recordId(linkedCollision),
  );
  const occupied = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        "x-module-version": collided.call.moduleVersion!,
      },
      data: {
        resource: "contacts",
        action: "create",
        input: {
          id: recordId(collided),
          data: {
            name: "Existing authoritative contact",
            kind: "organization",
            relationship: "supplier",
          },
        },
      },
    },
  );
  expect(occupied.ok(), await occupied.text()).toBe(true);
  await options.offline(false);
  await expect
    .poll(
      async () => (await journal()).find((e) => e.id === collided.id)?.state,
    )
    .toBe("conflict");
  await nav("Contacts");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Separate recovered contact");
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(dialog()).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await journal()).filter(
          (e) => !e.supersededBy && e.state !== "accepted",
        ).length,
    )
    .toBe(0);
  const finalJournal = await journal();
  const newParent = finalJournal.find(
    (e) =>
      e.id === finalJournal.find((e) => e.id === collided.id)!.supersededBy,
  )!;
  const newChild = finalJournal.find(
    (e) =>
      e.id ===
      finalJournal.find((e) => e.id === linkedCollision.id)!.supersededBy,
  )!;
  const newComment = finalJournal.find(
    (e) =>
      e.id ===
      finalJournal.find((e) => e.id === collisionComment.id)!.supersededBy,
  )!;
  expect(recordId(newParent)).not.toBe(recordId(collided));
  expect(recordId(newChild)).toBe(recordId(linkedCollision));
  expect(newChild.dependencies).toEqual([newParent.id]);
  expect(newComment.dependencies).toEqual([newChild.id]);
  const finalRows = (
    await pool.query(
      "select module_id,resource,id,data,version from suite.module_records where workspace_id=$1",
      [scope.workspaceId],
    )
  ).rows;
  expect(finalRows).toHaveLength(9);
  expect(finalRows.find((r) => r.id === recordId(collided))).toMatchObject({
    version: 1,
    data: { name: "Existing authoritative contact" },
  });
  expect(finalRows.find((r) => r.id === recordId(newChild))).toMatchObject({
    version: 1,
    data: {
      name: "Collision dependent",
      ...expectedLinks(recordId(newParent)),
    },
  });
  expect(finalRows.find((r) => r.id === recordId(newComment)).data.parent).toBe(
    recordId(newChild),
  );
  expect(finalRows.find((r) => r.id === recordId(independent)).data.name).toBe(
    "Unrelated project",
  );
  expect(finalRows.find((r) => r.id === recordId(unapproved)).data.name).toBe(
    "Before reference grant",
  );
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.create','projects.projects.create','cross-capture.records.create','cross-capture.comments.create')",
        [scope.workspaceId],
      )
    ).rows[0].n,
  ).toBe(9);
  await page.screenshot({
    path: `docs/verification/cross-capture/${options.kind}-recovered.png`,
  });
}
