import "dotenv/config";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";
const password = "correct horse battery staple";

for (const mode of ["create", "unlock"] as const) {
  test(`leaving the profile screen during ${mode} closes the late decrypted session`, async ({
    page,
  }) => {
    await page.goto("/");
    const local = () =>
      page
        .getByRole("button", { name: "Use a local profile", exact: true })
        .click();
    await local();
    if (mode === "unlock") {
      await page
        .getByLabel("Profile name", { exact: true })
        .fill("Delayed profile");
      await page.getByLabel("Passphrase", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Create profile", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Lock profile", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Profile", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Delayed profile", exact: true })
        .click();
    } else {
      await page
        .getByLabel("Profile name", { exact: true })
        .fill("Delayed profile");
    }
    // Hold the actual key derivation and count the session's channel lifetime.
    // No fake vault, passphrase, or session replaces the production path.
    await page.evaluate(() => {
      const state = {
        entered: false,
        finished: false,
        opened: 0,
        closed: 0,
        release: () => {},
      };
      const held = new Promise<void>((resolve) => {
        state.release = resolve;
      });
      const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
      crypto.subtle.deriveKey = async (...args: Parameters<typeof derive>) => {
        state.entered = true;
        const key = await derive(...args);
        await held;
        state.finished = true;
        return key;
      };
      const Original = BroadcastChannel;
      window.BroadcastChannel = class extends Original {
        private disposed = false;
        constructor(name: string) {
          super(name);
          if (name === "suite-local-profiles") state.opened++;
        }
        close() {
          if (!this.disposed && this.name === "suite-local-profiles")
            state.closed++;
          this.disposed = true;
          super.close();
        }
      };
      (window as unknown as { delayedProfile: typeof state }).delayedProfile =
        state;
    });
    await page.getByLabel("Passphrase", { exact: true }).fill(password);
    await page
      .getByRole("button", {
        name: mode === "create" ? "Create profile" : "Unlock profile",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { delayedProfile: { entered: boolean } })
              .delayedProfile.entered,
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Online workspaces", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sign in to Common", exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { delayedProfile: { release(): void } }
      ).delayedProfile.release(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = (
            window as unknown as {
              delayedProfile: {
                finished: boolean;
                opened: number;
                closed: number;
              };
            }
          ).delayedProfile;
          return (
            state.finished && state.opened > 0 && state.closed === state.opened
          );
        }),
      )
      .toBe(true);
    await expect(
      page.getByRole("heading", { name: "Sign in to Common", exact: true }),
    ).toBeVisible();
  });
}

async function vaultHelper(context: import("@playwright/test").BrowserContext) {
  const helper = await build({
    entryPoints: ["packages/client/src/identity/local-vault.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
  });
  await context.route("**/profile-vault.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: helper.outputFiles[0].text,
    }),
  );
}

test("a delayed unlock cannot replace a profile restored in the meantime", async ({
  page,
  context,
}) => {
  await vaultHelper(context);
  await page.goto("/");
  const firstId = await page.evaluate(async (password) => {
    const path = "/profile-vault.mjs";
    const vaults = (await import(
      path
    )) as typeof import("../../packages/client/src/identity/local-vault");
    const first = await vaults.createVault("Delayed profile", password, {
      records: {},
    });
    const removed = await vaults.createVault("Restored profile", password, {
      records: {},
    });
    await vaults.removeLocalProfile(removed.vault.id);
    return first.vault.id;
  }, password);
  await page
    .getByRole("button", { name: "Use a local profile", exact: true })
    .click();
  await selectValue(page, "Profile", firstId);
  await page.evaluate(() => {
    const state = { entered: false, release: () => {} };
    const held = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
    crypto.subtle.deriveKey = async (...args: Parameters<typeof derive>) => {
      const first = !state.entered;
      state.entered = true;
      const key = await derive(...args);
      if (first) await held;
      return key;
    };
    (window as unknown as { competingUnlock: typeof state }).competingUnlock =
      state;
  });
  await page.getByLabel("Passphrase", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { competingUnlock: { entered: boolean } })
            .competingUnlock.entered,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Removed profiles", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Removed profiles",
    exact: true,
  });
  await dialog
    .getByLabel("Original passphrase", { exact: true })
    .fill(password);
  await dialog
    .getByRole("button", { name: "Restore and unlock profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Restored profile", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { competingUnlock: { release(): void } }
    ).competingUnlock.release(),
  );
  await expect(page.getByRole("alert")).toContainText(
    "The profile changed or was locked",
  );
  await expect(
    page.getByRole("heading", { name: "Restored profile", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lock profile", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Local profiles", exact: true }),
  ).toBeVisible();
});

