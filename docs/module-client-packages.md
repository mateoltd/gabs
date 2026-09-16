# Executable module client contract (EXT-01)

## Package and host boundary

A module may declare named `views` with a title, entry file, optional stylesheet and declared permission. `navigation.view` selects its landing view. Declarative modules remain compatible. Each view is built into a self-contained `suite-view-v1` factory; its JavaScript and CSS bytes are embedded in the signed artifact. The package digest covers definitions and all executable bytes. Published versions remain immutable.

The factory receives the host React runtime and an allowlisted public UI kit. Modules author ordinary TSX with the typed `defineView(module, component)` API and receive a schema-inferred client plus workspace/permission/connectivity context. Bundling prevents duplicate React runtimes and rejects unsupported imports, escaped entry paths and additional runtime chunks. It does not sandbox reviewed code or prove that a publisher is safe.

The renderer re-verifies installed bytes before importing a temporary module URL. It never evaluates unsigned source, does not use `eval`, and revokes temporary URLs. The factory must return a React view. A local error boundary reports a broken view without losing the shell. Scope/version changes remount the view, and current server authorization remains mandatory. Offline custom requests fail explicitly until a durable execution contract can represent provisional results; they cannot return a fictitious accepted record.

Custom CSS and the host UI styles mount inside Shadow DOM with an explicit reset. Containment prevents accidental CSS leakage, not hostile JavaScript. The Electron content policy permits the verified blob-module loading path while retaining no Node access or unrestricted native capabilities. Installation, suspension, repair, version pins and data-preserving uninstall remain governed by the existing gate.

## Acceptance

Build an independently authored fifth module with custom TSX, sign/publish/install it without modifying host registries, save and reload a record, and show that host styles remain unchanged. Reject modified code/CSS, mismatched declarations, unknown formats and untrusted signatures. Verify typed contract failures and real browser/Electron execution. Complete update/pin/migration acceptance, failure-containment journeys and hosted trust rotation retain their separate lifecycle/framework gates. Custom queued offline execution remains open in SDK/OFF work; this implementation does not claim full framework acceptance.

## Reviewed server components

Custom views can call schema-inferred module operations through the same client. Modules with scoped server handlers now build a separate signed server package and follow the [submission/review/staging workflow](module-server-releases.md) before client publication. The browser never downloads the server package. The fifth-module fixture exercises this complete local path in Chromium and Electron.
