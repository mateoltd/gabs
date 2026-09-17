import { build } from "esbuild";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import type { ModuleDefinition } from "../src/index";
import {
  validateClientArtifacts,
  type ClientBundles,
} from "../src/client-artifact";
import { viewReactExports, viewUIExports } from "../src/ui";

export async function buildClientViews(
  module: ModuleDefinition,
  directory: string,
) {
  const root = await realpath(directory);
  const inside = (path: string) => {
    const part = relative(root, path);
    return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
  };
  const source = async (path: string) => {
    const absolute = await realpath(resolve(root, path));
    if (!inside(absolute))
      throw Error(`Custom view source escapes the module: ${path}`);
    return absolute;
  };
  const shims: Record<string, string> = {
    react: `const React = __suiteHost.react; export default React; export const {${viewReactExports.join(",")}} = React;`,
    "react/jsx-runtime": "export const {jsx,jsxs,Fragment} = __suiteHost.jsx;",
    "@suite/ui-web": `export const {${viewUIExports.join(",")}} = __suiteHost.ui;`,
  };
  const bundles: ClientBundles = {};
  for (const [name, view] of Object.entries(module.views ?? {})) {
    const result = await build({
      entryPoints: [await source(view.entry)],
      outfile: "view.js",
      write: false,
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "SuiteView",
      target: "es2022",
      jsx: "automatic",
      metafile: true,
      sourcemap: false,
      logLevel: "silent",
      plugins: [
        {
          name: "suite-view-host-v1",
          setup(builder) {
            builder.onResolve(
              { filter: /^(react(?:\/.*)?|@suite\/ui-web(?:\/.*)?)$/ },
              (args) => {
                if (!shims[args.path])
                  return {
                    errors: [
                      {
                        text: `Unsupported host import ${args.path}. Use the suite-view-v1 public UI contract.`,
                      },
                    ],
                  };
                return { path: args.path, namespace: "suite-host" };
              },
            );
            builder.onLoad(
              { filter: /.*/, namespace: "suite-host" },
              (args) => ({ contents: shims[args.path], loader: "js" }),
            );
            builder.onResolve({ filter: /.*/ }, async (args) => {
              if (!args.importer || !inside(args.importer)) return;
              if (args.path.startsWith(".")) {
                if (!inside(resolve(dirname(args.importer), args.path)))
                  return {
                    errors: [
                      { text: "Relative imports must stay inside the module." },
                    ],
                  };
              } else if (
                !/^@suite\/module-sdk(?:\/(?:ui|forms|references|queries))?$/.test(
                  args.path,
                )
              ) {
                return {
                  errors: [
                    {
                      text: `Unsupported module import ${args.path}. Use local source, React, @suite/module-sdk/ui, @suite/module-sdk/forms, @suite/module-sdk/references or the public host UI kit.`,
                    },
                  ],
                };
              }
            });
            builder.onLoad(
              { filter: /\.[cm]?[jt]sx?$/, namespace: "file" },
              async (args) => {
                if (inside(args.path) && !inside(await realpath(args.path)))
                  return {
                    errors: [
                      {
                        text: "Symlinked view source must stay inside the module.",
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
      Object.values(result.metafile.outputs).some((output) =>
        output.imports.some((i) => i.external),
      )
    )
      throw Error(`View ${name} has unresolved runtime dependencies.`);
    const js = result.outputFiles.find((file) => file.path.endsWith(".js"));
    if (
      !js ||
      result.outputFiles.some((file) => !/\.(js|css)$/.test(file.path))
    )
      throw Error(
        `View ${name} must produce only self-contained JavaScript and CSS.`,
      );
    const css = [
      ...result.outputFiles
        .filter((file) => file.path.endsWith(".css"))
        .map((file) => file.text),
      view.stylesheet
        ? await readFile(await source(view.stylesheet), "utf8")
        : "",
    ].join("\n");
    if (/@import\b|url\s*\(/i.test(css))
      throw Error(
        `View ${name} CSS must be self-contained; external imports and URLs are unsupported.`,
      );
    bundles[name] = {
      format: view.state ? "suite-view-v2" : "suite-view-v1",
      javascript: `export function createView(__suiteHost) {\n${js.text}\nreturn SuiteView.default;\n}\n`,
      css,
    };
  }
  validateClientArtifacts({ ...module, client: bundles });
  return bundles;
}
