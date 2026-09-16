import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { selectValue } from "./controls.helpers";

test("administration sees a partial device installation failure and its real recovery", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  expect(
    (
      await page.request.post("/api/v1/workspaces", {
        headers: {
          origin: new URL(page.url()).origin,
          "x-csrf-token": me.csrfToken,
          "idempotency-key": randomUUID(),
        },
        data: {
          id: workspaceId,
          name: "Device rollout acceptance",
          currency: "EUR",
        },
      })
    ).ok(),
  ).toBe(true);
  const report = (target: Page, phase: string, action = "install") =>
    target.waitForResponse((response) => {
      if (
        !response
          .url()
          .endsWith(`/workspaces/${workspaceId}/installation-reports`) ||
        response.request().method() !== "POST" ||
        !response.ok()
      )
        return false;
      const body = response.request().postDataJSON();
      return (
        body.moduleId === "contacts" &&
        body.phase === phase &&
        body.action === action
      );
    });
  await page.reload();
  const firstReady = report(page, "ready");
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page.locator(".module-install-card").filter({
    has: page.getByRole("heading", { name: "Contacts", exact: true }),
  });
  await expect(
    card.getByText("Installed 1.1.0", { exact: true }),
  ).toBeVisible();
  await firstReady;
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    reducedMotion: "reduce",
  });
  try {
    const second = await context.newPage();
    await second.route(
      `**/module/contacts/workspaces/${workspaceId}/artifact`,
      (route) => route.abort("failed"),
    );
    const failureReported = report(second, "failed");
    await second.goto("/");
    await second
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      second.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    await selectValue(second, "Workspace", workspaceId);
    await second.getByRole("link", { name: "Modules", exact: true }).click();
    const otherCard = second.locator(".module-install-card").filter({
      has: second.getByRole("heading", { name: "Contacts", exact: true }),
    });
    await expect(
      otherCard.getByText("Installation pending.", { exact: false }),
    ).toBeVisible();
    // Local pending state appears before the failure report is acknowledged.
    // Open the fleet only after the server has the observation being asserted.
    await failureReported;
    await card
      .getByRole("button", { name: "View devices", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Devices using Contacts",
      exact: true,
    });
    await expect(
      dialog.getByText(
        "1 of 2 known devices have a server-accepted release. 1 reported a failed module change.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("Ready reported", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Installation failed", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Not confirmed", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/module-fleet", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-fleet/partial-failure.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog
        .locator(".table-wrap")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/module-fleet/narrow.png",
    });
    await second.unroute(
      `**/module/contacts/workspaces/${workspaceId}/artifact`,
    );
    const recoveredReport = report(second, "ready");
    await otherCard
      .getByRole("button", { name: "Resume installation", exact: true })
      .click();
    await expect(
      otherCard.getByText("Installed 1.1.0", { exact: true }),
    ).toBeVisible();
    await recoveredReport;
    await dialog
      .getByRole("button", { name: "Refresh devices", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "2 of 2 known devices have a server-accepted release. 0 reported a failed module change.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("Ready reported", { exact: true }),
    ).toHaveCount(2);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({
      path: "docs/verification/module-fleet/recovered.png",
    });
    const removalFailedReport = report(second, "failed", "uninstall");
    await otherCard
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect(
      second.getByRole("alert").filter({ hasText: "Uninstall projects" }),
    ).toBeVisible();
    await removalFailedReport;
    await dialog
      .getByRole("button", { name: "Refresh devices", exact: true })
      .click();
    await expect(
      dialog.getByText("Removal failed", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "2 of 2 known devices have a server-accepted release. 1 reported a failed module change.",
        { exact: true },
      ),
    ).toBeVisible();
    await mkdir("docs/verification/report-recovery", { recursive: true });
    await page.screenshot({
      path: "docs/verification/report-recovery/removal-failure.png",
    });
    const projects = second.locator(".module-install-card").filter({
      has: second.getByRole("heading", { name: "Projects", exact: true }),
    });
    await projects
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect(
      projects.getByText("Not installed on this device", { exact: true }),
    ).toBeVisible();
    const removedReport = report(second, "removed", "uninstall");
    await otherCard
      .getByRole("button", { name: "Uninstall", exact: true })
      .click();
    await expect(
      otherCard.getByText("Not installed on this device", { exact: true }),
    ).toBeVisible();
    await removedReport;
    await dialog
      .getByRole("button", { name: "Refresh devices", exact: true })
      .click();
    await expect(
      dialog.getByText("Removal reported", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "1 of 2 known devices have a server-accepted release. 0 reported a failed module change.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/verification/report-recovery/removed.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/verification/report-recovery/removed-narrow.png",
    });
    expect(
      await dialog
        .locator(".table-wrap")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  } finally {
    await context.close();
  }
});
