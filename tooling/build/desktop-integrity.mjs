import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** Embed asset digests in main before the application is packaged and signed. */
export async function desktopIntegrityManifest(root) {
  const files = {};
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (name === "main.cjs") continue; // The signed executable/ASAR anchors main.
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path, name + "/");
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        let size = 0;
        for await (const bytes of createReadStream(path)) {
          hash.update(bytes);
          size += bytes.length;
        }
        files[name] = { size, sha256: hash.digest("hex") };
      } else
        throw Error("Desktop assets must be ordinary files and directories.");
    }
  }
  await visit(root);
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
