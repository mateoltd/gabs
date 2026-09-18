# Recovery metadata ordering

Status: checkpointed implementation; final acceptance pending.

OFF-01-EXPORT: a successful metadata response started under an older policy could arrive after restored authority and trigger revocation of the newer policy. A controlled native test holds an exact authenticated catalog response across permission removal/restoration, delivers it offline, restarts the process and exercises original saved-work export.

The controlled test failed twice before the fix with `Reconnect to authorize recovery export.` Native recovery now classifies superseded successful metadata separately. Current malformed metadata and actual HTTP 401/403/426 responses still revoke recovery authority.

Checkpoint evidence:

- Nineteen focused native authority tests pass, including stale catalog/artifact responses, malformed current metadata and real denials.
- Strict TypeScript environment checks, boundaries/copy checks and four build tasks pass (desktop fresh; three valid cached).
- Six hidden/unfocused native runs pass: the deterministic stale-response case and existing uninstalled-resource case, each repeated three times.
- Logs: `/tmp/gabs-export-order-before-exact.log`, `/tmp/gabs-export-order-unit.log`, `/tmp/gabs-export-order-build.log`, `/tmp/gabs-export-order-native-repeat.log`.

The two captures are from the repeated native runs; visual inspection and broader native/unit acceptance remain pending. This checkpoint does not close OFF-01-EXPORT, OFF-01, profile recovery or full parity.
