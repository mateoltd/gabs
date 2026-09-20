import { modulePolicyReleaseFixture } from "../support/module-policy-release-fixture";
import "dotenv/config";
import { modulePolicyReleasesJourney } from "../support/module-policy-releases-journey";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createReviewWorkspace,
  type ReviewTransport,
} from "../support/capability-review-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
test("hidden native clients adopt signed policy dependencies and preserve pins", async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-capability-review-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("apps/desktop/dist/main.cjs"), `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUITE_DESKTOP_DEV_AUTH: "1",
      SUITE_DESKTOP_TEST_MINIMIZED: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const send: ReviewTransport = (request) =>
      page.evaluate(
        (request) => window.suiteDesktop!.execute(request),
        request,
      );
    const releases = await modulePolicyReleaseFixture();
    try {
      await modulePolicyReleasesJourney(
        page,
        await createReviewWorkspace(send),
        send,
        releases,
        true,
      );
    } finally {
      await releases.close();
    }
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
