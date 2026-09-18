# Recovery metadata ordering

Status: OFF-01-EXPORT locally verified, 19 September 2026. Broader OFF-01 and profile recovery remain open.

OFF-01-EXPORT: a successful metadata response started under an older policy could arrive after restored authority and trigger revocation of the newer policy. A controlled native test holds an exact authenticated catalog response across permission removal/restoration, delivers it offline, restarts the process and exercises original saved-work export.

The controlled test failed twice before the fix with `Reconnect to authorize recovery export.` Native recovery now classifies superseded successful metadata separately. Current malformed metadata and actual HTTP 401/403/426 responses still revoke recovery authority.

Verification sequence:

- Nineteen focused native authority tests pass, including stale catalog/artifact responses, malformed current metadata and real denials.
- Strict TypeScript environment checks, boundaries/copy checks and four build tasks pass (desktop fresh; three valid cached).
- All fourteen hidden/unfocused native command-correction journeys passed together on the checkpointed recovery implementation, before the subsequent synchronization ownership move. Log: `/tmp/gabs-export-order-native-acceptance.log`.
- Six hidden/unfocused native runs pass: the deterministic stale-response case and existing uninstalled-resource case, each repeated three times.
- Logs: `/tmp/gabs-export-order-before-exact.log`, `/tmp/gabs-export-order-unit.log`, `/tmp/gabs-export-order-build.log`, `/tmp/gabs-export-order-native-repeat.log`.

The two wide/narrow captures from the repeated native runs were inspected: saved inputs remain legible, comparison fields wrap, and export actions stay within the scrollable dialog. No UI or style source changed. After the synchronization ownership move, full unit/PostgreSQL regression passed 540 tests across 88 files (`/tmp/gabs-architecture-sync-regression.log`), and strict checks plus all four fresh production builds passed (`/tmp/gabs-architecture-sync-build.log`). Final-source acceptance passed three headless browser journeys and five hidden/unfocused native journeys, including the controlled stale-response and resource-uninstalled cases (`/tmp/gabs-architecture-sync-web.log`, `/tmp/gabs-architecture-sync-native.log`). OFF-01-EXPORT is locally verified. OFF-01, profile/session recovery and full parity remain open.
