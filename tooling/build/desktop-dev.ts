import { spawn } from "node:child_process";
const child = spawn("pnpm", ["--filter", "@suite/desktop", "start"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUITE_DESKTOP_DEV_AUTH: process.env.AUTH_MODE === "development" ? "1" : "0",
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
