import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { selectValue } from "./controls.helpers";
async function workspace(page: Page, assignedModules?: string[]) {
  await page.goto("/");
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const id = randomUUID();
  const result = await page.request.post("/api/v1/workspaces", {
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: { id, name: "Platform acceptance", currency: "EUR" },
  });
  expect(result.ok()).toBeTruthy();
  if (assignedModules) {
    const members = await (
      await page.request.get(`/api/v1/workspaces/${id}/members`)
    ).json();
    const member = members.items.find(
      (m: { userId: string }) => m.userId === me.user.id,
    );
    const assigned = await page.request.patch(
      `/api/v1/workspaces/${id}/members/${member.id}`,
      {
        headers: {
          "idempotency-key": crypto.randomUUID(),
          origin: new URL(page.url()).origin,
          "x-csrf-token": me.csrfToken,
        },
        data: {
          revision: member.revision,
          active: true,
          roleIds: member.roles.map((r: { id: string }) => r.id),
          modules: assignedModules,
        },
      },
    );
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
  }
  await page.reload();
  await selectValue(page, "Workspace", id);
  return id;
}
test("generated Contacts and Projects work through the actual interface", async ({
  page,
}) => {
  const workspaceId = await workspace(page);
  const me = await (await page.request.get("/api/v1/me")).json();
  for (const moduleId of ["contacts", "projects"]) {
    const rollout = await page.request.post(
      `/api/v1/workspaces/${workspaceId}/platform`,
      {
        headers: {
          origin: new URL(page.url()).origin,
          "x-csrf-token": me.csrfToken,
          "idempotency-key": randomUUID(),
        },
        data: {
          action: "rollout",
          version: 0,
          value: {
            moduleId,
            version: "1.1.0",
            mandatory: true,
            acceptedVersions: [],
          },
        },
      },
    );
    expect(rollout.ok(), await rollout.text()).toBeTruthy();
  }
  const grant = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/platform`,
    {
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
        "idempotency-key": randomUUID(),
      },
      data: {
        action: "grant",
        version: 0,
        value: { source: "projects", target: "contacts", read: true },
      },
    },
  );
  expect(grant.ok(), await grant.text()).toBeTruthy();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Acme acceptance");
  await selectValue(page, "Kind", "organization");
  await selectValue(page, "Relationship", "customer");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Acme acceptance", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Office rollout");
  await page.getByRole("combobox", { name: "Contact Id", exact: true }).click();
  await page
    .getByRole("option", { name: "Acme acceptance", exact: true })
    .click();
  await selectValue(page, "Status", "active");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Office rollout", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "New tasks", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Assign the rollout");
  await page.getByRole("combobox", { name: "Project Id", exact: true }).click();
  await page
    .getByRole("option", { name: "Office rollout", exact: true })
    .click();
  await selectValue(page, "Status", "todo");
  await page.getByRole("combobox", { name: "Assignee", exact: true }).click();
  await page.getByRole("option", { name: "Alex Morgan", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Assign the rollout", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Alex Morgan", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Organization hierarchy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Permission matrix" }),
  ).toBeVisible();
});
test("local profiles persist encrypted records across lock and unlock", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Use a local profile" }).click();
  await page
    .getByLabel("Profile name", { exact: true })
    .fill("Local acceptance");
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Private contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "other");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Private contact", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lock profile", exact: true }).click();
  const id = await page.evaluate(async () => {
    const request = indexedDB.open("suite-local-profiles");
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = db.transaction("vaults").objectStore("vaults").getAll();
    const rows: any[] = await new Promise((resolve) => {
      get.onsuccess = () => resolve(get.result);
    });
    if (JSON.stringify(rows).includes("Private contact"))
      throw Error("Plaintext record leaked");
    return rows[0].id as string;
  });
  await selectValue(page, "Profile", id);
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Private contact", exact: true }),
  ).toBeVisible();
});
test("signed installation repairs assigned modules and removes dependents before dependencies", async ({
  page,
}) => {
  await workspace(page);
  // Open the modules to await real installation rather than racing the
  // background installer against an increasingly large reviewed catalog.
  for (const name of ["Contacts", "Projects"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: `New ${name.toLowerCase()}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
  }
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page
    .getByRole("heading", { name: "Contacts", level: 3, exact: true })
    .locator("..");
  await expect(
    card.getByText("Installed 1.1.0", { exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Verify and repair", exact: true })
    .click();
  await expect(
    card.getByText("Installed 1.1.0", { exact: true }),
  ).toBeVisible();
  const projectsCard = page
    .getByRole("heading", { name: "Projects", level: 3, exact: true })
    .locator("..");
  await projectsCard
    .getByRole("button", { name: "Uninstall", exact: true })
    .click();
  await expect(
    projectsCard.getByText("Not installed on this device", { exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Uninstall", exact: true }).click();
  await expect(
    card.getByText("Not installed on this device", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/platform-installation.png",
    fullPage: true,
  });
});
test("queued offline capture survives a reload and synchronizes on reconnect", async ({
  page,
  context,
}) => {
  const workspaceId = await workspace(page);
  const me = await (await page.request.get("/api/v1/me")).json();
  const submitted: { key?: string; version?: string }[] = [];
  page.on("request", (request) => {
    if (
      request
        .url()
        .includes(`/module/contacts/workspaces/${workspaceId}/records`) &&
      request.method() === "POST" &&
      request.postDataJSON()?.action === "create"
    )
      submitted.push({
        key: request.headers()["idempotency-key"],
        version: request.headers()["x-module-version"],
      });
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Offline capture");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "other");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pending changes" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pending changes" }),
  ).toBeVisible();
  const pending = await page.evaluate(
    async ({ userId, workspaceId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("suite-offline-v1");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        const state = await new Promise<{
          journal: {
            call: {
              moduleVersion?: string;
              key?: string;
              input: { data?: { name?: string } };
            };
          }[];
        }>((resolve, reject) => {
          const get = db
            .transaction("records")
            .objectStore("records")
            .get(`${userId}/${workspaceId}/module-state`);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        });
        return state.journal.find(
          (entry) => entry.call.input.data?.name === "Offline capture",
        )!.call;
      } finally {
        db.close();
      }
    },
    { userId: me.user.id, workspaceId },
  );
  expect(pending.moduleVersion).toBe("1.1.0");
  await context.setOffline(false);
  await expect(
    page.getByRole("cell", { name: "Offline capture", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  expect(submitted.length).toBeGreaterThan(0);
  expect(
    submitted.every(
      (request) =>
        request.version === pending.moduleVersion &&
        request.key === pending.key,
    ),
  ).toBe(true);
});

test("high contrast keeps the principal text pairs above 7:1 in every archetype", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await selectValue(page, "Theme", "high-contrast");
  const archetypes = [
    "modern-dark",
    "chromatic-playful",
    "executive-serious",
    "classic-retro",
    "neumorphic-soft",
    "minimal-clean",
    "industrial-technical",
    "glassmorphic-luxe",
    "editorial-paper",
    "material-expressive",
  ];
  for (const archetype of archetypes) {
    await selectValue(page, "Design archetype", archetype);
    await expect(page.locator("html")).toHaveAttribute(
      "data-archetype",
      archetype,
    );
    const ratios = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const luminance = (name: string) => {
        const hex = root.getPropertyValue(name).trim().replace("#", "");
        const expanded =
          hex.length === 3
            ? hex
                .split("")
                .map((v) => v + v)
                .join("")
            : hex;
        const c = [0, 2, 4]
          .map((i) => parseInt(expanded.slice(i, i + 2), 16) / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      };
      return [
        ["--text", "--surface"],
        ["--muted", "--surface"],
        ["--accent-ink", "--accent"],
        ["--rail-icon", "--shell"],
      ].map(([fg, bg]) => {
        const a = luminance(fg),
          b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(7);
  }
  await page.screenshot({
    path: "test-results/platform-high-contrast.png",
    fullPage: true,
  });
});

test("a resumed edit keeps its record identity across a reload", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Resumable contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "other");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Resumable contact", exact: true }),
    })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Phone", { exact: true }).fill("555-0200");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const r = indexedDB.open("suite-offline-v1");
        const db: IDBDatabase = await new Promise((resolve) => {
          r.onsuccess = () => resolve(r.result);
        });
        const req = db.transaction("records").objectStore("records").getAll();
        return new Promise<boolean>((resolve) => {
          req.onsuccess = () =>
            resolve(
              req.result.some(
                (s) => s?.drafts?.["contacts/contacts"]?.phone === "555-0200",
              ),
            );
        });
      }),
    )
    .toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Resume saved draft", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit record", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(
    "555-0200",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Resumable contact", exact: true }),
  ).toHaveCount(1);
});

test("an uncertain create response retries the same operation instead of duplicating the record", async ({
  page,
}) => {
  await workspace(page);
  const keys: string[] = [];
  let interrupted = false;
  await page.route(
    "**/api/v1/module/contacts/workspaces/*/records",
    async (route) => {
      if (route.request().postDataJSON()?.action !== "create")
        return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      if (!interrupted) {
        interrupted = true;
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        return route.fulfill({
          status: 503,
          json: {
            code: "UNCERTAIN",
            message: "The connection ended before confirmation.",
          },
        });
      }
      return route.continue();
    },
  );
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("One confirmed contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "other");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByText(
      "The server response is uncertain. Retry this same change or resolve its outcome before editing or closing it.",
    ),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "One confirmed contact", exact: true }),
  ).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("assigned modules install in the background before they are opened", async ({
  page,
}) => {
  // Establish this company's actual assignments before entering it. Unrelated
  // signed fixtures from earlier runs must not change this acceptance workload.
  const modules = ["contacts", "inventory", "orders", "projects"];
  const workspaceId = await workspace(page, modules);
  const bootstrap = await (
    await page.request.get(`/api/v1/workspaces/${workspaceId}/bootstrap`)
  ).json();
  const assigned = bootstrap.modules
    .filter(
      (m: { assigned: boolean; entitled: boolean; state: string }) =>
        m.assigned && m.entitled && m.state === "enabled",
    )
    .map((m: { moduleId: string }) => m.moduleId)
    .sort();
  expect(assigned).toEqual(modules);
  await expect
    .poll(
      async () => {
        const deviceId = await page.evaluate(() =>
          localStorage.getItem("suite-device"),
        );
        const state = await (
          await page.request.get(`/api/v1/workspaces/${workspaceId}/platform`)
        ).json();
        return state.installations
          .filter(
            (i: { device_id: string; state: string; module_id: string }) =>
              i.device_id === deviceId && i.state === "installed",
          )
          .map((i: { module_id: string }) => i.module_id)
          .sort();
      },
      { timeout: 20000 },
    )
    .toEqual(assigned);
});

test("physical count shows variance and commits the checked stock snapshot", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const name = `Count acceptance ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("SKU", { exact: true }).fill(randomUUID().slice(0, 8));
  await page.getByLabel("Product name", { exact: true }).fill(name);
  await page.getByLabel("Unit price (EUR)", { exact: true }).fill("1.00");
  await page.getByRole("button", { name: "Save product", exact: true }).click();
  await page
    .getByRole("button", { name: `Change stock for ${name}`, exact: true })
    .click();
  await selectValue(page, "Movement type", "count");
  await page.getByLabel("Units physically counted", { exact: true }).fill("12");
  await page.getByLabel("Reason", { exact: true }).fill("Physical shelf count");
  await expect(
    page.getByRole("status").filter({ hasText: "Variance: 12 units" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/verification/modular-platform/stock-count.png",
    fullPage: true,
  });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/operations/count") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save stock change", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByRole("dialog", { name: "Update stock", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText(
    "12",
  );
});

test("contacts retain multiple structured addresses through generated SDK forms", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Address customer");
  await selectValue(page, "Kind", "organization");
  await selectValue(page, "Relationship", "customer");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.getByRole("tab", { name: "Addresses", exact: true }).click();
  await page
    .getByRole("button", { name: "New addresses", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Contact Id", exact: true }).click();
  await page
    .getByRole("option", { name: "Address customer", exact: true })
    .click();
  await selectValue(page, "Kind", "billing");
  await page.getByLabel("Street", { exact: true }).fill("10 Market Street");
  await page.getByLabel("City", { exact: true }).fill("Madrid");
  await page.getByLabel("Country", { exact: true }).fill("Spain");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "10 Market Street" }),
  ).toContainText("Address customer");
  await expect(
    page.getByRole("row").filter({ hasText: "10 Market Street" }),
  ).toContainText("Madrid");
});

test("notification cards approve access and show the server decision", async ({
  page,
}) => {
  const workspaceId = await workspace(page);
  await import("dotenv/config");
  const { connectDatabase, inWorkspace } =
    await import("../../composition/src/server/product");
  const db = connectDatabase();
  try {
    await inWorkspace(db, workspaceId, async (tx) => {
      const member = await tx
        .selectFrom("suite.memberships")
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirstOrThrow();
      const requestId = randomUUID(),
        eventId = randomUUID();
      await tx
        .insertInto("suite.access_requests")
        .values({
          id: requestId,
          workspace_id: workspaceId,
          membership_id: member.id,
          module_id: "projects",
          reason: "Inbox approval acceptance",
          state: "pending",
        })
        .execute();
      await tx
        .insertInto("suite.outbox")
        .values({
          id: eventId,
          workspace_id: workspaceId,
          actor_id: member.user_id,
          event_type: "access.requested",
          payload: { recordId: requestId },
          completed_at: new Date(),
          locked_until: null,
          claim_token: null,
          failed_at: null,
          last_error: null,
        })
        .execute();
      await tx
        .insertInto("suite.notifications")
        .values({
          id: randomUUID(),
          workspace_id: workspaceId,
          user_id: member.user_id,
          event_id: eventId,
          title: "Module access requested",
          message: "Review the request.",
          read_at: null,
        })
        .execute();
    });
  } finally {
    await db.destroy();
  }
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve access", exact: true })
    .click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve access", exact: true }),
  ).toHaveCount(0);
});
