import { readdir, readFile } from "node:fs/promises";
const issues = [];
async function check(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["dist", "node_modules", "out"].includes(entry.name)) continue;
    const file = `${path}/${entry.name}`;
    if (entry.isDirectory()) await check(file);
    else if (/\.(tsx|css)$/.test(file)) {
      const text = await readFile(file, "utf8");
      if (text.includes("\u00b7"))
        issues.push(`${file}: middle-dot copy separator`);
      if (/border-(left|right):\s*[3-9]\d*px/.test(text))
        issues.push(`${file}: decorative edge accent`);
    }
  }
}
for (const path of ["apps", "packages", "modules"]) await check(path);
if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log("UI copy and edge-accent checks passed.");
