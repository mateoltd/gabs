import { writeFile, appendFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
const dir = await mkdtemp(join(process.env.RUNNER_TEMP, "common-signing-"));
async function secret(name, filename) {
  if (!process.env[name])
    throw Error(`Required signing secret ${name} is missing`);
  const path = join(dir, filename);
  await writeFile(path, Buffer.from(process.env[name], "base64"), {
    mode: 0o600,
  });
  return path;
}
if (process.platform === "darwin") {
  const cert = await secret("APPLE_CERT_BASE64", "developer.p12"),
    key = await secret("APPLE_NOTARY_KEY_BASE64", "notary.p8"),
    chain = join(dir, "build.keychain-db"),
    password = randomBytes(32).toString("hex");
  execFileSync("security", ["create-keychain", "-p", password, chain], {
    stdio: "ignore",
  });
  execFileSync("security", ["set-keychain-settings", "-lut", "21600", chain], {
    stdio: "ignore",
  });
  execFileSync("security", ["unlock-keychain", "-p", password, chain], {
    stdio: "ignore",
  });
  execFileSync(
    "security",
    [
      "import",
      cert,
      "-P",
      process.env.APPLE_CERT_PASSWORD ?? "",
      "-A",
      "-t",
      "cert",
      "-f",
      "pkcs12",
      "-k",
      chain,
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    "security",
    [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-k",
      password,
      chain,
    ],
    { stdio: "ignore" },
  );
  execFileSync("security", ["list-keychains", "-d", "user", "-s", chain], {
    stdio: "ignore",
  });
  await appendFile(process.env.GITHUB_ENV, `APPLE_API_KEY=${key}\n`);
} else if (process.platform === "win32") {
  const path = await secret("WINDOWS_CERT_BASE64", "windows.pfx");
  await appendFile(process.env.GITHUB_ENV, `WINDOWS_CERT_FILE=${path}\n`);
}
