import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";

async function enable(page: Page) {
  await page.getByLabel("Device PIN", { exact: true }).fill("12567890");
  await page.getByLabel("Confirm device PIN", { exact: true }).fill("12567890");
  await page
    .getByRole("button", { name: "Enable device unlock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Update device unlock", exact: true }),
  ).toBeVisible();
}
async function lock(page: Page) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Lock profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
}
async function unlock(page: Page, pin = "12567890") {
  await page.getByLabel("Device PIN", { exact: true }).fill(pin);
  await page
    .getByRole("button", { name: "Unlock with PIN", exact: true })
    .click();
}
test("browser PIN conceals corporate work, preserves an editor and protects pending work through an offline reload", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  await f.settings();
  await enable(page);
  await page.getByLabel("New device PIN", { exact: true }).fill("87654321");
  await lock(page);
  await expect(
    page.getByRole("navigation", { name: "Main navigation", exact: true }),
  ).toHaveCount(0);
  await unlock(page, "00000000");
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await unlock(page);
  await expect(page.getByLabel("New device PIN", { exact: true })).toHaveValue(
    "87654321",
  );
  await context.setOffline(true);
  const original = await f.capture();
  await lock(page);
  await mkdir("docs/verification/browser-profile-lock", { recursive: true });
  await page.screenshot({
    path: "docs/verification/browser-profile-lock/locked-wide.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/verification/browser-profile-lock/locked-narrow.png",
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([original]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await unlock(page);
  await f.contacts();
  await expect(
    page.getByRole("row").filter({ hasText: "Policy contact" }),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([original]);
  const expiresAt = (await f.stored()).snapshot.expiresAt;
  await lock(page);
  await page.clock.install();
  await page.clock.setSystemTime(expiresAt + 1000);
  await unlock(page);
  await expect(
    page.getByText(
      "Connect to revalidate this workspace. Unsent drafts remain stored.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await f.stored()).snapshot.expiresAt).toBe(expiresAt);
  expect((await f.stored()).state.journal).toEqual([original]);
});

test("fresh online recovery adopts the new session before resuming pending writes and permits an explicit PIN reset", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  await f.settings();
  await enable(page);
  await context.setOffline(true);
  const original = await f.capture();
  await lock(page);
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Sign in online", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await f.settings();
  await expect(
    page.getByRole("button", {
      name: "Reset forgotten device PIN",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await f.stored()).state.journal.find(
          (entry) => entry.id === original.id,
        )?.state,
      { timeout: 25000 },
    )
    .toBe("accepted");
  expect(
    (await f.stored()).state.journal.find((entry) => entry.id === original.id)
      ?.call,
  ).toEqual(original.call);
  await page
    .getByRole("button", { name: "Reset forgotten device PIN", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable device unlock", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/verification/browser-profile-lock/settings-wide.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
});

test("recovery intent survives a redirect and requires a new authoritative session before unlocking", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  await f.settings();
  await enable(page);
  await context.setOffline(true);
  const original = await f.capture();
  await lock(page);
  await context.setOffline(false);
  // Exercise redirect continuity with the real development session issuer and
  // recovery endpoint. This fixture does not establish real-provider acceptance.
  await page.route("**/auth/config", (route) =>
    route.fulfill({ json: { mode: "oidc" } }),
  );
  let fresh = false;
  await page.route("**/auth/login*", async (route) => {
    if (fresh) {
      const response = await page.request.post("/auth/development", {
        data: { email: "owner@demo.local" },
      });
      expect(response.ok()).toBe(true);
    }
    await route.fulfill({ status: 302, headers: { location: "/" }, body: "" });
  });
  await page
    .getByRole("button", { name: "Sign in online", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use single sign-on", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Sign in again");
  expect((await f.stored()).state.journal).toEqual([original]);
  fresh = true;
  await page
    .getByRole("button", { name: "Sign in online", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use single sign-on", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Account menu", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await f.stored()).state.journal.find(
          (entry) => entry.id === original.id,
        )?.state,
      { timeout: 25000 },
    )
    .toBe("accepted");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("suite-browser-profile-recovery"),
    ),
  ).toBeNull();
});

test("another tab can lock an open editor while each tab must unlock independently", async ({
  page,
  context,
}) => {
  const f = await setupOfflinePolicy(page);
  await f.settings();
  await enable(page);
  await page.getByLabel("New device PIN", { exact: true }).fill("87654321");
  const second = await context.newPage();
  await second.goto("/");
  await expect(
    second.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
  await unlock(second);
  await lock(second);
  await expect(
    page.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
  await unlock(page);
  await expect(page.getByLabel("New device PIN", { exact: true })).toHaveValue(
    "87654321",
  );
  await expect(
    second.getByRole("heading", { name: "Unlock your profile", exact: true }),
  ).toBeVisible();
});

test("locking after server acceptance preserves the original request and resumes without duplicating its effect", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  await f.settings();
  await enable(page);
  await context.setOffline(true);
  const original = await f.capture();
  let release!: () => void,
    accepted = false,
    intercepted = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${f.records}`, async (route) => {
    if (
      intercepted ||
      route.request().method() !== "POST" ||
      route.request().postDataJSON()?.action !== "update"
    )
      return route.continue();
    intercepted = true;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    accepted = true;
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await context.setOffline(false);
    await expect.poll(() => accepted, { timeout: 25000 }).toBe(true);
    await lock(page);
    release();
    const uncertain = (await f.stored()).state.journal.find(
      (entry) => entry.id === original.id,
    )!;
    expect(uncertain.call).toEqual(original.call);
    expect(["accepted", "rejected"]).not.toContain(uncertain.state);
    await unlock(page);
    await expect
      .poll(
        async () =>
          (await f.stored()).state.journal.find(
            (entry) => entry.id === original.id,
          )?.state,
        { timeout: 25000 },
      )
      .toBe("accepted");
    expect((await f.stored()).state.journal).toHaveLength(1);
    const fresh = await (await page.request.get("/api/v1/me")).json();
    const result = await page.request.post(f.records, {
      headers: {
        origin: "http://localhost:4300",
        "x-csrf-token": fresh.csrfToken,
        "x-module-version": original.call.moduleVersion!,
      },
      data: { resource: "contacts", action: "list", input: {} },
    });
    expect(result.ok()).toBe(true);
    expect((await result.json()).items).toMatchObject([
      { version: 2, data: { phone: "Saved offline" } },
    ]);
  } finally {
    release();
  }
});
