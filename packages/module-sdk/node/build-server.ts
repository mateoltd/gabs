import * as references from "../src/references";
import { build } from "esbuild";
import { realpath } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import * as sdk from "../src/index";
import { signServerPackage } from "./server-package";

export async function buildServerPackage(
  module: sdk.ModuleDefinition,
  directory: string,
  privateKey: string,
) {
  const root = await realpath(directory);
  const inside = (path: string) => {
    const part = relative(root, path);
    return (
      part !== ".." &&
      !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(part)
    );
  };
  const entry = await realpath(resolve(root, "module-server.ts"));
  if (!inside(entry))
    throw Error("Server entry must remain inside its module.");
  const shims: Record<string, string> = {
    "@suite/module-sdk": `export const {${Object.keys(sdk).join(",")}} = __suiteHost.sdk;`,
    "@suite/module-sdk/references": `export const {${Object.keys(references).join(",")}} = __suiteHost.references;`,
    "@suite/module-sdk/server":
      "export const {defineModuleServer} = __suiteHost.server;",
  };
  const result = await build({
    entryPoints: [entry],
    write: false,
    bundle: true,
    format: "iife",
    globalName: "SuiteServer",
    platform: "node",
    target: "node24",
    logLevel: "silent",
    metafile: true,
    plugins: [
      {
        name: "suite-server-v1",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (shims[args.path])
              return { path: args.path, namespace: "suite-host" };
            if (!args.importer) return;
            if (
              !args.path.startsWith(".") ||
              !inside(resolve(dirname(args.importer), args.path))
            )
              return {
                errors: [
                  {
                    text: `Unsupported server import ${args.path}. Use local source and public SDK capabilities.`,
                  },
                ],
              };
          });
          builder.onLoad({ filter: /.*/, namespace: "suite-host" }, (args) => ({
            contents: shims[args.path],
            loader: "js",
          }));
          builder.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
            if (!inside(await realpath(args.path)))
              return {
                errors: [
                  { text: "Server source must remain inside its module." },
                ],
              };
          });
        },
      },
    ],
  });
  if (
    result.outputFiles.length !== 1 ||
    Object.values(result.metafile.outputs).some((o) => o.imports.length)
  )
    throw Error(
      "A server component must be a self-contained JavaScript bundle.",
    );
  return signServerPackage(
    module,
    `export function createServer(__suiteHost) {\n${result.outputFiles[0].text}\nreturn SuiteServer.default;\n}`,
    privateKey,
  );
}
