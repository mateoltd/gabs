import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

export async function buildDevAssets() {
  const directory = resolve(".local/module-dev-assets");
  const output = await build({
    entryPoints: {
      preview: resolve("tooling/modules/module-dev/preview.tsx"),
      host: resolve("tooling/modules/module-dev/host.css"),
    },
    outdir: directory,
    write: false,
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    target: "es2023",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".woff2": "file", ".woff": "file" },
    assetNames: "assets/[name]-[hash]",
    publicPath: "/",
    logLevel: "silent",
  });
  const assets = new Map<
    string,
    { content: Uint8Array | string; type: string }
  >();
  for (const file of output.outputFiles) {
    const name = relative(directory, file.path).replaceAll("\\", "/");
    assets.set(`/${name}`, {
      content: file.contents,
      type: name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".js")
          ? "text/javascript"
          : "font/woff2",
    });
  }
  for (const [path, name, type] of [
    ["/", "index.html", "text/html"],
    ["/app.js", "app.js", "text/javascript"],
    ["/style.css", "style.css", "text/css"],
  ])
    assets.set(path, {
      content: await readFile(new URL(name, import.meta.url)),
      type,
    });
  return assets;
}
