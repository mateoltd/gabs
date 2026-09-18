import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import {
  directRecoveryJourney,
  type CapturedWrite,
} from "../support/direct-recovery-journey";

test("direct edits and archives retain uncertain identities through denial and recover authoritative outcomes", async ({
  page,
}) => {
  test.setTimeout(180000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  const writes: CapturedWrite[] = [];
  let next:
    | { action: string; commit: boolean; resolve(call: CapturedWrite): void }
    | undefined;
  let before: { action: string; run(): Promise<void> } | undefined;
  await page.route(
    "**/api/v1/module/contacts/workspaces/**/records",
    async (route) => {
      const req = route.request();
      const body = req.postDataJSON() as CapturedWrite["body"];
      if (!["create", "update", "archive"].includes(body.action))
        return route.continue();
      const call = {
        key: req.headers()["idempotency-key"],
        version: req.headers()["x-module-version"],
        body,
      };
      writes.push(call);
      if (before?.action === body.action) {
        const hook = before;
        before = undefined;
        await hook.run();
      }
      if (next?.action !== body.action) return route.continue();
      const lost = next;
      next = undefined;
      if (lost.commit) {
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
      }
      await route.abort("connectionreset");
      lost.resolve(call);
    },
  );
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
    await selectValue(page, "Local demonstration account", "owner@demo.local");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    await directRecoveryJourney({
      page,
      api,
      pool,
      kind: "web",
      loseNext: async (action, commit) => {
        const captured = new Promise<CapturedWrite>((resolve) => {
          next = { action, commit, resolve };
        });
        return () => captured;
      },
      beforeNext: async (action, run) => {
        const done = new Promise<void>((resolve, reject) => {
          before = {
            action,
            run: async () => {
              try {
                await run();
                resolve();
              } catch (error) {
                reject(error);
                throw error;
              }
            },
          };
        });
        return () => done;
      },
      writes: async () => writes,
      wide: () => page.setViewportSize({ width: 1440, height: 1000 }),
      narrow: () => page.setViewportSize({ width: 390, height: 844 }),
    });
  } finally {
    await api.dispose();
    await pool.end();
  }
});
