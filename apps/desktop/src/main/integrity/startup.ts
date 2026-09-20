import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  inspectAssets,
  type AssetManifest,
  type IntegrityFailure,
} from "./assets";
import { IntegrityJournal } from "./journal";

const execute = promisify(execFile);
export async function checkApplicationIntegrity(options: {
  assets: string;
  manifest: AssetManifest;
  profile: string;
  release: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  appPath: string;
  beforeRecovery?(): Promise<void>;
}): Promise<
  | { allowed: true }
  | { allowed: false; reason: IntegrityFailure["code"] | "audit-unavailable" }
> {
  let failure: IntegrityFailure | undefined;
  const macSignedNative = options.packaged && options.platform === "darwin";
  if (macSignedNative) {
    try {
      if (!options.appPath.endsWith(".app/Contents/Resources/app.asar"))
        throw Error("Invalid bundle layout.");
      await execute(
        "/usr/bin/codesign",
        [
          "--verify",
          "--deep",
          "--strict",
          resolve(options.appPath, "../../.."),
        ],
        { timeout: 30000, maxBuffer: 8192 },
      );
    } catch {
      failure = { code: "invalid-signature" };
    }
  }
  failure ??= await inspectAssets(
    options.assets,
    options.manifest,
    macSignedNative && !failure,
  );
  try {
    await new IntegrityJournal(
      resolve(options.profile, "integrity"),
      options.release,
    ).record(failure, options.beforeRecovery);
  } catch {
    return { allowed: false, reason: "audit-unavailable" };
  }
  return failure ? { allowed: false, reason: failure.code } : { allowed: true };
}
