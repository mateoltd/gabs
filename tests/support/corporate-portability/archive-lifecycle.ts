import { holdServerReply, type ReplyGate } from "./server-reply";
import { selectValue } from "../../e2e/controls.helpers";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Scope } from "../../../packages/client/src";
import { portabilityStorage } from "./devices";
import { captureArchive } from "./archives";

export interface ArchiveReviewContext {
  page: Page;
  scope: Scope;
  file: { path: string; bytes: Buffer };
  passphrase: string;
}
export const holdArchiveAuthority = (page: Page, app?: ElectronApplication) =>
  holdServerReply(page, "/api/v1/identity/recovery", app);

/** Expired views and interrupted authorizations cannot admit copies; the raw file survives. */
export async function archiveLifecycle(
  context: ArchiveReviewContext,
  options: {
    surface: string;
    hold(): Promise<ReplyGate>;
    restart(): Promise<Page>;
  },
) {
  let page = context.page;
  const { scope, file, passphrase } = context;
  const dialog = () =>
    page.getByRole("dialog", { name: "Saved-work archives", exact: true });
  const empty = async () => {
    const state = await portabilityStorage(page, scope);
    expect(state?.recoveryImports ?? {}).toEqual({});
    expect(state?.journal ?? []).toEqual([]);
    expect(state?.drafts ?? {}).toEqual({});
  };
  const unlock = async () => {
    await page
      .getByRole("button", { name: "Saved-work archives", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "Open archive", exact: true })
      .click();
    await expect(
      dialog().getByLabel("Archive passphrase", { exact: true }),
    ).toHaveValue("");
    await dialog()
      .getByLabel("Encrypted saved-work archive", { exact: true })
      .setInputFiles(file.path);
    await dialog()
      .getByLabel("Archive passphrase", { exact: true })
      .fill(passphrase);
    await dialog()
      .getByRole("button", { name: "Unlock archive", exact: true })
      .click();
    await expect(dialog().getByRole("checkbox")).toHaveCount(2);
  };
  await expect(dialog().getByRole("checkbox")).toHaveCount(2);
  // The clock is installed before this device first observes an import proof.
  await page.clock.fastForward(301000);
  await expect(dialog().getByRole("checkbox")).toHaveCount(0);
  await expect(
    dialog().getByRole("button", {
      name: "Import selected copies",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(dialog().getByRole("status")).toContainText(
    "Saved-work access expired or changed",
  );
  await expect(
    dialog().getByLabel("Archive passphrase", { exact: true }),
  ).toHaveValue("");
  await captureArchive(page, `${options.surface}-expired`, false);
  await empty();
  await page.clock.setSystemTime(new Date());
  await page.reload();
  await unlock();

  for (const transition of ["close", "crash"] as const) {
    await dialog()
      .getByRole("checkbox", { name: /Contacts: saved request/ })
      .check();
    const gate = await options.hold();
    try {
      await dialog()
        .getByRole("button", { name: "Import selected copies", exact: true })
        .click();
      await gate.arrived();
      if (transition === "close") {
        await dialog()
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
      } else {
        const session = await page.context().newCDPSession(page);
        const crashed = page.waitForEvent("crash");
        void session.send("Page.crash").catch(() => {});
        await crashed;
      }
    } finally {
      await gate.release();
    }
    if (transition === "crash") {
      page = await options.restart();
      try {
        await selectValue(page, "Workspace", scope.workspaceId);
      } catch (error) {
        await page.screenshot({
          path: `/tmp/gabs-${options.surface}-archive-restart.png`,
        });
        throw new Error(
          `${String(error)}\nRestart UI: ${(await page.locator("body").innerText()).slice(0, 3500)}`,
        );
      }
      await page
        .getByRole("navigation", { name: "Preferences", exact: true })
        .getByRole("link", { name: "Settings", exact: true })
        .click();
    } else await page.reload();
    await gate.dispose();
    await empty();
    await unlock();
    await expect(dialog().getByRole("checkbox").first()).not.toBeChecked();
    expect(await readFile(file.path)).toEqual(file.bytes);
  }
  await captureArchive(page, `${options.surface}-reopened`);
  return page;
}
