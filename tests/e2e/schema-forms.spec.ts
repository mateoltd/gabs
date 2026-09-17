import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { startModuleDev } from "../../tooling/modules/module-dev/server";

test("typed generated editors preserve nested values, primitive choices and invalid JSON drafts", async ({
  page,
}) => {
  test.setTimeout(90000);
  const server = await startModuleDev(
    resolve("tests/fixtures/schema-editor"),
    0,
  );
  const view = page.getByRole("region", { name: "Structured intake" });
  const select = async (label: string, value: string) => {
    const trigger = view.getByRole("combobox", { name: label, exact: true });
    await trigger.click();
    await view
      .getByRole("option")
      .and(page.locator(`[data-value="${value}"]`))
      .click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  };
  const lines = view.getByRole("group", { name: "Lines", exact: true });
  const saved = async () =>
    (await (await page.request.get(server.origin + "/state")).json()).records
      .records;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(server.origin);
    await expect(
      view.getByRole("heading", { name: "Supplier intake" }),
    ).toBeVisible({ timeout: 45000 });
    await view.getByRole("button", { name: "Check fields" }).click();
    await expect(view.getByRole("alert")).toContainText(
      "Review the marked fields",
    );
    const candidate = view.getByLabel("Candidate", { exact: true });
    await expect(candidate).toHaveAttribute("type", "text");
    await expect(candidate).toHaveAttribute("aria-invalid", "true");
    await candidate.fill("North office");
    await expect(candidate).toHaveAttribute("aria-invalid", "false");
    await view
      .getByRole("button", { name: "Add address", exact: true })
      .click();
    await view.getByLabel("Street", { exact: true }).fill("Market Street");
    await view.getByLabel("City", { exact: true }).fill("Madrid");
    await view
      .getByRole("checkbox", { name: "No value for credit limit", exact: true })
      .check();
    await select("Choice", "choice:0");
    await select("Delivery format", "1");
    await expect(view.getByLabel("Desk", { exact: true })).toBeVisible();
    await view.getByLabel("Desk", { exact: true }).fill("Reception");
    await lines
      .getByRole("button", { name: "Add lines item", exact: true })
      .click();
    const first = lines.getByRole("group", { name: "Lines 1", exact: true });
    await first.getByLabel("Label", { exact: true }).fill("Notebooks");
    await first.getByLabel("Quantity", { exact: true }).fill("2");
    await first
      .getByRole("button", { name: "Add tags item", exact: true })
      .click();
    await select("Tags 1", "urgent");
    await expect(
      view.getByRole("button", { name: "Save intake" }),
    ).toBeEnabled();
    await view
      .getByRole("button", { name: "Edit metrics as JSON", exact: true })
      .click();
    const metrics = view.getByLabel("Metrics", { exact: true });
    await metrics.fill('{"boxes":');
    await expect(metrics).toHaveAttribute("aria-invalid", "true");
    await expect(
      view.getByRole("button", { name: "Save intake" }),
    ).toBeDisabled();
    await candidate.fill("North office revised");
    await expect(metrics).toHaveValue('{"boxes":');
    await metrics.fill('{"boxes":4}');
    await expect(metrics).toHaveAttribute("aria-invalid", "false");
    await view.getByRole("button", { name: "Save intake" }).click();
    await expect(view.getByRole("status")).toHaveText(
      "Saved North office revised: 1 lines.",
    );
    expect((await saved())[0].data).toEqual({
      candidate: "North office revised",
      approved: false,
      credit: null,
      address: { street: "Market Street", city: "Madrid" },
      lines: [{ label: "Notebooks", quantity: 2, tags: ["urgent"] }],
      choice: 0,
      delivery: { method: "pickup", desk: "Reception" },
      metrics: { boxes: 4 },
    });
    await view
      .getByRole("button", { name: "Remove address", exact: true })
      .click();
    await select("Choice", "choice:1");
    await select("Delivery format", "2");
    await expect(view.getByLabel("Desk", { exact: true })).toHaveCount(0);
    await view.getByLabel("Destination", { exact: true }).fill("Main office");
    await lines
      .getByRole("button", { name: "Add lines item", exact: true })
      .click();
    const second = lines.getByRole("group", { name: "Lines 2", exact: true });
    await second.getByLabel("Label", { exact: true }).fill("Pens");
    await second.getByLabel("Quantity", { exact: true }).fill("3");
    await lines
      .getByRole("button", { name: "Remove lines 1", exact: true })
      .click();
    await expect(lines.getByLabel("Label", { exact: true })).toHaveValue(
      "Pens",
    );
    await view.getByRole("button", { name: "Save intake" }).click();
    await expect.poll(async () => (await saved()).length).toBe(2);
    expect((await saved()).at(-1).data).toMatchObject({
      choice: false,
      delivery: { method: "courier", destination: "Main office" },
      lines: [{ label: "Pens", quantity: 3, tags: [] }],
    });
    expect((await saved()).at(-1).data).not.toHaveProperty("address");
    await select("Choice", "choice:2");
    await view.getByRole("button", { name: "Save intake" }).click();
    await expect.poll(async () => (await saved()).at(-1).data.choice).toBe("");
    await expect(view.locator(".page-heading p")).toHaveCSS("opacity", "1");
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Structured intake"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/schema-forms", { recursive: true });
    await view.screenshot({
      path: "docs/verification/schema-forms/wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await view.getByRole("combobox", { name: "Choice", exact: true }).click();
    const option = page.getByRole("option", { name: "No", exact: true });
    await expect(option).toBeVisible();
    await expect(view.locator(".select-popup[data-open]")).toHaveCSS(
      "opacity",
      "1",
    );
    expect(
      await option.evaluate(
        (element) => element.getRootNode() instanceof ShadowRoot,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await view.screenshot({
      path: "docs/verification/schema-forms/narrow.png",
    });
    await page.keyboard.press("Escape");
  } finally {
    await server.close();
  }
});
