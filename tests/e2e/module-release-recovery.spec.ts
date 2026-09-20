import { modulePolicyReleaseFixture } from "../support/module-policy-release-fixture";
import { moduleReleaseRecoveryJourney } from "../support/module-release-recovery-journey";
import { test, expect } from "@playwright/test";
import { operationPath } from "../../packages/contracts/src";
import {
  createReviewWorkspace,
  type ReviewTransport,
} from "../support/capability-review-journey";
test("administrators edit permissions and repair unavailable releases independently", async ({
  page,
}) => {
  test.setTimeout(90000);
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
  const releases = await modulePolicyReleaseFixture("First recovery module");
  const second = await modulePolicyReleaseFixture("Second recovery module");
  try {
    await moduleReleaseRecoveryJourney(
      page,
      await createReviewWorkspace(send),
      send,
      releases,
      second,
    );
  } finally {
    await releases.close();
    await second.close();
  }
});
