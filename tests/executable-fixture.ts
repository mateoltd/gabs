import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { SignedArtifact } from "@suite/module-sdk/platform";

/** Every acceptance publication is immutable, including after fixture source changes. */
export async function publishExecutableFixture(
  options: { id?: string; name?: string; requiredPrefix?: boolean } = {},
): Promise<SignedArtifact> {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/executable-fixture-"));
  const version = `1.0.${Date.now()}`;
  const id = options.id ?? "custom-notes";
  try {
    for (const name of [
      "module.ts",
      "module-server.ts",
      "view.tsx",
      "view.css",
    ]) {
      let source = await readFile(
        `tests/fixtures/custom-notes/${name}`,
        "utf8",
      );
      if (name === "module.ts")
        source = source.replace('version: "1.0.0"', `version: "${version}"`);
      source = source
        .replaceAll("custom-notes", id)
        .replaceAll("Custom notes", options.name ?? "Custom notes");
      if (options.requiredPrefix && name === "module.ts") {
        const configuration =
          "configuration: Type.Object({}, { additionalProperties: false }),";
        if (!source.includes(configuration))
          throw Error("Fixture configuration template changed.");
        source = source.replace(
          configuration,
          "configuration: Type.Object({ prefix: Type.String({ minLength: 1 }) }, { additionalProperties: false }),",
        );
      }
      if (options.requiredPrefix && name === "module-server.ts")
        source = source.replace(
          ".create(input)",
          ".create({ name: ctx.configuration.prefix + input.name })",
        );
      await writeFile(resolve(directory, name), source);
    }
    execFileSync("pnpm", ["module", "build", directory], { stdio: "pipe" });
    const artifactPath = `.local/modules/${id}-${version}.json`;
    const submission = execFileSync(
      "pnpm",
      [
        "module",
        "submit",
        artifactPath,
        artifactPath.replace(".json", ".server.json"),
      ],
      { encoding: "utf8", stdio: "pipe" },
    )
      .trim()
      .split("\n")
      .at(-1)!;
    execFileSync(
      "pnpm",
      [
        "module",
        "review",
        submission,
        "approve",
        "Reviewed local executable acceptance fixture",
      ],
      { stdio: "pipe" },
    );
    execFileSync("pnpm", ["module", "stage", submission], { stdio: "pipe" });
    execFileSync("pnpm", ["module", "publish", artifactPath], {
      stdio: "pipe",
    });
    return JSON.parse(await readFile(artifactPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
