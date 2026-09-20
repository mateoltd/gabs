import { modulePolicyReleaseFixture } from "../support/module-policy-release-fixture";
import { modulePolicyReleasesJourney } from "../support/module-policy-releases-journey";
import { test, expect } from "@playwright/test";
import { operationPath } from "../../packages/contracts/src";
import {
  createReviewWorkspace,
  type ReviewTransport,
} from "../support/capability-review-journey";
test("connected clients adopt signed policy dependency changes and preserve pins", async ({
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
  const releases = await modulePolicyReleaseFixture();
  try {
    await modulePolicyReleasesJourney(
      page,
      await createReviewWorkspace(send),
      send,
      releases,
    );
  } finally {
    await releases.close();
  }
});
