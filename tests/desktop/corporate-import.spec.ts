import { test, expect, request, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { corporateImportJourney } from "../support/corporate-import-journey";
const require = createRequire(resolve("apps/desktop/package.json"));
test("native corporate import survives protected-storage restart and preserves original request authority", async () => {
  test.setTimeout(150000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-corporate-import-"));
  const entry = resolve(profile, "entry.cjs");
  const key = randomBytes(32).toString("hex");
  await writeFile(
    entry,
    `const {safeStorage}=require('electron');const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');const key=Buffer.from(${JSON.stringify(key)},'hex');safeStorage.isEncryptionAvailable=()=>true;safeStorage.isAsyncEncryptionAvailable=async()=>true;safeStorage.encryptStringAsync=async(text)=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()])};safeStorage.decryptStringAsync=async(bytes)=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return {result:Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString(),shouldReEncrypt:false}};require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
  );
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const launch = async () => {
    app = await electron.launch({
      executablePath: require("electron"),
      args: [entry, `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      },
    });
    return app.firstWindow();
  };
  try {
    expect(
      (
        await api.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    const page = await launch();
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    await corporateImportJourney(page, api, "desktop", async () => {
      await app!.close();
      const restored = await launch();
      await restored
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
      await expect(
        restored.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible();
      return restored;
    });
    expect(
      await app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await api.dispose();
    await rm(profile, { recursive: true, force: true });
  }
});
