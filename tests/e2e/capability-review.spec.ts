import { test, expect } from "@playwright/test";
import { operationPath } from "../../packages/contracts/src";
import {
  capabilityReviewJourney,
  createReviewWorkspace,
  type ReviewTransport,
} from "../support/capability-review-journey";
test("administrators inspect exact releases and saved permission sources in module review and the central matrix", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const send: ReviewTransport = async (request) => {
    const op = operationPath(request);
    const response = await page.request.fetch(op.path, {
      method: op.method,
      headers: {
        origin: new URL(page.url()).origin,
        "x-csrf-token": me.csrfToken,
        ...(request.idempotencyKey
          ? { "idempotency-key": request.idempotencyKey }
          : {}),
      },
      ...(request.body ? { data: request.body } : {}),
    });
    return { status: response.status(), body: await response.json() };
  };
  await capabilityReviewJourney(page, await createReviewWorkspace(send), send);
});

test("capability review distinguishes leased effects, online-only actions and disabled corporate offline access", async ({
  page,
  context,
}) => {
  const { randomUUID } = await import("node:crypto");
  const { Pool } = await import("pg");
  const { mkdir } = await import("node:fs/promises");
  const { publishExecutableFixture } =
    await import("../support/executable-fixture");
  const { assignHostFixture } =
    await import("../support/host-capability-journey");
  const { selectValue } = await import("./controls.helpers");
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const id = `review-${randomUUID().slice(0, 8)}`;
  try {
    await publishExecutableFixture({
      id,
      name: "Leased device review",
      sourceDirectory: "tests/fixtures/host-capabilities",
      transform: (file, source) =>
        file === "module.ts"
          ? source.replace(
              'kind: "files.export",',
              'kind: "files.export", offline: "lease",',
            )
          : source,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const headers = {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
    };
    const workspace = randomUUID();
    expect(
      (
        await page.request.post("/api/v1/workspaces", {
          headers,
          data: {
            id: workspace,
            name: "Leased device review",
            currency: "EUR",
          },
        })
      ).status(),
    ).toBe(200);
    await assignHostFixture(pool, workspace, id);
    const hours = async (offlineHours: string) => {
      const edited = await page.request.patch(
        `/api/v1/workspaces/${workspace}`,
        { headers, data: { name: "Leased device review", offlineHours } },
      );
      expect(edited.status(), await edited.text()).toBe(200);
    };
    await hours("2");
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page.getByRole("link", { name: "Modules", exact: true }).click();
    await page
      .locator(".module-install-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Leased device review",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Review device access", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Leased device review device access",
      exact: true,
    });
    await expect(
      dialog.getByRole("region", { name: "Capability export", exact: true }),
    ).toContainText("lease for up to 2 hours");
    await expect(
      dialog.getByRole("region", { name: "Capability peers", exact: true }),
    ).toContainText("Online authorization required.");
    await context.setOffline(true);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Online authorization required",
        exact: true,
      }),
    ).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await page
      .locator(".module-install-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Leased device review",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Review device access", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Capability export", exact: true }),
    ).toBeVisible();
    const policyDelivered = page.waitForResponse(
      async (response) =>
        response.url().includes(`/workspaces/${workspace}/policy`) &&
        response.status() === 200 &&
        (await response.json()).bootstrap.offlineHours === 0,
    );
    await hours("0");
    await policyDelivered;
    await dialog
      .getByRole("button", { name: "Refresh review", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Capability export", exact: true }),
    ).toContainText("Offline access is disabled for this workspace.");
    await mkdir("docs/verification/capability-review", { recursive: true });
    const exportReview = dialog.getByRole("region", {
      name: "Capability export",
      exact: true,
    });
    await expect(async () => {
      await exportReview.scrollIntoViewIfNeeded();
      await expect(exportReview).toBeInViewport();
    }).toPass({ timeout: 5000 });
    await page.screenshot({
      path: "docs/verification/capability-review/lease-policy.png",
    });
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});
