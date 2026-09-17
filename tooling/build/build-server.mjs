import { build } from "esbuild";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const target = process.argv[2];
if (!["api", "worker"].includes(target)) throw Error("Choose api or worker");
// ESM preserves top-level await. createRequire supports dependencies with conditional Node requires.
await build({
  entryPoints: [`${root}/apps/${target}/src/main.ts`],
  outfile: `${root}/apps/${target}/dist/main.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
