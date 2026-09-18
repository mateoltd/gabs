# Saved-work export recovery

Status: locally verified OFF-01 milestone, 18 September 2026. Full OFF-01 and product parity remain active. Checkpoint `168834e` preserved the unfinished implementation before the independent architecture review; the acceptance below supersedes its partial evidence.

## Observable behavior

Settings exports individual saved requests and drafts after view removal or device uninstall, including offline restart. The versioned `module-work-recovery` format retains account/workspace/module scope, original release, exact request identity/body/base/dependencies/delivery/settlement, separate command reviews, draft targets and versions, saved comparisons, archived provenance and collision-source input. Export leaves stored work unchanged. These are portable device observations, not execution credentials or proof of server acceptance; there is no importer.

Original and current permissions apply. Browser exports refresh identity and policy; received denial cancels delivery. Electron main owns contract/policy observations and reauthorizes after its save dialog. An authenticated catalog response restores current dependency metadata only for the matching policy revision. Settings prepares retained original release contracts through authenticated transport after reauthentication, without running module code. Missing original metadata fails closed; a preparation authentication failure locks corporate access while retaining pending work.

## Final verification

All final commands completed successfully on frozen product source, using isolated PostgreSQL databases and serialized runners:

| Check | Result | Local log |
| --- | --- | --- |
| `pnpm build` | Strict root/browser/Node/preload/worker checks, boundary/copy checks, four fresh production builds | `/tmp/gabs-work-export-acceptance-build.log` |
| Full Vitest/PostgreSQL regression | 514 tests across 86 files | `/tmp/gabs-work-export-regression.log` |
| Headless browser acceptance | 9 journeys | `/tmp/gabs-work-export-web-acceptance.log` |
| Hidden/unfocused Electron acceptance | 10 journeys | `/tmp/gabs-work-export-native-acceptance.log` |
| Changed TypeScript formatting | Passed | `/tmp/gabs-work-export-format.log` |

Browser and native suites cover viewless/uninstalled command and record exports, archived input, collision reviews, independent queued/direct reviews and the existing authority/lease export regression. Actual downloaded/written JSON is validated against the public schema and original stored values, including every saved draft in the advanced fixtures. They verify retained journals/reviews/targets and completion after reinstall. A delayed native save under real permission revocation produces no file; browser revocation produces no download. The browser preparation-401 case additionally verifies the corporate recovery surface locks without losing work. Native save dialogs are intercepted in isolated profiles; no system dialog, focus activation or notification is required.

Thirty-two wide/narrow web/native captures in this directory were visually inspected. Existing dialog layout, wrapping, scrolling and action placement remain consistent; scoped Axe/overflow and keyboard disclosure checks pass in the journeys. Long comparisons scroll within the existing dialog. This establishes continuity, not final design approval or whole-product AAA conformance. No stylesheet changed. Sixty-eight historical captures overwritten by the runs were restored; this milestone retains its own evidence.

## Diagnosis and corrections

Initial native fixtures used a generic `TypeError("Offline")`, which did not model the deliberately narrow Node transport classification. Fixtures now use the actual fetch-failure shape with `ECONNREFUSED`; product transport checks were not relaxed. Corrected fixtures exposed missing native dependency metadata after policy revision and original contracts after reauthentication. Authenticated catalog observation and original-contract preparation fix those two gaps. Temporary diagnostic output was removed.

The delayed-revocation assertion now accepts either the explicit denial alert or removal of the no-longer-authorized export owner, while always requiring the output file to be absent. A strict-build import error was corrected to the declared client API subpath before the successful final build and suites. Earlier incomplete runs are not acceptance evidence.

## Limits and next work

Workspace-wide scheduling, remaining source-schema/legacy transitions, cross-module/resource dependents, submitted-child outcomes, custom/archive descendants, full scheduling simulation and OFF-03 profile/sign-out recovery remain required. Unknown legacy source versions remain unavailable rather than inferred. Export alone does not satisfy recovery/import or permanent-revocation journeys. Earlier intermittent native linked-dialog and concurrent Orders draft failures remain tracked; these passing runs do not establish their causes. Provider, signed-release, remote CI and broader parity gates remain separate.
