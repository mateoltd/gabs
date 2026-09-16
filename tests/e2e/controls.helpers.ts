import { expect, type Page } from "@playwright/test";

export async function selectValue(page: Page, label: string, value: string) {
  if (label === "Workspace") {
    const trigger = page.getByRole("button", {
      name: "Switch workspace",
      exact: true,
    });
    await trigger.click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${value}"]`))
      .click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    return;
  }
  const trigger = page.getByRole("combobox", { name: label, exact: true });
  await trigger.click();
  await page
    .getByRole("option")
    .and(page.locator(`[data-value="${value}"]`))
    .click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
