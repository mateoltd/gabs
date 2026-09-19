import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import { queuedCommandsJourney } from "../support/queued-commands-journey";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
test.use({ actionTimeout: 15000 });
for (const workspaceOnly of [false, true])
  test(
    workspaceOnly
      ? "workspace synchronization without an open module view"
      : "queued commands survive offline reload, lost replies and permission revocation",
    async ({ page, context }) => {
      test.setTimeout(120000);
      const pool = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      });
      const api = await request.newContext({
        baseURL: "http://localhost:4310",
      });
      const dispatched: string[] = [];
      try {
        expect(
          (
            await api.post("/auth/development", {
              headers: { origin: "http://localhost:4300" },
              data: { email: "owner@demo.local" },
            })
          ).ok(),
        ).toBe(true);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto("/");
        await selectValue(
          page,
          "Local demonstration account",
          "owner@demo.local",
        );
        await page
          .getByRole("button", { name: "Open workspace", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Switch workspace", exact: true }),
        ).toBeVisible();
        await queuedCommandsJourney({
          workspaceOnly,
          page,
          api,
          pool,
          kind: "web",
          offline: (value) => context.setOffline(value),
          restartOffline: async () => {
            await page.reload();
            return page;
          },
          reconnect: async () => {
            await context.setOffline(false);
          },
          loseReply: async (key) => {
            let lost = false;
            await page.route("**/operations/capture", async (route) => {
              const req = route.request();
              if (req.method() !== "POST") return route.continue();
              dispatched.push(req.headers()["idempotency-key"]);
              const response = await route.fetch();
              if (
                req.headers()["idempotency-key"] === key &&
                !lost &&
                response.ok()
              ) {
                lost = true;
                return route.abort("connectionreset");
              }
              return route.fulfill({ response });
            });
          },
          dispatched: async () => dispatched,
          narrow: () => page.setViewportSize({ width: 390, height: 844 }),
          wide: () => page.setViewportSize({ width: 1440, height: 1000 }),
          storage: (page, scope) =>
            page.evaluate(async (scope) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const r = indexedDB.open("suite-offline-v1");
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
              try {
                return await new Promise<ModuleStorage>((resolve, reject) => {
                  const r = db
                    .transaction("records")
                    .objectStore("records")
                    .get(`${scope.userId}/${scope.workspaceId}/module-state`);
                  r.onsuccess = () => resolve(r.result);
                  r.onerror = () => reject(r.error);
                });
              } finally {
                db.close();
              }
            }, scope),
        });
      } finally {
        await context.setOffline(false);
        await api.dispose();
        await pool.end();
      }
    },
  );

for (const resourcePreview of [false, true])
  test(`development preview captures provisional ${resourcePreview ? "resources" : "commands"} through the public SDK and rechecks simulated permissions`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const { startModuleDev } =
      await import("../../tooling/modules/module-dev/server");
    const { resolve } = await import("node:path");
    const server = await startModuleDev(
      resolve(
        resourcePreview
          ? "tests/fixtures/queued-resources"
          : "tests/fixtures/queued-notes",
      ),
      0,
    );
    try {
      await page.goto(server.origin);
      await expect(page.locator("#build-status")).toHaveText(
        "Ready. Each source or fixture change starts a fresh simulation.",
        { timeout: 45000 },
      );
      const region = page.getByRole("region", {
        name: "Custom notes workspace",
        exact: true,
      });
      await page.getByLabel("Server online", { exact: true }).uncheck();
      await region
        .getByLabel("Note name", { exact: true })
        .fill("Preview queued note");
      await region
        .getByRole("button", { name: "Save pending note", exact: true })
        .click();
      await expect(region.getByRole("status")).toContainText(
        "Saved provisionally:",
      );
      await expect(page.locator("#records")).not.toContainText(
        "Preview queued note",
      );
      await page.getByLabel("Server online", { exact: true }).check();
      await page
        .getByRole("button", { name: "Synchronize pending work", exact: true })
        .click();
      await expect(page.locator("#records")).toContainText(
        "Preview queued note",
      );
      await page
        .getByRole("button", { name: "Synchronize pending work", exact: true })
        .click();
      if (resourcePreview) {
        const record = page
          .getByRole("region", { name: "notes records", exact: true })
          .getByRole("row")
          .filter({ hasText: "Preview queued note" });
        const id = (await record.getByRole("cell").first().innerText()).trim();
        await region
          .getByLabel("Accepted record identity", { exact: true })
          .fill(id);
        const loadBase = async () => {
          await region
            .getByRole("button", { name: "Load accepted record", exact: true })
            .click();
          await expect(region).toContainText(
            "Loaded server version 1: Preview queued note",
          );
        };
        for (const name of ["First simulated edit", "Second simulated edit"]) {
          await loadBase();
          await page.getByLabel("Server online", { exact: true }).uncheck();
          await region.getByLabel("Note name", { exact: true }).fill(name);
          await region
            .getByRole("button", { name: "Save pending update", exact: true })
            .click();
          await expect(
            region.getByLabel("Note name", { exact: true }),
          ).toHaveValue("");
          await page.getByLabel("Server online", { exact: true }).check();
        }
        await loadBase();
        await page.getByLabel("Server online", { exact: true }).uncheck();
        await region
          .getByRole("button", { name: "Save pending archive", exact: true })
          .click();
        await expect(
          region.getByText("Loaded server version 1: Preview queued note", {
            exact: true,
          }),
        ).toHaveCount(0);
        await region
          .getByLabel("Note name", { exact: true })
          .fill("Independent simulated record");
        await region
          .getByRole("button", { name: "Save pending note", exact: true })
          .click();
        await expect(
          region.getByLabel("Note name", { exact: true }),
        ).toHaveValue("");
        await page.getByLabel("Server online", { exact: true }).check();
        await page
          .getByRole("button", {
            name: "Synchronize pending work",
            exact: true,
          })
          .click();
        const journal = page.getByRole("region", {
          name: "Operation journal data",
          exact: true,
        });
        await expect(
          journal.getByRole("cell", { name: "accepted", exact: true }),
        ).toHaveCount(3);
        await expect(
          journal.getByRole("cell", { name: "conflict", exact: true }),
        ).toHaveCount(1);
        await expect(
          journal.getByRole("cell", { name: "pending", exact: true }),
        ).toHaveCount(1);
        await expect(
          page.getByRole("cell", { name: "First simulated edit", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("cell", {
            name: "Independent simulated record",
            exact: true,
          }),
        ).toBeVisible();
      }
      await page.getByText("Permission simulator", { exact: true }).click();
      await page
        .getByLabel(
          resourcePreview ? "custom-notes.notes.write" : "custom-notes.capture",
          { exact: true },
        )
        .uncheck();
      await expect(
        region.getByRole("button", { name: "Save pending note", exact: true }),
      ).toBeDisabled();
    } finally {
      await server.close();
    }
  });
