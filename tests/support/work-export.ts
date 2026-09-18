import {
  expect,
  type ElectronApplication,
  type Locator,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function browserWorkExport(button: Locator): Promise<unknown> {
  const download = button.page().waitForEvent("download");
  await button.click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

/** Exercise the native file write without displaying a system dialog. */
export async function nativeWorkExport(
  app: ElectronApplication,
  profile: string,
  button: Locator,
): Promise<unknown> {
  const file = resolve(profile, `saved-work-${crypto.randomUUID()}.json`);
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await button.click();
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch {
        const errors = await button
          .locator("..")
          .getByRole("alert")
          .allTextContents();
        if (errors.length) throw Error(errors.join("; "));
        return null;
      }
    })
    .not.toBeNull();
  return JSON.parse(await readFile(file, "utf8"));
}
