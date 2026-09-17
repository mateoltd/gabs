import { test, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startModuleDev } from "../../tooling/modules/module-dev/server";
test.use({ actionTimeout: 10000 });

test("stateful preview retains typed input, handles business rejection and recovers from a render failure", async ({
  page,
}) => {
  test.setTimeout(90000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/state-preview-"));
  const id = `state-preview-${randomUUID().slice(0, 8)}`;
  for (const name of ["module.ts", "module-server.ts", "view.tsx", "view.css"])
    await writeFile(
      resolve(directory, name),
      (
        await readFile(`tests/fixtures/editable-notes/${name}`, "utf8")
      ).replaceAll("custom-notes", id),
    );
  const definition = await readFile(resolve(directory, "module.ts"), "utf8");
  await writeFile(
    resolve(directory, "module.ts"),
    definition.replace(
      "output: Type.Object({ id: Type.String() }),",
      'output: Type.Object({ id: Type.String() }), errors: Type.Object({ reason: Type.Literal("cancelled") }),',
    ),
  );
  const backend = await readFile(
    resolve(directory, "module-server.ts"),
    "utf8",
  );
  await writeFile(
    resolve(directory, "module-server.ts"),
    backend.replace(
      "const record =",
      'if (input.name === "Rejected") ctx.reject({reason:"cancelled"}); const record =',
    ),
  );
  const original = await readFile(resolve(directory, "view.tsx"), "utf8");
  const view = original
    .replace('.call("capture",', '.attempt("capture",')
    .replace(
      ".then(async () => {",
      '.then(async (result) => { if (!result.ok) { setError(Error("Business rejection: " + result.error.reason)); return; }',
    );
  await writeFile(resolve(directory, "view.tsx"), view);
  const server = await startModuleDev(directory, 0);
  const region = page.getByRole("region", { name: "Custom notes workspace" });
  try {
    await page.goto(server.origin);
    await expect(region.getByLabel("Note name")).toBeVisible({
      timeout: 45000,
    });
    await region.getByLabel("Note name").fill("Held draft");
    await page.getByLabel("Server online", { exact: true }).uncheck();
    await expect(
      region.getByRole("button", { name: "Save note" }),
    ).toBeDisabled();
    await expect(region.getByLabel("Note name")).toHaveValue("Held draft");
    await page.getByLabel("Server online", { exact: true }).check();
    await region.getByLabel("Note name").fill("Rejected");
    await region.getByRole("button", { name: "Save note" }).click();
    await expect(region).toContainText("Business rejection: cancelled");
    await expect(region.getByLabel("Note name")).toHaveValue("Rejected");
    await expect(page.locator("#records")).not.toContainText("Rejected");
    await region.getByLabel("Note name").fill("Accepted stateful note");
    await region.getByRole("button", { name: "Save note" }).click();
    await expect(
      region.getByText("Accepted stateful note", { exact: true }),
    ).toBeVisible();
    await expect(region.getByLabel("Note name")).toHaveValue("");
    await writeFile(
      resolve(directory, "view.tsx"),
      view.replace(
        'const name = state.value?.name ?? "";',
        'throw Error("Preview crash"); const name = state.value?.name ?? "";',
      ),
    );
    await expect(page.getByRole("alert")).toContainText("Preview crash", {
      timeout: 45000,
    });
    await expect(
      page.getByLabel("Server online", { exact: true }),
    ).toBeVisible();
    await writeFile(resolve(directory, "view.tsx"), view);
    await expect(region.getByLabel("Note name")).toBeVisible({
      timeout: 45000,
    });
    await expect(region.getByLabel("Note name")).toHaveValue("");
    await expect(page.locator("#records")).not.toContainText(
      "Accepted stateful note",
    );
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
