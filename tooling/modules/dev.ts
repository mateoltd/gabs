import { moduleDirectory } from "./workspace";
import { startModuleDev } from "./module-dev/server";
import { dependencyDirectories } from "./simulation";
const name = process.argv[2];
if (!name) throw Error("Usage: pnpm module dev <module-id-or-directory>");
const server = await startModuleDev(
  moduleDirectory(name),
  Number(process.env.MODULE_DEV_PORT ?? 4321),
  dependencyDirectories(process.argv.slice(3)),
);
console.log(
  `Module development: ${server.origin}\nSource, view, configuration and fixture changes rebuild the isolated simulator. Each rebuild resets simulation data.`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
