import "dotenv/config";
import { modulePoliciesJourney } from "../support/module-policies-journey";
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
test("hidden native administrators assign modules through role policies", async () => {
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
    await modulePoliciesJourney(
      page,
      await createReviewWorkspace(send),
      send,
      true,
    );
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
