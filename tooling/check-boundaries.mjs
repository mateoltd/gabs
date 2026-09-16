import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
const root = process.cwd(),
  issues = [],
  graph = new Map();
async function walk(path) {
  const out = [];
  for (const e of await readdir(path, { withFileTypes: true })) {
    if (["node_modules", "dist", "out", ".git"].includes(e.name)) continue;
    const p = resolve(path, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(tsx?|mjs|cjs)$/.test(p) && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
for (const group of ["apps", "packages", "modules"])
  for (const file of await walk(resolve(root, group))) {
    const name = relative(root, file),
      source = ts.createSourceFile(
        name,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      ),
      domain = /^modules\/[^/]+\/domain\//.test(name),
      browser =
        /^(apps\/web|packages\/(app-web|ui-web)|modules\/[^/]+\/web)\//.test(
          name,
        ) || /apps\/desktop\/src\/renderer/.test(name),
      owner = name.match(/^modules\/([^/]+)/)?.[1];
    const inspect = (node) => {
      const moduleNode =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) &&
              node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined;
      if (moduleNode && ts.isStringLiteral(moduleNode)) {
        const spec = moduleNode.text,
          target = spec.startsWith(".")
            ? relative(root, resolve(dirname(file), spec))
            : spec;
        if (
          domain &&
          (!spec.startsWith(".") || target.includes("/server")) &&
          !spec.endsWith("/domain") &&
          spec !== "@suite/contracts"
        )
          issues.push(`${name}: domain dependency ${spec}`);
        if (
          browser &&
          /(^node:|electron|server-core|\/server(?:\/|$)|kysely|^pg$)/.test(
            target,
          )
        )
          issues.push(`${name}: server/native import in browser ${spec}`);
        const other = spec.match(/^@suite\/(orders|inventory)\/(.+)/);
        if (owner && other && other[1] !== owner) {
          if (!["server", "contracts", "domain"].includes(other[2]))
            issues.push(`${name}: private module import ${spec}`);
          const deps = graph.get(owner) || new Set();
          deps.add(other[1]);
          graph.set(owner, deps);
        }
        if (
          owner &&
          spec.startsWith(".") &&
          target.startsWith("modules/") &&
          !target.startsWith(`modules/${owner}/`)
        )
          issues.push(`${name}: relative cross-module import`);
      }
      if (
        domain &&
        ts.isIdentifier(node) &&
        ["window", "document", "navigator", "localStorage", "process"].includes(
          node.text,
        )
      )
        issues.push(`${name}: platform global ${node.text}`);
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
function visit(n, path = []) {
  if (path.includes(n)) {
    issues.push(`Module cycle: ${[...path, n].join(" -> ")}`);
    return;
  }
  for (const dep of graph.get(n) || []) visit(dep, [...path, n]);
}
for (const n of graph.keys()) visit(n);
if (issues.length) {
  console.error([...new Set(issues)].join("\n"));
  process.exit(1);
}
console.log("Domain, browser, and module dependency boundaries passed.");
