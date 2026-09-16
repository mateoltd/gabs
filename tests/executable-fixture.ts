import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { SignedArtifact } from "@suite/module-sdk/platform";

/** Every acceptance publication is immutable, including after fixture source changes. */
export async function publishExecutableFixture(): Promise<SignedArtifact> {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/executable-fixture-"));
  const version = `1.0.${Date.now()}`;
  try {
    for (const name of ["module.ts", "view.tsx", "view.css"]) {
      let source = await readFile(
        `tests/fixtures/custom-notes/${name}`,
        "utf8",
      );
      if (name === "module.ts")
        source = source.replace('version: "1.0.0"', `version: "${version}"`);
      await writeFile(resolve(directory, name), source);
    }
    execFileSync("pnpm", ["module", "build", directory], { stdio: "pipe" });
    const artifactPath = `.local/modules/custom-notes-${version}.json`;
    execFileSync("pnpm", ["module", "publish", artifactPath], {
      stdio: "pipe",
    });
    return JSON.parse(await readFile(artifactPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
