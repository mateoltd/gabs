import { expect, type Locator, type Page } from "@playwright/test";

/** Save a real source command review before exporting its second snapshot. */
export async function exportCommandSnapshot(options: {
  page: Page;
  moduleName: string;
  name: string;
  exportFile(
    button: Locator,
    filename: string,
  ): Promise<{ path: string; bytes: Buffer }>;
}) {
  const { page } = options;
  await page
    .getByRole("link", { name: options.moduleName, exact: true })
    .click();
  await page.getByRole("button", { name: /^Saved commands/ }).click();
  const inbox = page.getByRole("dialog", {
    name: "Saved commands",
    exact: true,
  });
  await inbox
    .getByRole("button", {
      name: /^(Review command|Resume command review)$/,
      exact: true,
    })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await review.getByLabel("Name", { exact: true }).fill(options.name);
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review).toContainText("Review saved on this device.");
  await review
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await inbox
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: /^Saved commands/ }).click();
  const file = await options.exportFile(
    inbox.getByRole("button", { name: "Export saved request", exact: true }),
    "second-command.json",
  );
  expect(JSON.parse(file.bytes.toString()).review.input.name).toBe(
    options.name,
  );
  await inbox
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  return file;
}
