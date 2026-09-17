import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
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
await bundle({
  entryPoints: [root + "/apps/desktop/src/utility/cache-worker.ts"],
  outfile: root + "/apps/desktop/dist/cache-worker.cjs",
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
