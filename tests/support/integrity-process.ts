import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("apps/desktop/package.json"));

export function launchIntegrityProbe(
  entry: string,
  profile: string,
  args: string[] = [],
) {
  return new Promise<{ code: number | null; output: string; stdout: string }>(
    (resolveRun, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
      };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        require("electron"),
        [entry, `--user-data-dir=${profile}`, ...args],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "",
        stdout = "";
      child.stdout.on("data", (bytes) => {
        output += bytes;
        stdout += bytes;
      });
      child.stderr.on("data", (bytes) => {
        output += bytes;
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (signal)
          reject(
            Error(`Desktop exited with ${signal}: ${output.slice(-1500)}`),
          );
        else resolveRun({ code, output, stdout });
      });
    },
  );
}
