import { createHash } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import type { IntegrityFailure } from "./format";

export type AssetManifest = Readonly<
  Record<string, { size: number; sha256: string }>
>;
const namePattern = /^[a-zA-Z0-9_@.+-]+(?:\/[a-zA-Z0-9_@.+-]+)*$/;

/** A diagnostic gate anchored by signed main, not a substitute for OS code signing. */
export async function inspectAssets(
  root: string,
  manifest: AssetManifest,
  macSignedNative = false,
): Promise<IntegrityFailure | undefined> {
  const expected = Object.entries(manifest);
  if (
    !expected.length ||
    expected.length > 4096 ||
    !["preload.cjs", "cache-worker.cjs", "renderer/index.html"].every((name) =>
      Object.hasOwn(manifest, name),
    ) ||
    !expected.some(([name]) =>
      /^vendor\/sqlite\/prebuilds\/[\w-]+\.node$/.test(name),
    ) ||
    expected.some(
      ([name, file]) =>
        name.length > 512 ||
        !namePattern.test(name) ||
        name.split("/").some((part) => part === "." || part === "..") ||
        name === "main.cjs" ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > 256 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(file.sha256),
    )
  )
    return { code: "invalid-manifest" };
  const found = new Set<string>();
  async function visit(
    directory: string,
    prefix = "",
  ): Promise<IntegrityFailure | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (name === "main.cjs") continue;
      // Never include an unexpected filename in the audit or error message.
      if (!namePattern.test(name)) return { code: "unexpected-asset" };
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!expected.some(([asset]) => asset.startsWith(name + "/")))
          return { code: "unexpected-asset" };
        const failure = await visit(path, name + "/");
        if (failure) return failure;
      } else if (entry.isFile() && Object.hasOwn(manifest, name)) {
        // macOS signs the native image after bundling. Its final bytes are covered
        // by the verified bundle seal, not the pre-sign build digest.
        if (
          macSignedNative &&
          /^vendor\/sqlite\/prebuilds\/[\w-]+\.node$/.test(name)
        ) {
          found.add(name);
          continue;
        }
        const file = await open(
          path,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size !== manifest[name].size)
            return { code: "changed-asset", asset: name };
          const hash = createHash("sha256");
          let size = 0;
          for await (const bytes of file.createReadStream({
            autoClose: false,
          })) {
            size += bytes.length;
            if (size > manifest[name].size)
              return { code: "changed-asset", asset: name };
            hash.update(bytes);
          }
          if (
            size !== manifest[name].size ||
            hash.digest("hex") !== manifest[name].sha256
          )
            return { code: "changed-asset", asset: name };
        } finally {
          await file.close();
        }
        found.add(name);
      } else return { code: "unexpected-asset" };
    }
  }
  try {
    const failure = await visit(resolve(root));
    if (failure) return failure;
    const missing = expected.find(([name]) => !found.has(name));
    if (missing) return { code: "missing-asset", asset: missing[0] };
  } catch {
    return { code: "unreadable-assets" };
  }
}
