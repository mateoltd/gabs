import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanImportStaging,
  createImportStaging,
} from "../../apps/desktop/src/main/storage/import-staging";
import {
  publishJournal,
  readJournal,
} from "../../apps/desktop/src/main/storage/journal";
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "suite-staging-"));
  directories.push(dir);
  const root = join(dir, "secure-cache");
  await mkdir(root);
  await writeFile(join(root, "original"), "keep original data");
  return { dir, root };
}
it("cleans only journal-owned import staging and preserves the active store", async () => {
  const f = await fixture();
  const stage = await createImportStaging(f.root);
  await writeFile(join(stage.path, "encrypted-copy"), "opaque staged bytes");
  await cleanImportStaging(f.root);
  await cleanImportStaging(f.root);
  expect(await readdir(f.dir)).toEqual(["secure-cache"]);
  expect(await readFile(join(f.root, "original"), "utf8")).toBe(
    "keep original data",
  );
});
it("rejects a forged traversal in the staging record", async () => {
  const f = await fixture();
  await writeFile(
    `${f.root}.import.json`,
    JSON.stringify({ version: 1, id: "../secure-cache" }),
  );
  await expect(cleanImportStaging(f.root)).rejects.toThrow(
    "Invalid import staging",
  );
  expect(await readFile(join(f.root, "original"), "utf8")).toBe(
    "keep original data",
  );
});
it("refuses to follow a staging link into live storage", async () => {
  const f = await fixture();
  const stage = await createImportStaging(f.root);
  await rm(stage.path, { recursive: true });
  await symlink(f.root, stage.path, "junction");
  await expect(cleanImportStaging(f.root)).rejects.toThrow("staging changed");
  expect(await readFile(join(f.root, "original"), "utf8")).toBe(
    "keep original data",
  );
});
it("does not overwrite another intent and bounds startup record reads", async () => {
  const f = await fixture();
  const path = `${f.root}.import.json`;
  await publishJournal(path, { original: true });
  await expect(publishJournal(path, { replaced: true })).rejects.toThrow();
  expect(await readJournal(path)).toEqual({ original: true });
  await writeFile(path, JSON.stringify({ oversized: "x".repeat(5000) }));
  await expect(readJournal(path)).rejects.toThrow(
    "Invalid storage recovery record",
  );
  expect(
    (await readdir(f.dir)).filter((name) => name.endsWith(".tmp")),
  ).toEqual([]);
});
