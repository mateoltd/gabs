import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function buildRegistryConsole(
  directory = resolve(".local/registry-console"),
) {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [resolve("tooling/registry-console/ui.tsx")],
    outfile: resolve(directory, "app.js"),
    bundle: true,
    minify: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    target: "es2023",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "file", ".woff": "file" },
    assetNames: "assets/[name]-[hash]",
  });
  await writeFile(
    resolve(directory, "index.html"),
    '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Release review | Common</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  );
  return directory;
}
