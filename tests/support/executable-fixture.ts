import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { signPackage } from "../../packages/sdk/node/signing";
import {
  moduleContract,
  validateClientArtifacts,
} from "@suite/module-sdk/client-artifact";
import type { ViewHostRequirements } from "@suite/module-sdk/host-ui";
import type { SignedArtifact } from "@suite/module-sdk/platform";

/** Every acceptance publication is immutable, including after fixture source changes. */
export async function publishExecutableFixture(
  options: {
    id?: string;
    name?: string;
    requiredPrefix?: boolean;
    hostRequirements?: ViewHostRequirements;
    sourceDirectory?: string;
    transform?: (filename: string, source: string) => string;
  } = {},
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
      const sourcePath = `${options.sourceDirectory ?? "tests/fixtures/custom-notes"}/${name}`;
      // Generated-only fixtures have no custom client view to copy.
      if (
        (name === "view.tsx" || name === "view.css") &&
        !existsSync(sourcePath)
      )
        continue;
      let source = await readFile(sourcePath, "utf8");
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
      if (options.transform) source = options.transform(name, source);
      await writeFile(resolve(directory, name), source);
    }
    execFileSync("pnpm", ["module", "build", directory], { stdio: "pipe" });
    const artifactPath = `.local/modules/${id}-${version}.json`;
    if (options.hostRequirements) {
      const built = JSON.parse(
        await readFile(artifactPath, "utf8"),
      ) as SignedArtifact;
      const client = validateClientArtifacts(built.artifact);
      for (const bundle of Object.values(client))
        bundle.requires = options.hostRequirements;
      const key = await readFile(
        resolve(
          process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys",
          "private.pem",
        ),
        "utf8",
      );
      await writeFile(
        artifactPath,
        JSON.stringify(
          signPackage(moduleContract(built.artifact), key, client),
        ),
      );
    }
    const serverPath = artifactPath.replace(".json", ".server.json");
    const submission = execFileSync(
      "pnpm",
      [
        "module",
        "submit",
        artifactPath,
        ...(existsSync(serverPath) ? [serverPath] : []),
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
