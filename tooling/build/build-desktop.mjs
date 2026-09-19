import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { cp, mkdir, rm } from "node:fs/promises";
const root = resolve(import.meta.dirname, "../..");
const config = {
  apiOrigin: process.env.API_ORIGIN ?? "http://localhost:4310",
  issuer: process.env.AUTH0_ISSUER ?? "",
  clientId: process.env.AUTH0_DESKTOP_CLIENT_ID ?? "",
  audience: process.env.AUTH0_AUDIENCE ?? "",
  callback:
    process.env.AUTH0_DESKTOP_CALLBACK ?? "http://127.0.0.1:49173/callback",
  updateUrl: process.env.DESKTOP_UPDATE_URL ?? "",
};
if (process.argv.includes("--package")) {
  if (process.env.SUITE_DESKTOP_PACKAGING_SMOKE === "1") {
    console.warn(
      "Packaging check only: this installer may not support sign-in.",
    );
  } else {
    for (const [name, value] of [
      ["API_ORIGIN", config.apiOrigin],
      ["AUTH0_ISSUER", config.issuer],
    ]) {
      let url;
      try {
        url = new URL(value);
      } catch {
        /* Report the setting, never its value. */
      }
      if (
        !url ||
        url.protocol !== "https:" ||
        url.hostname.endsWith(".invalid")
      )
        throw Error(
          `Packaging requires a real HTTPS ${name}. For the local pilot, run pnpm dev:desktop from the repository root.`,
        );
    }
    for (const [name, value] of [
      ["AUTH0_DESKTOP_CLIENT_ID", config.clientId],
      ["AUTH0_AUDIENCE", config.audience],
    ]) {
      if (!value.trim())
        throw Error(
          `Packaging requires ${name}. For the local pilot, run pnpm dev:desktop from the repository root.`,
        );
    }
    const callback = new URL(config.callback);
    if (
      callback.protocol !== "http:" ||
      callback.hostname !== "127.0.0.1" ||
      !callback.port
    )
      throw Error(
        "AUTH0_DESKTOP_CALLBACK must be a registered http://127.0.0.1 callback with a fixed port.",
      );
  }
}
await bundle({
  entryPoints: [root + "/apps/desktop/src/main/main.ts"],
  outfile: root + "/apps/desktop/dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  define: { __RUNTIME_CONFIG__: JSON.stringify(config) },
  logLevel: "warning",
});
// Ship only the target Node-API binary and its small JS loader. No workspace
// node_modules or runtime downloads are needed in the packaged application.
const desktopRequire = createRequire(root + "/apps/desktop/package.json");
const sqliteRoot = dirname(
  desktopRequire.resolve("better-sqlite3-multiple-ciphers/package.json"),
);
const vendor = root + "/apps/desktop/dist/vendor/sqlite";
const platform = process.env.npm_config_platform ?? process.platform;
const arch = process.env.npm_config_arch ?? process.arch;
const target = `${platform === "linux" && process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime ? "linuxmusl" : platform}-${arch}`;
await rm(vendor, { recursive: true, force: true });
await mkdir(vendor + "/prebuilds", { recursive: true });
await cp(sqliteRoot + "/lib", vendor + "/lib", { recursive: true });
await cp(sqliteRoot + "/package.json", vendor + "/package.json");
await cp(sqliteRoot + "/LICENSE", vendor + "/LICENSE");
await cp(
  `${sqliteRoot}/prebuilds/${target}.node`,
  `${vendor}/prebuilds/${target}.node`,
);
await bundle({
  entryPoints: [root + "/apps/desktop/src/utility/cache-worker.ts"],
  outfile: root + "/apps/desktop/dist/cache-worker.cjs",
  plugins: [
    {
      name: "sqlite-runtime",
      setup(build) {
        build.onResolve(
          { filter: /^better-sqlite3-multiple-ciphers$/ },
          () => ({ path: "./vendor/sqlite/lib/index.js", external: true }),
        );
      },
    },
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  logLevel: "warning",
});
await bundle({
  entryPoints: [root + "/apps/desktop/src/preload/index.ts"],
  outfile: root + "/apps/desktop/dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  logLevel: "warning",
});
await viteBuild({
  configFile: false,
  root: root + "/apps/desktop",
  base: "./",
  plugins: [react()],
  build: { outDir: "dist/renderer", emptyOutDir: true },
});
