import { launchIntegrityProbe } from "../support/integrity-process";
import {
  holdServerReply,
  type ReplyGate,
} from "../support/corporate-portability/server-reply";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import {
  nativePortabilityDevice,
  portabilityStorage,
} from "../support/corporate-portability/devices";
import { selectValue } from "../e2e/controls.helpers";

for (const scenario of [
  "offline",
  "accepted",
  "audit-repair",
  "diagnostic-retry",
] as const)
  test(`runtime lockdown preserves ${scenario} work and a draft through repair and fresh sign-in`, async () => {
    test.setTimeout(150000);
    const boundary = scenario === "offline" ? "offline" : "accepted";
    const directory = await mkdtemp(resolve(tmpdir(), "suite-integrity-work-"));
    const dist = resolve(directory, "dist"),
      profile = resolve(directory, "profile");
    const database = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    let device: Awaited<ReturnType<typeof nativePortabilityDevice>> | undefined;
    let reply: ReplyGate | undefined;
    try {
      await cp(resolve("apps/desktop/dist"), dist, { recursive: true });
      device = await nativePortabilityDevice(profile, {
        mainEntry: resolve(dist, "main.cjs"),
      });
      let page = device.page;
      const scope = await page.evaluate(async (workspaceId) => {
        const created = await window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id: workspaceId,
            name: "Integrity recovery",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        });
        if (created.status !== 200) throw Error("Workspace creation failed");
        const me = await window.suiteDesktop!.execute({ operation: "me" });
        return {
          userId: (me.body as { user: { id: string } }).user.id,
          workspaceId,
        };
      }, randomUUID());
      const settings = () =>
        page
          .getByRole("navigation", { name: "Preferences", exact: true })
          .getByRole("link", { name: "Settings", exact: true })
          .click();
      const contacts = () =>
        page
          .getByRole("navigation", { name: "Main navigation", exact: true })
          .getByRole("link", { name: "Contacts", exact: true })
          .click();
      await page.reload();
      await selectValue(page, "Workspace", scope.workspaceId);
      await settings();
      await page
        .getByRole("button", { name: "Enable on this device", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Disable offline storage",
          exact: true,
        }),
      ).toBeVisible();
      await contacts();
      await expect(
        page.getByRole("button", { name: "New contacts", exact: true }),
      ).toBeEnabled();
      await device.offline(true);
      const fill = async (name: string) => {
        await page
          .getByRole("button", { name: "New contacts", exact: true })
          .click();
        await page.getByLabel("Name", { exact: true }).fill(name);
        await selectValue(page, "Kind", "person");
        await selectValue(page, "Relationship", "customer");
      };
      await fill("Queued before integrity lockdown");
      await page
        .getByRole("button", { name: "Save pending change", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await fill("Draft before integrity lockdown");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      const before = await portabilityStorage(page, scope);
      expect(before.journal).toHaveLength(1);
      const originalRequest = before.journal[0];
      expect(originalRequest.state).toBe("pending");
      expect(Object.values(before.drafts)).toContainEqual(
        expect.objectContaining({ name: "Draft before integrity lockdown" }),
      );
      if (boundary === "accepted") {
        reply = await holdServerReply(
          page,
          `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
          device.app,
          { method: "POST", requestId: originalRequest.id },
        );
        await device.offline(false);
        await reply.arrived();
        expect(
          (
            await database.query(
              "select id from suite.module_records where workspace_id=$1 and module_id='contacts'",
              [scope.workspaceId],
            )
          ).rows,
        ).toHaveLength(1);
        expect(
          (await portabilityStorage(page, scope)).journal[0].state,
        ).not.toBe("accepted");
      }
      const asset = resolve(dist, "preload.cjs"),
        bytes = await readFile(asset);
      await writeFile(
        asset,
        Buffer.concat([bytes, Buffer.from("\n// damaged installed asset\n")]),
      );
      const child = device.app.process();
      await device.app.evaluate(({ powerMonitor }) => {
        powerMonitor.emit("resume");
      });
      await expect.poll(() => child.exitCode, { timeout: 25000 }).toBe(1);
      await device.close();
      const state = JSON.parse(
        await readFile(resolve(profile, "integrity/lockdown.json"), "utf8"),
      );
      expect(state.failure).toEqual({
        code: "changed-asset",
        asset: "preload.cjs",
      });
      expect(
        (
          await database.query(
            "select id from suite.module_records where workspace_id=$1 and module_id='contacts'",
            [scope.workspaceId],
          )
        ).rows,
      ).toHaveLength(boundary === "accepted" ? 1 : 0);
      await writeFile(asset, bytes);
      if (scenario === "audit-repair") {
        const corrupt = "original unreadable audit";
        await writeFile(resolve(profile, "integrity/lockdown.json"), corrupt);
        const repair = await launchIntegrityProbe(
          resolve(dist, "main.cjs"),
          profile,
          ["--repair-integrity"],
        );
        expect(repair.code, repair.output).toBe(0);
        const retained = (await readdir(profile)).find((name) =>
          name.startsWith("integrity-retained-"),
        );
        expect(retained).toBeTruthy();
        expect(
          await readFile(resolve(profile, retained!, "lockdown.json"), "utf8"),
        ).toBe(corrupt);
      }
      const restart = (holdDiagnostics = false) =>
        nativePortabilityDevice(profile, {
          reuse: true,
          beforeSignIn: async (app) => {
            await app.evaluate((_electron, holdDiagnostics) => {
              const host = globalThis as typeof globalThis & {
                holdIntegrityWrites?: boolean;
              };
              const fetch = globalThis.fetch;
              host.holdIntegrityWrites = true;
              globalThis.fetch = async (...args) => {
                if (
                  host.holdIntegrityWrites &&
                  String(args[0]).includes("/api/v1/module/") &&
                  args[1]?.method === "POST"
                )
                  throw new TypeError("fetch failed", {
                    cause: { code: "ECONNREFUSED" },
                  });
                const response = await fetch(...args);
                if (
                  holdDiagnostics &&
                  String(args[0]).endsWith("/integrity-reports") &&
                  args[1]?.method === "POST" &&
                  response.ok
                )
                  return new Promise<Response>(() => {});
                return response;
              };
            }, holdDiagnostics);
          },
        });
      device = await restart(scenario === "diagnostic-retry");
      page = device.page;
      await selectValue(page, "Workspace", scope.workspaceId);
      if (scenario === "diagnostic-retry") {
        await expect
          .poll(
            async () =>
              (
                await database.query(
                  "select id from suite.integrity_reports where workspace_id=$1",
                  [scope.workspaceId],
                )
              ).rows.length,
          )
          .toBe(1);
        await device.close();
        device = await restart();
        page = device.page;
        await selectValue(page, "Workspace", scope.workspaceId);
      }
      await expect
        .poll(
          async () =>
            (
              await database.query(
                "select id from suite.integrity_reports where workspace_id=$1",
                [scope.workspaceId],
              )
            ).rows.length,
        )
        .toBe(scenario === "audit-repair" ? 1 : 2);
      const diagnostics = await database.query(
        "select payload from suite.integrity_reports where workspace_id=$1 order by event",
        [scope.workspaceId],
      );
      expect(
        diagnostics.rows.every(
          (row) =>
            row.payload.accountId === scope.userId &&
            row.payload.incidentId === state.id,
        ),
      ).toBe(true);
      expect(
        (
          await database.query(
            "select id from suite.audit where workspace_id=$1 and action like 'desktop.integrity.%'",
            [scope.workspaceId],
          )
        ).rows,
      ).toHaveLength(scenario === "audit-repair" ? 1 : 2);
      const recovered = await portabilityStorage(page, scope);
      expect(recovered.journal).toHaveLength(1);
      expect(recovered.journal[0]).toMatchObject({
        id: originalRequest.id,
        call: originalRequest.call,
      });
      expect(recovered.journal[0].state).not.toBe("accepted");
      expect(recovered.drafts).toEqual(before.drafts);
      expect(
        (
          await database.query(
            "select id from suite.module_records where workspace_id=$1 and module_id='contacts'",
            [scope.workspaceId],
          )
        ).rows,
      ).toHaveLength(boundary === "accepted" ? 1 : 0);
      const events = await readdir(resolve(profile, "integrity"));
      expect(
        events.filter((name) => name.endsWith(".locked.json")),
      ).toHaveLength(1);
      expect(
        events.filter((name) => name.endsWith(".recovered.json")),
      ).toHaveLength(1);
      expect(events).not.toContain("lockdown.json");
      await settings();
      await page
        .getByRole("button", { name: /Saved records and drafts \(2\)/ })
        .click();
      await page.getByText("View saved draft", { exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "Records and drafts", exact: true }),
      ).toContainText("Draft before integrity lockdown");
      expect(
        (
          await new AxeBuilder({ page })
            .setLegacyMode(true)
            .include('[role="dialog"]')
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      const evidence =
        scenario === "diagnostic-retry"
          ? "integrity-delivery"
          : scenario === "audit-repair"
            ? "integrity-support"
            : "integrity-runtime";
      await mkdir(`docs/verification/${evidence}`, { recursive: true });
      await page.screenshot({
        path: `docs/verification/${evidence}/recovered-${boundary}.png`,
        animations: "disabled",
      });
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/verification/${evidence}/recovered-${boundary}-narrow.png`,
        animations: "disabled",
      });
      await page.setViewportSize(viewport);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await device.app.evaluate(() => {
        (
          globalThis as typeof globalThis & { holdIntegrityWrites?: boolean }
        ).holdIntegrityWrites = false;
      });
      await contacts();
      await page.reload();
      await expect(
        page.getByRole("cell", {
          name: "Queued before integrity lockdown",
          exact: true,
        }),
      ).toBeVisible({ timeout: 30000 });
      await expect
        .poll(
          async () =>
            (
              await database.query(
                "select data from suite.module_records where workspace_id=$1 and module_id='contacts'",
                [scope.workspaceId],
              )
            ).rows,
        )
        .toEqual([
          {
            data: expect.objectContaining({
              name: "Queued before integrity lockdown",
              kind: "person",
              relationship: "customer",
            }),
          },
        ]);
      const final = await portabilityStorage(page, scope);
      expect(
        final.journal.find((entry) => entry.id === originalRequest.id)?.state,
      ).toBe("accepted");
      expect(final.drafts).toEqual(before.drafts);
      expect(
        (
          await database.query(
            "select action from suite.audit where workspace_id=$1 and action=$2",
            [
              scope.workspaceId,
              `${originalRequest.call.moduleId}.${originalRequest.call.resource}.create`,
            ],
          )
        ).rows,
      ).toHaveLength(1);
      await page.reload();
      expect(
        (
          await database.query(
            "select id from suite.module_records where workspace_id=$1 and module_id='contacts'",
            [scope.workspaceId],
          )
        ).rows,
      ).toHaveLength(1);
      if (scenario === "diagnostic-retry") {
        await page
          .getByRole("link", { name: "Audit history", exact: true })
          .click();
        await expect(
          page.getByText("desktop.integrity.locked.reported", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("desktop.integrity.recovered.reported", {
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: "docs/verification/integrity-delivery/audit.png",
          animations: "disabled",
        });
      }
    } finally {
      await reply?.dispose();
      await device?.close();
      await database.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
