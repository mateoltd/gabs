import { build } from "esbuild";
import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import type { ModuleDefinition } from "../src/index";
import {
  requiresLocalCode,
  validateLocalArtifact,
  type LocalBundle,
} from "../src/local-artifact";
export async function buildLocalBundle(
  module: ModuleDefinition,
  directory: string,
): Promise<LocalBundle | undefined> {
  if (!requiresLocalCode(module)) return;
  const root = await realpath(directory);
  const inside = (path: string) => {
    const part = relative(root, path);
    return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
  };
  const entry = await realpath(resolve(root, "module-local.ts")).catch(() => {
    throw Error(
      "Local operations require module-local.ts with defineLocalModule handlers.",
    );
  });
  if (!inside(entry)) throw Error("Local entry must stay inside the module.");
  const result = await build({
    entryPoints: [entry],
    outfile: "local.js",
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "SuiteLocal",
    target: "es2022",
    metafile: true,
    sourcemap: false,
    logLevel: "silent",
    plugins: [
      {
        name: "suite-local-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (!args.importer || !inside(args.importer)) return;
            if (args.path.startsWith(".")) {
              if (!inside(resolve(dirname(args.importer), args.path)))
                return {
                  errors: [
                    { text: "Local imports must stay inside the module." },
                  ],
                };
            } else if (
              !/^@suite\/module-sdk(?:\/(local|registry))?$/.test(args.path)
            )
              return {
                errors: [
                  {
                    text: `Unsupported local import ${args.path}. Use module-local source and the public local SDK.`,
                  },
                ],
              };
          });
          builder.onLoad(
            { filter: /\.[cm]?[jt]sx?$/, namespace: "file" },
            async (args) => {
              if (inside(args.path) && !inside(await realpath(args.path)))
                return {
                  errors: [
                    {
                      text: "Symlinked local source must stay inside the module.",
                    },
                  ],
                };
            },
          );
        },
      },
    ],
  });
  if (
    result.outputFiles.length !== 1 ||
    Object.values(result.metafile.outputs).some((output) =>
      output.imports.some((item) => item.external),
    )
  )
    throw Error(
      "Local handlers must produce one self-contained JavaScript bundle.",
    );
  const bundle: LocalBundle = {
    format: "suite-local-v1",
    javascript: `${result.outputFiles[0].text}\nexport default SuiteLocal.default;\n`,
  };
  validateLocalArtifact({ ...module, local: bundle });
  return bundle;
}
