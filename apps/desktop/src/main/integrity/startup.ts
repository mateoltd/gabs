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
export interface ApplicationIntegrityOptions {
  assets: string;
  manifest: AssetManifest;
  profile: string;
  release: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  appPath: string;
}
export async function inspectApplication(
  options: ApplicationIntegrityOptions,
): Promise<IntegrityFailure | undefined> {
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
  return failure;
}
export async function checkApplicationIntegrity(
  options: ApplicationIntegrityOptions & {
    beforeRecovery?(): Promise<void>;
  },
): Promise<
  | { allowed: true }
  | { allowed: false; reason: IntegrityFailure["code"] | "audit-unavailable" }
> {
  const failure = await inspectApplication(options);
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
