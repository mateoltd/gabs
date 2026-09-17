import ts from "typescript";
import { builtinModules } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const codePattern = /\.(?:[cm]?[jt]sx?)$/;
const sourcePattern = /\.(?:[cm]?[jt]sx?|css)$/;
const ignoredDirectories = new Set([
  ".git",
  ".turbo",
  "dist",
  "node_modules",
  "out",
]);
const sourceExtensions = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".d.ts",
  ".json",
  ".css",
];
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function walk(directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function normalized(root, path) {
  return relative(root, path).split(sep).join("/");
}

function packageDirectories(root) {
  const manifests = [];
  for (const group of ["apps", "packages", "modules"]) {
    const directory = join(root, group);
    if (!existsSync(directory)) continue;
    for (const path of walk(directory, (file) => file.endsWith("package.json")))
      manifests.push(path);
  }
  const composition = join(root, "composition", "package.json");
  if (existsSync(composition)) manifests.push(composition);
  const workspace = join(root, "package.json");
  if (existsSync(workspace)) manifests.push(workspace);
  return manifests.map((manifest) => {
    const data = JSON.parse(readFileSync(manifest, "utf8"));
    return {
      root: dirname(manifest),
      relativeRoot: normalized(root, dirname(manifest)),
      name: data.name,
      exports: data.exports,
      dependencies: new Set([
        ...Object.keys(data.dependencies ?? {}),
        ...Object.keys(data.devDependencies ?? {}),
        ...Object.keys(data.peerDependencies ?? {}),
        ...Object.keys(data.optionalDependencies ?? {}),
      ]),
    };
  });
}

function ownerOf(packages, file) {
  return packages
    .filter((pkg) => file === pkg.root || file.startsWith(`${pkg.root}${sep}`))
    .sort((a, b) => b.root.length - a.root.length)[0];
}

function layerOf(pkg) {
  if (!pkg) return "unknown";
  const path = pkg.relativeRoot;
  if (path === "composition") return "composition";
  if (path.startsWith("apps/")) return "app";
  if (path.startsWith("modules/")) return "module";
  if (path === "packages/contracts") return "contracts";
  if (path === "packages/sdk") return "sdk";
  if (path === "packages/client") return "client";
  if (path === "packages/server") return "server";
  if (path === "packages/shell") return "shell";
  if (path === "packages/ui/web") return "ui-web";
  if (path === "packages/ui/tokens") return "ui-tokens";
  return "package";
}

function exportedTarget(exports, subpath) {
  if (typeof exports === "string") return subpath === "." ? exports : undefined;
  if (!exports || typeof exports !== "object") return undefined;
  let value = exports[subpath];
  let patternMatch;
  if (value === undefined) {
    for (const [pattern, candidate] of Object.entries(exports)) {
      if (!pattern.includes("*")) continue;
      const [before, after] = pattern.split("*");
      if (!subpath.startsWith(before) || !subpath.endsWith(after)) continue;
      patternMatch = subpath.slice(
        before.length,
        subpath.length - after.length,
      );
      value = candidate;
      break;
    }
  }
  while (value && typeof value === "object")
    value =
      value.import ?? value.default ?? value.types ?? Object.values(value)[0];
  return typeof value === "string"
    ? patternMatch === undefined
      ? value
      : value.replaceAll("*", patternMatch)
    : undefined;
}

function resolveFile(candidate) {
  const clean = candidate.split(/[?#]/)[0];
  for (const suffix of sourceExtensions) {
    const file = `${clean}${suffix}`;
    if (existsSync(file) && statSync(file).isFile()) return resolve(file);
  }
  if (extname(clean) === ".js" || extname(clean) === ".jsx") {
    const base = clean.slice(0, -extname(clean).length);
    for (const suffix of [".ts", ".tsx", ".mts", ".cts"]) {
      const file = `${base}${suffix}`;
      if (existsSync(file) && statSync(file).isFile()) return resolve(file);
    }
  }
  for (const suffix of sourceExtensions.slice(1)) {
    const file = join(clean, `index${suffix}`);
    if (existsSync(file) && statSync(file).isFile()) return resolve(file);
  }
}

function workspacePackage(packagesByName, specifier) {
  return [...packagesByName.values()]
    .filter(
      (pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`),
    )
    .sort((a, b) => b.name.length - a.name.length)[0];
}

function importTypeOnly(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    if (clause.name) return false;
    return (
      clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)
    );
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true;
    return (
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly)
    );
  }
  return false;
}

function importsIn(source) {
  const imports = [];
  const inspect = (node) => {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    )
      specifier = node.arguments[0];
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      specifier = node.moduleReference.expression;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    }
    if (specifier && ts.isStringLiteralLike(specifier))
      imports.push({
        specifier: specifier.text,
        typeOnly: ts.isImportTypeNode(node) || importTypeOnly(node),
      });
    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return imports;
}

function cssImports(text) {
  return [...text.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)].map(
    (match) => ({ specifier: match[1], typeOnly: false }),
  );
}

function isNodeDependency(specifier) {
  const nodePackages = ["electron", "pg", "kysely", "openid-client", "fastify"];
  return (
    specifier.startsWith("node:") ||
    nodeBuiltins.has(specifier) ||
    nodePackages.some(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    ) ||
    specifier.startsWith("@fastify/") ||
    specifier.startsWith("@aws-sdk/")
  );
}

function isDomDependency(specifier) {
  return (
    ["react", "react-dom", "react-router"].some(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    ) ||
    specifier.startsWith("@base-ui/") ||
    specifier.startsWith("@radix-ui/") ||
    specifier.startsWith("@hugeicons/") ||
    specifier.startsWith("@phosphor-icons/")
  );
}

function isNodeFile(root, file) {
  const name = normalized(root, file);
  return (
    name.startsWith("packages/server/") ||
    name.startsWith("packages/sdk/node/") ||
    name.startsWith("apps/api/") ||
    name.startsWith("apps/worker/") ||
    name.startsWith("apps/desktop/src/main/") ||
    name.startsWith("apps/desktop/src/preload/") ||
    name.startsWith("apps/desktop/src/utility/") ||
    name.startsWith("tooling/") ||
    name.startsWith("composition/src/server/") ||
    name === "composition/src/catalog/server.ts" ||
    /^modules\/[^/]+\/(?:server\/|module-server\.|releases\/[^/]+\/module-server\.)/.test(
      name,
    )
  );
}

function browserEntry(root, file) {
  const name = normalized(root, file);
  return (
    name.startsWith("apps/web/src/") ||
    name.startsWith("apps/desktop/src/renderer/") ||
    name.startsWith("packages/shell/") ||
    name.startsWith("packages/ui/web/") ||
    name.startsWith("packages/client/") ||
    /^modules\/[^/]+\/web\//.test(name) ||
    name === "composition/src/web/shell.tsx"
  );
}

function isDomFile(root, file) {
  const name = normalized(root, file);
  return (
    name.startsWith("apps/web/src/") ||
    name.startsWith("apps/desktop/src/renderer/") ||
    name.startsWith("packages/shell/") ||
    name.startsWith("packages/ui/web/") ||
    /^modules\/[^/]+\/web\//.test(name) ||
    name === "composition/src/web/shell.tsx"
  );
}

function workerEntry(root, file) {
  const name = normalized(root, file);
  return (
    name === "composition/src/local/worker-entry.ts" ||
    /^modules\/[^/]+\/(?:local\/|module-local\.)/.test(name)
  );
}

function portableEntry(root, file) {
  const name = normalized(root, file);
  return (
    name.startsWith("packages/contracts/src/") ||
    name.startsWith("packages/sdk/src/")
  );
}

function allowedLayer(sourceLayer, targetLayer) {
  const allowed = {
    contracts: new Set(),
    sdk: new Set(),
    client: new Set(["contracts", "sdk"]),
    server: new Set(["contracts", "sdk"]),
    shell: new Set(["client", "contracts", "sdk", "ui-web", "ui-tokens"]),
    module: new Set(["client", "contracts", "sdk", "ui-web", "ui-tokens"]),
    "ui-web": new Set(["contracts", "sdk", "ui-tokens"]),
    "ui-tokens": new Set(),
  }[sourceLayer];
  return !allowed || allowed.has(targetLayer);
}

function moduleId(pkg) {
  return pkg?.relativeRoot.match(/^modules\/([^/]+)$/)?.[1];
}

function isLegacyInventoryBridge(root, source, specifier) {
  return (
    normalized(root, source) ===
      "modules/orders/server/legacy-inventory-adapter.ts" &&
    specifier === "@suite/inventory/server"
  );
}

function isLegacyServerBridge(root, source, specifier) {
  if (specifier !== "@suite/server-core") return false;
  return /^(?:modules\/(?:orders|inventory)\/server\/(?:index|inventory-service)\.ts|modules\/orders\/releases\/1\.1\.0\/module-server\.ts|modules\/inventory\/releases\/(?:1\.1\.0|1\.2\.0)\/module-server\.ts)$/.test(
    normalized(root, source),
  );
}

export function analyzeArchitecture(projectRoot) {
  const root = resolve(projectRoot);
  const packages = packageDirectories(root);
  const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const files = [
    "apps",
    "packages",
    "modules",
    "composition",
    "tooling",
  ].flatMap((group) =>
    walk(join(root, group), (file) => sourcePattern.test(file)),
  );
  const issues = [];
  const runtimeGraph = new Map();
  const packageGraph = new Map();
  const report = (message) => issues.push(message);

  for (const file of files) {
    const name = normalized(root, file);
    const text = readFileSync(file, "utf8");
    const source = codePattern.test(file)
      ? ts.createSourceFile(
          name,
          text,
          ts.ScriptTarget.Latest,
          true,
          file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        )
      : undefined;
    runtimeGraph.set(file, []);
    const owner = ownerOf(packages, file);
    const sourceLayer = layerOf(owner);
    const ownerModule = moduleId(owner);
    const domain = /^modules\/[^/]+\/domain\//.test(name);

    for (const imported of source ? importsIn(source) : cssImports(text)) {
      const { specifier, typeOnly } = imported;
      const resolvedSpecifier = specifier.split(/[?#]/)[0];
      let target;
      let targetOwner;
      if (resolvedSpecifier.startsWith(".")) {
        target = resolveFile(resolve(dirname(file), resolvedSpecifier));
        if (!target) {
          report(`${name}: unresolved internal import ${specifier}`);
          continue;
        }
        targetOwner = ownerOf(packages, target);
        if (owner && targetOwner && owner !== targetOwner) {
          report(
            `${name}: private relative import crosses package boundary ${specifier}`,
          );
          if (!owner.dependencies.has(targetOwner.name))
            report(
              `${name}: undeclared workspace dependency ${targetOwner.name}`,
            );
        }
      } else {
        targetOwner = workspacePackage(packagesByName, resolvedSpecifier);
        if (targetOwner) {
          const subpath =
            resolvedSpecifier === targetOwner.name
              ? "."
              : `.${resolvedSpecifier.slice(targetOwner.name.length)}`;
          const exported = exportedTarget(targetOwner.exports, subpath);
          if (!exported) {
            report(
              `${name}: workspace import is not publicly exported ${specifier}`,
            );
            continue;
          }
          target = resolveFile(resolve(targetOwner.root, exported));
          if (!target) {
            report(
              `${name}: workspace export does not resolve ${specifier} -> ${exported}`,
            );
            continue;
          }
          if (
            owner &&
            owner !== targetOwner &&
            !owner.dependencies.has(targetOwner.name)
          )
            report(
              `${name}: undeclared workspace dependency ${targetOwner.name}`,
            );
        } else if (resolvedSpecifier.startsWith("@suite/")) {
          report(`${name}: unresolved internal package import ${specifier}`);
          continue;
        }
      }

      if (domain) {
        const sameModule = targetOwner && targetOwner === owner;
        if (!sameModule && specifier !== "@suite/contracts")
          report(`${name}: domain dependency ${specifier}`);
      }

      if (targetOwner && owner && owner !== targetOwner) {
        const targetLayer = layerOf(targetOwner);
        const targetModule = moduleId(targetOwner);
        const publicTypeContract =
          !!ownerModule &&
          !!targetModule &&
          typeOnly &&
          /\/(?:contracts|domain)$/.test(resolvedSpecifier);
        if (
          !allowedLayer(sourceLayer, targetLayer) &&
          !publicTypeContract &&
          !isLegacyServerBridge(root, file, resolvedSpecifier) &&
          !isLegacyInventoryBridge(root, file, resolvedSpecifier)
        )
          report(
            `${name}: ${sourceLayer} package cannot depend on ${targetLayer} package ${targetOwner.name}`,
          );
        if (ownerModule && targetModule && ownerModule !== targetModule) {
          if (
            !publicTypeContract &&
            !isLegacyInventoryBridge(root, file, specifier)
          )
            report(
              `${name}: undeclared cross-module implementation dependency ${specifier}`,
            );
        }

        if (!typeOnly) {
          const dependencies = packageGraph.get(owner.name) ?? new Set();
          dependencies.add(targetOwner.name);
          packageGraph.set(owner.name, dependencies);
        }
      }

      if (!typeOnly) {
        if (target) runtimeGraph.get(file).push({ target, specifier });
        else if (isNodeDependency(specifier))
          runtimeGraph
            .get(file)
            .push({ target: `node:${specifier}`, specifier });
        else if (isDomDependency(specifier))
          runtimeGraph
            .get(file)
            .push({ target: `dom:${specifier}`, specifier });
      }
    }

    if (domain && source) {
      const inspectGlobal = (node) => {
        if (
          ts.isIdentifier(node) &&
          [
            "window",
            "document",
            "navigator",
            "localStorage",
            "process",
          ].includes(node.text) &&
          !(
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.name === node
          )
        )
          report(`${name}: platform global ${node.text}`);
        ts.forEachChild(node, inspectGlobal);
      };
      inspectGlobal(source);
    }
  }

  const cycleSeen = new Set();
  function findPackageCycle(name, path = []) {
    if (path.includes(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name].join(" -> ");
      if (!cycleSeen.has(cycle)) {
        cycleSeen.add(cycle);
        report(`Workspace dependency cycle: ${cycle}`);
      }
      return;
    }
    for (const dependency of packageGraph.get(name) ?? [])
      findPackageCycle(dependency, [...path, name]);
  }
  for (const name of packageGraph.keys()) findPackageCycle(name);

  const environmentEntries = files.filter(
    (file) =>
      browserEntry(root, file) ||
      workerEntry(root, file) ||
      portableEntry(root, file),
  );
  for (const entry of environmentEntries) {
    const environment = workerEntry(root, entry)
      ? "worker"
      : portableEntry(root, entry)
        ? "portable"
        : "browser";
    const seen = new Set();
    const visit = (file, chain) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const edge of runtimeGraph.get(file) ?? []) {
        const reachesNode =
          edge.target.startsWith("node:") || isNodeFile(root, edge.target);
        const reachesDom =
          edge.target.startsWith("dom:") || isDomFile(root, edge.target);
        const forbidden =
          reachesNode ||
          ((environment === "worker" || environment === "portable") &&
            reachesDom);
        if (forbidden) {
          const reason = !reachesNode && reachesDom ? "DOM/UI" : "Node/server";
          const path = [...chain, normalized(root, file), edge.specifier].join(
            " -> ",
          );
          report(
            `${normalized(root, entry)}: ${environment} runtime reaches ${reason} code via ${path}`,
          );
          continue;
        }
        if (runtimeGraph.has(edge.target))
          visit(edge.target, [...chain, normalized(root, file)]);
      }
    };
    visit(entry, []);
  }

  return [...new Set(issues)].sort();
}

export function assertArchitecture(projectRoot) {
  const issues = analyzeArchitecture(projectRoot);
  if (issues.length) throw new Error(issues.join("\n"));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const issues = analyzeArchitecture(process.cwd());
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      "Workspace exports, dependency layers, module boundaries, cycles, and runtime environments passed.",
    );
  }
}