test("profile removal retains encrypted work, locks another tab and restores only with the original passphrase", async ({
  page,
  context,
}) => {
  await vaultHelper(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Use a local profile", exact: true })
    .click();
  await page
    .getByLabel("Profile name", { exact: true })
    .fill("Recovery profile");
  await page.getByLabel("Passphrase", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create profile", exact: true })
    .click();
  await page.getByRole("button", { name: "Lock profile", exact: true }).click();
  // Populate retained recovery categories through the real encrypted vault API.
  const fixture = await page.evaluate(async (password) => {
    const path = "/profile-vault.mjs";
    const vaults = (await import(
      path
    )) as typeof import("../../packages/client/src/identity/local-vault");
    const profile = (await vaults.listLocalProfiles()).find(
      (p) => p.name === "Recovery profile",
    )!;
    const { vault, key, data } = await vaults.unlockVault<
      Record<string, unknown>
    >(profile.id, password);
    data.attempts = {
      original: {
        moduleId: "retired-module",
        moduleVersion: "1.0.0",
        title: "Retained request",
        call: {
          moduleId: "retired-module",
          action: "operation",
          operation: "capture",
          input: { text: "Private unfinished input" },
          key: "original-request",
        },
        configuration: {},
        createdAt: 1,
        state: "interrupted",
      },
    };
    data.deviceRequests = {};
    await vaults.commitVault(
      vault,
      key,
      data,
      vault.revision ?? 0,
      undefined,
      () => true,
    );
    return { id: profile.id, data };
  }, password);
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "Use a local profile", exact: true })
    .click();
  await selectValue(second, "Profile", fixture.id);
  await second.getByLabel("Passphrase", { exact: true }).fill(password);
  await second
    .getByRole("button", { name: "Unlock profile", exact: true })
    .click();
  await expect(
    second.getByRole("heading", { name: "Recovery profile", exact: true }),
  ).toBeVisible();
  await selectValue(page, "Profile", fixture.id);
  await page
    .getByRole("button", { name: "Remove profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Encrypted records and unfinished work stay on this device",
  );
  await expect(
    second.getByRole("heading", { name: "Recovery profile", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Remove from this device’s profile list",
      exact: true,
    })
    .click();
  await expect(
    second.getByRole("heading", { name: "Local profiles", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: "Lock profile", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  await context.setOffline(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Open local profiles", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Removed profiles", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Removed profiles",
    exact: true,
  });
  await dialog
    .getByLabel("Original passphrase", { exact: true })
    .fill("incorrect original passphrase");
  await dialog
    .getByRole("button", { name: "Restore and unlock profile", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "could not be unlocked",
  );
  await mkdir("docs/verification/profile-removal", { recursive: true });
  await page.screenshot({
    path: "docs/verification/profile-removal/restore-wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: "docs/verification/profile-removal/restore-narrow.png",
  });
  await dialog
    .getByLabel("Original passphrase", { exact: true })
    .fill(password);
  await dialog
    .getByRole("button", { name: "Restore and unlock profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recovery profile", exact: true }),
  ).toBeVisible();
  const restored = await page.evaluate(
    async ({ id, password }) => {
      const path = "/profile-vault.mjs";
      const vaults = (await import(
        path
      )) as typeof import("../../packages/client/src/identity/local-vault");
      const result = await vaults.unlockVault<Record<string, unknown>>(
        id,
        password,
      );
      return {
        data: result.data,
        removed: await vaults.listRemovedLocalProfiles(),
      };
    },
    { id: fixture.id, password },
  );
  expect(restored.data).toEqual(fixture.data);
  expect(restored.removed).toEqual([]);
  await second.close();
});

test("removed vaults reject stale writers, wrong passwords and concurrent restoration without changing encrypted payloads", async ({
  page,
  context,
}) => {
  await vaultHelper(context);
  await page.goto("/");
  const result = await page.evaluate(async (password) => {
    const path = "/profile-vault.mjs";
    const v = (await import(
      path
    )) as typeof import("../../packages/client/src/identity/local-vault");
    const data = {
      records: { notes: [{ id: "saved", data: { text: "Private" } }] },
      attempts: { original: { state: "interrupted", input: "Captured input" } },
      deviceRequests: { effect: { state: "uncertain", id: "original-effect" } },
    };
    const { vault, key } = await v.createVault("Race recovery", password, data);
    const other = await v.createVault("Other profile", password, {
      records: {},
    });
    const code = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "accepted";
      } catch (error) {
        if ((error as Error).name === "AbortError") return "AbortError";
        return (
          (error as { code?: string; message: string }).code ??
          (error as Error).message
        );
      }
    };
    await v.removeLocalProfile(vault.id);
    const before = await v.listRemovedLocalProfiles();
    const stale = await code(() =>
      v.commitVault(vault, key, { records: {} }, 0, undefined, () => true),
    );
    const unlock = await code(() => v.unlockVault(vault.id, password));
    const wrong = await code(() =>
      v.restoreVault(vault.id, "incorrect password"),
    );
    const cancelled = new AbortController();
    cancelled.abort();
    const aborted = await code(() =>
      v.restoreVault(vault.id, password, cancelled.signal),
    );
    const results = await Promise.allSettled([
      v.restoreVault(vault.id, password),
      v.restoreVault(vault.id, password),
    ]);
    const recovered = await v.unlockVault(vault.id, password);
    const oldWriter = await code(() =>
      v.commitVault(vault, key, { records: {} }, 0, undefined, () => true),
    );
    return {
      data: recovered.data,
      sameCiphertext:
        Array.from(new Uint8Array(recovered.vault.ciphertext)).join(",") ===
        Array.from(new Uint8Array(vault.ciphertext)).join(","),
      original: data,
      stale,
      unlock,
      wrong,
      aborted,
      before,
      active: await v.listLocalProfiles(),
      other: other.vault.id,
      restored: results.map((r) => r.status),
      oldWriter,
    };
  }, password);
  expect(result.stale).toBe("PROFILE_CHANGED");
  expect(result.oldWriter).toBe("PROFILE_CHANGED");
  expect(result.unlock).toContain("Restore");
  expect(result.wrong).toContain("passphrase");
  expect(result.aborted).toBe("AbortError");
  expect(result.sameCiphertext).toBe(true);
  expect(result.restored.sort()).toEqual(["fulfilled", "rejected"]);
  expect(result.data).toEqual(result.original);
  expect(result.active).toHaveLength(2);
  expect(result.active.some((p) => p.id === result.other)).toBe(true);
  expect(result.before).toHaveLength(1);
});
