import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startModuleDev } from "../../tooling/module-dev/server";
import { clientReferenceRows } from "../reference-client-journey";
test("development reference pickers require explicit provider grants and honor permission changes", async ({
  page,
}) => {
  test.setTimeout(120000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/reference-dev-"));
  const provider = resolve(directory, "provider");
  await mkdir(provider);
  for (const name of [
    "module.ts",
    "module-server.ts",
    "view.tsx",
    "view.css",
  ]) {
    let source = await readFile(
      `tests/fixtures/reference-client/${name}`,
      "utf8",
    );
    if (name === "module.ts")
      source = source
        .replace(
          "dependencies: {},",
          'dependencies: { "preview-reference-provider": "^1" },',
        )
        .replace(
          'field.reference("reference-client", "targets")',
          'field.reference("preview-reference-provider", "people")',
        );
    await writeFile(resolve(directory, name), source);
  }
  await writeFile(
    resolve(provider, "module.ts"),
    `import {defineModule,field,resource,Type} from '@suite/module-sdk';export default defineModule({id:'preview-reference-provider',name:'Reference provider',version:'1.0.0',description:'Reference fixture',publisher:'suite',host:'^1',backend:'^1',dependencies:{},configuration:Type.Object({}),operations:{},permissions:['preview-reference-provider.people.read','preview-reference-provider.people.write'],resources:{people:resource({name:field.text()},{title:'People'})}});`,
  );
  await writeFile(
    resolve(provider, "module.simulation.ts"),
    `import {defineSimulationModule} from '@suite/module-sdk/simulator';import module from './module';export default defineSimulationModule(module,{records:{people:${JSON.stringify(clientReferenceRows)}}});`,
  );
  const server = await startModuleDev(directory, 0, [provider]);
  try {
    await page.goto(server.origin);
    await expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 45000 },
    );
    const view = page.locator("#custom-preview");
    const picker = view.locator(".reference-picker");
    await expect(picker.getByRole("alert")).toContainText(
      "explicit module read grant",
    );
    await page
      .getByText("Module grants and provider permissions", { exact: true })
      .click();
    const grant = page.getByLabel(
      "reference-client: read references from preview-reference-provider",
      { exact: true },
    );
    await grant.check();
    await picker
      .getByRole("button", { name: "Retry choices", exact: true })
      .click();
    await expect(picker.getByRole("alert")).toHaveCount(0);
    await picker.locator("summary").click();
    await picker.getByRole("textbox").fill("Target 105");
    await expect(picker.getByRole("status")).toHaveText("1 choice on page 1.");
    await picker.getByRole("combobox").click();
    await page.getByRole("option", { name: "Target 105", exact: true }).click();
    await view
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Preview linked note");
    await view
      .getByRole("button", { name: "Check server lookup", exact: true })
      .click();
    await expect(
      view
        .getByRole("status")
        .filter({ hasText: "Server verified Target 105" }),
    ).toBeVisible();
    await view
      .getByRole("button", { name: "Save linked note", exact: true })
      .click();
    await expect(page.locator("#records")).toContainText("Preview linked note");
    await page
      .getByLabel("preview-reference-provider.people.read", { exact: true })
      .uncheck();
    await picker.getByRole("textbox").fill("Denied");
    await expect(picker.getByRole("alert")).toContainText("Missing permission");
    await page
      .getByLabel("preview-reference-provider.people.read", { exact: true })
      .check();
    await grant.uncheck();
    await picker
      .getByRole("button", { name: "Retry choices", exact: true })
      .click();
    await expect(picker.getByRole("alert")).toContainText(
      "explicit module read grant",
    );
    const retainedRecords = await page.locator("#records").textContent();
    await view
      .getByRole("button", { name: "Save linked note", exact: true })
      .click();
    await expect(view.locator(".error-message")).toContainText(
      "explicit module read grant",
    );
    await expect(page.locator("#records")).toHaveText(retainedRecords!);
    await mkdir("docs/verification/reference-integrity", { recursive: true });
    await page.screenshot({
      path: "docs/verification/reference-integrity/development-rejection.png",
    });
    await mkdir("docs/verification/reference-client", { recursive: true });
    await page.screenshot({
      path: "docs/verification/reference-client/development-denial.png",
    });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
