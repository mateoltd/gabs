import { expect, type ElectronApplication } from "@playwright/test";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { openSavedWorkArchive } from "../../../packages/client/src/recovery/archive";
import { selectValue } from "../../e2e/controls.helpers";
import type { ArchiveReviewContext } from "./archive-lifecycle";
import { captureArchive } from "./archives";
import { nativePortabilityDevice, portabilityStorage } from "./devices";

export type PublicationCrash = "writing" | "prepared" | "published";
type NativeDevice = Awaited<ReturnType<typeof nativePortabilityDevice>>;

/** Terminate the actual main process at its filesystem boundary, never a simulated export. */
async function crashDuringPublication(
  app: ElectronApplication,
  destination: string,
  phase: PublicationCrash,
) {
  await app.evaluate(
    async ({ dialog, BrowserWindow }, { destination, phase }) => {
      if (
        !BrowserWindow.getAllWindows().every(
          (window) =>
            !window.isFocused() &&
            (!window.isVisible() || window.isMinimized()),
        )
      )
        throw Error("Crash acceptance must remain hidden.");
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: destination,
      });
      const fs = process.getBuiltinModule("node:fs/promises");
      const terminate = async () => {
        await fs.writeFile(`${destination}.phase`, phase, { mode: 0o600 });
        process.kill(process.pid, "SIGKILL");
        await new Promise<never>(() => {});
      };
      if (phase === "writing") {
        const original = fs.open;
        fs.open = async (...args) => {
          const file = await original(...args);
          if (
            String(args[0]).startsWith(`${destination}.`) &&
            String(args[0]).endsWith(".tmp")
          ) {
            const write = file.writeFile.bind(file);
            file.writeFile = async (data) => {
              if (typeof data !== "string")
                throw Error("Expected encrypted archive text.");
              await write(data.slice(0, Math.floor(data.length / 2)), "utf8");
              await terminate();
            };
          }
          return file;
        };
      } else {
        const original = fs.link;
        fs.link = async (from, to) => {
          if (String(to) !== destination) return original(from, to);
          if (phase === "published") await original(from, to);
          await terminate();
        };
      }
    },
    { destination, phase },
  );
}

export async function archivePublication(
  context: ArchiveReviewContext,
  options: {
    phase: PublicationCrash;
    device: NativeDevice;
    restart(): Promise<NativeDevice>;
  },
) {
  const { scope, file, passphrase } = context;
  let page = context.page;
  const before = await portabilityStorage(page, scope);
  const original = await openSavedWorkArchive(
    file.bytes.toString(),
    passphrase,
    scope,
    () => {},
  );
  const destination = `${file.path}.${options.phase}.json`;
  const archive = () =>
    page.getByRole("dialog", { name: "Saved-work archives", exact: true });
  const fill = async () => {
    await archive()
      .getByLabel("Archive passphrase", { exact: true })
      .fill(passphrase);
    await archive()
      .getByLabel("Confirm archive passphrase", { exact: true })
      .fill(passphrase);
  };
  await fill();
  const child = options.device.app.process();
  await crashDuringPublication(options.device.app, destination, options.phase);
  await archive()
    .getByRole("button", { name: "Save encrypted archive", exact: true })
    .click()
    .catch(() => {});
  await expect.poll(() => child.signalCode, { timeout: 15000 }).toBe("SIGKILL");
  expect(await readFile(`${destination}.phase`, "utf8")).toBe(options.phase);
  expect(await readFile(file.path)).toEqual(file.bytes);
  const temporaries = (await readdir(dirname(destination))).filter(
    (name) =>
      name.startsWith(`${basename(destination)}.`) && name.endsWith(".tmp"),
  );
  expect(temporaries).toHaveLength(1);
  const temporary = `${dirname(destination)}/${temporaries[0]}`;
  expect((await stat(temporary)).mode & 0o777).toBe(0o600);
  const interrupted = await readFile(temporary, "utf8");
  expect(interrupted).not.toContain("Portable queued contact");
  expect(interrupted).not.toContain(scope.userId);
  if (options.phase === "writing") {
    await expect(
      openSavedWorkArchive(interrupted, passphrase, scope, () => {}),
    ).rejects.toThrow();
  } else {
    expect(
      (await openSavedWorkArchive(interrupted, passphrase, scope, () => {}))
        .copies,
    ).toEqual(original.copies);
  }
  if (options.phase === "published") {
    expect(await readFile(destination, "utf8")).toBe(interrupted);
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
  } else {
    await expect(readFile(destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }

  const restarted = await options.restart();
  page = restarted.page;
  await restarted.offline(true);
  await selectValue(page, "Workspace", scope.workspaceId);
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  const after = await portabilityStorage(page, scope);
  expect(after.journal).toEqual(before.journal);
  expect(after.drafts).toEqual(before.drafts);
  expect(after.draftVersions).toEqual(before.draftVersions);
  // Development credentials are process-local. Reauthorize after restart while
  // a real transport failure keeps the original pending request on this device.
  await restarted.app.evaluate((_, workspaceId) => {
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      if (
        url.pathname.startsWith("/api/v1/module/") &&
        url.pathname.includes(`/workspaces/${workspaceId}/`) &&
        method !== "GET"
      )
        return Promise.reject(
          new TypeError("Publication recovery write transport is offline."),
        );
      return original(input, init);
    };
  }, scope.workspaceId);
  await restarted.offline(false);
  const enable = page.getByRole("button", {
    name: "Enable on this device",
    exact: true,
  });
  const disable = page.getByRole("button", {
    name: "Disable offline storage",
    exact: true,
  });
  await expect(enable.or(disable)).toBeVisible();
  if (await enable.isVisible()) await enable.click();
  await expect(disable).toBeVisible();
  await page
    .getByRole("button", { name: "Saved-work archives", exact: true })
    .click();
  await expect(
    archive().getByLabel("Archive passphrase", { exact: true }),
  ).toHaveValue("");
  await expect(archive().getByRole("checkbox")).toHaveCount(0);
  await archive()
    .getByRole("button", { name: "Load saved work", exact: true })
    .click();
  await expect(archive().getByRole("checkbox")).toHaveCount(2);
  for (const checkbox of await archive().getByRole("checkbox").all())
    await checkbox.check();
  await fill();
  const retry = `${destination}.retry.json`;
  await restarted.exportFile(
    archive().getByRole("button", {
      name: "Save encrypted archive",
      exact: true,
    }),
    retry,
  );
  const recovered = await openSavedWorkArchive(
    await readFile(retry, "utf8"),
    passphrase,
    scope,
    () => {},
  );
  expect(recovered.copies).toHaveLength(original.copies.length);
  for (const copy of original.copies) {
    if (copy.selection === "request") {
      const restored = recovered.copies.find(
        (candidate) =>
          candidate.selection === "request" &&
          candidate.entry.id === copy.entry.id,
      );
      expect(restored).toMatchObject({
        ...scope,
        moduleId: copy.moduleId,
        moduleVersion: copy.moduleVersion,
        selection: "request",
        entry: {
          id: copy.entry.id,
          call: copy.entry.call,
          dependencies: copy.entry.dependencies,
          createdAt: copy.entry.createdAt,
        },
      });
    } else expect(recovered.copies).toContainEqual(copy);
  }
  expect(await readFile(file.path)).toEqual(file.bytes);
  await captureArchive(page, `native-publication-${options.phase}`);
  // The new device receives the file that survived publication, or the explicit retry.
  const path = options.phase === "published" ? destination : retry;
  return { path, bytes: await readFile(path) };
}
