import { publishExecutableFixture } from "./executable-fixture";

/** New releases are built, reviewed and staged through the public module CLI. */
export function publishEditableFixture(
  id: string,
  name: string,
  stateVersion: 1 | 2 = 1,
  invalidRestore = false,
  renderFailure = false,
) {
  return publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/editable-notes",
    transform: (filename, source) => {
      if (stateVersion === 1) return source;
      if (filename === "module.ts")
        return source
          .replace("version: 1,", "version: 2,")
          .replace(
            "{ name: field.text() },",
            "{ title: field.text(), category: field.text() },",
          );
      if (filename !== "view.tsx") return source;
      if (renderFailure)
        source = source.replace(
          "const name =",
          'throw Error("Fixture render failure"); const name =',
        );
      return source
        .replace("state.value?.name", "state.value?.title")
        .replace(
          "state.save({ name })",
          'state.save({ title: name, category: state.value?.category ?? "New" })',
        )
        .replace(
          '<Field label="Note name">',
          '<Field label="Category"><Input value={state.value?.category ?? "New"} onChange={event => state.save({ title: name, category: event.target.value })} /></Field><Field label="Note name">',
        )
        .replace(
          /\},\s*\);\s*$/,
          `}, { restore: ({ version, value }) => {
          if (version !== 1 || !value || typeof value !== "object" || !("name" in value) || typeof value.name !== "string") throw Error("Unsupported source input");
          ${invalidRestore ? "return { title: 42 } as never;" : 'return { title: value.name, category: "Restored input" };'}
        } });`,
        );
    },
  });
}
