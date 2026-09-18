import { moduleSchemaFormats } from "../src/authoring/formats";
import ts from "typescript";
import {
  assertViewHost,
  viewHostExports,
  type ViewHostRequirements,
} from "../src/contracts/host-ui";
import { build } from "esbuild";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import type { ModuleDefinition } from "../src/index";
import {
  validateClientArtifacts,
  type ClientBundles,
} from "../src/contracts/client-artifact";
import { viewReactExports, viewUIExports } from "../src/contracts/ui";

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
                !/^@suite\/module-sdk(?:\/(?:ui|forms|references|queries|relay))?$/.test(
                  args.path,
                )
              ) {
                return {
                  errors: [
                    {
                      text: `Unsupported module import ${args.path}. Use local source, React, @suite/module-sdk/ui, @suite/module-sdk/forms, @suite/module-sdk/references, @suite/module-sdk/queries, @suite/module-sdk/relay or the public host UI kit.`,
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
    const requires = {
      ...(await requiredHostContracts(result.metafile.inputs)),
    };
    if (
      Object.values(module.operations).some(
        (op) =>
          op.policy === "queued" && op.kind !== "query" && !op.serviceOnly,
      )
    )
      requires["client.queue"] = 1;
    if (moduleSchemaFormats(module).size) requires["client.formats"] = 1;
    if (Object.keys(module.capabilities ?? {}).length)
      requires["client.host"] = Object.values(module.capabilities ?? {}).some(
        (capability) =>
          capability.offline === "lease" && capability.kind.startsWith("lan."),
      )
        ? 2
        : 1;
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
      javascript: `export function createView(__suiteHost) {\n(${assertViewHost.toString()})(${JSON.stringify(requires)}, __suiteHost.capabilities);\n${js.text}\nreturn SuiteView.default;\n}\n`,
      css,
      requires,
    };
  }
  validateClientArtifacts({ ...module, client: bundles });
  return bundles;
}

/** Analyze emitted value imports, including reexports and namespace/dynamic imports. */
async function requiredHostContracts(
  inputs: Record<string, unknown>,
): Promise<ViewHostRequirements> {
  const required: Record<string, number> = {
    "view.context": 1,
    "client.resources": 3,
  };
  const imports = {
    react: "react",
    "react/jsx-runtime": "jsx",
    "@suite/ui-web": "ui",
  } as const;
  const used = new Set(Object.keys(inputs));
  const add = (path: string, names?: string[]) => {
    const namespace = imports[path as keyof typeof imports];
    if (!namespace || !used.has(`suite-host:${path}`)) return;
    const known: readonly string[] = viewHostExports[namespace];
    if (namespace === "react" && names?.includes("default")) names = undefined;
    for (const name of names ?? known) {
      if (!known.includes(name))
        throw Error(
          `Unsupported host export ${path}: ${name}. Use the public host UI contract.`,
        );
      required[`${namespace}.${name}`] = 1;
    }
  };
  add("react/jsx-runtime");
  for (const path of used) {
    if (path.startsWith("suite-host:") || !/\.[cm]?[jt]sx?$/.test(path))
      continue;
    const output = ts.transpileModule(await readFile(path, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
      },
      fileName: path,
    }).outputText;
    const source = ts.createSourceFile(
      path,
      output,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        add(
          node.moduleSpecifier.text,
          clause?.name || (bindings && ts.isNamespaceImport(bindings))
            ? undefined
            : bindings && ts.isNamedImports(bindings)
              ? bindings.elements.map((e) => (e.propertyName ?? e.name).text)
              : [],
        );
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        add(
          node.moduleSpecifier.text,
          node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map(
                (e) => (e.propertyName ?? e.name).text,
              )
            : undefined,
        );
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return required;
}
