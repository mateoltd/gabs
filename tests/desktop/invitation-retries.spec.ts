import "dotenv/config";
import { invitationRetriesJourney } from "../support/invitation-retries-journey";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createReviewWorkspace,
  type ReviewTransport,
} from "../support/capability-review-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
test("hidden native administrators retry accepted invitation creation and revocation", async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-invitation-retries-"));
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      executablePath: require("electron"),
      args: [
        resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
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
    await invitationRetriesJourney(
      page,
      await createReviewWorkspace(send),
      send,
      app,
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    try {
      await app?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
});
