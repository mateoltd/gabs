# Host-owned record and draft recovery

18 September 2026. Scoped OFF-01 work; full parity remains open.

## Behavior and boundaries

Settings > Offline work on this device > Saved work recovery now includes saved record changes and drafts, alongside commands. The host uses retained original resource contracts, not the current view's field definitions, to inspect saved input. It never mounts a removed module view or submits a correction from this screen.

- Journaled creates, updates and archives are distinct from ordinary drafts and separate saved reviews. Original input, base values, targets, comparison choices and retained collision-source data remain unchanged.
- Explicit settlement uses the original identity/body/version and the existing atomic server receipt/cancellation protocol. Recovered record receipts retain their original signed contract for inspection after another offline restart. Settlement does not delete a draft or review.
- Original resource read/write grants and module availability govern inspection and settlement independently of the old navigation permission. Consent, fresh connected authority, offline leases, account/workspace identity and authority after awaited work remain mandatory.
- Corporate settlement rejects originally local resources. Missing original schemas fail closed. Unsupported legacy drafts without retained version information are preserved and reported, not interpreted using a newer schema.
- Uninstall preserves the latest signed device contract even when only drafts remain. This retains inspection metadata; it does not reinstall or authorize executable module code.
- Ordinary accepted records without explicit recovery history do not create empty module headings in Settings.

## Verification

Final product source passed eighteen headless browser cases, fourteen hidden/unfocused native cases and five additional repetitions of the formerly failing native uninstall/reconnect scenario. Strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh builds passed. Storage, SDK, server and original-input model changes passed 510 unit/PostgreSQL tests across 85 files; these paths were unchanged during the later presentation and navigation fixes. Final review added a draft-only uninstall regression; all 55 tests in the affected storage file and the subsequent strict type checks passed. This storage fixture verifies both retained versions without a journal, separately from the real-client journeys.

The [shared resource journey](../../../tests/support/resource-host-journey.ts), command recovery, archived-input, independent-review and browser list/administration regressions make up this scoped acceptance. All twelve new captures below were inspected. Formatting and diff checks passed; 111 modified historical PNGs were restored. No stylesheet changed.

### Reconnect navigation diagnosis

The first native regression passed 13 of 14 cases but intermittently lost the Settings recovery launcher after restarting and reconnecting the uninstalled-module case. Three isolated retries passed, then a ten-case repetition reproduced the failure. Five instrumented repetitions passed; a subsequent six-case run reproduced it with navigation history. Passing retries did not establish a fix.

The [captured navigation sequence](navigation-failure.json) shows the Settings click pushing `#/settings`, followed by a stale startup redirect replacing it with `#/overview`. Saved requests, the ordinary draft, original contracts and current permissions remained present. Inspection of the executing bundle identified React Router's passive `Navigate` effect as the delayed writer. Moving the redirect into a layout effect alone still reproduced the failure: a delayed router render can commit after browser history has already changed. `RouteRedirect` now also compares the router-generated href with the live browser URL immediately before navigating, with native hash-root normalization. The existing active-location guard and ordinary passive redirect timing are retained; the failed layout-only workaround was removed. No timeout or acceptance condition was relaxed.

Visual review also found the new long dialog title crowding its close control at a narrow width. The title is now “Records and drafts”; its launcher remains “Saved records and drafts”. The journey checks at least eight CSS pixels between the title box and close control, alongside its existing overflow and accessibility assertions. No stylesheet changed.

The first strict rerun caught a root test's unsupported package-alias type import in diagnostic code; the test now uses the existing relative source import convention. This was a test compilation correction, not a product workaround. The final draft-only storage fixture initially omitted the current-contract metadata written by the real uninstall lifecycle; supplying that metadata corrected the fixture and exercised artifact pruning without a journal.

The new shared browser/native journey captures a create, an update with original base data and an ordinary draft through the generated UI. A concurrent original-version request accepts the create while the device is offline. A signed release removes navigation and either removes the resource or precedes device uninstall. Recovery denies revoked resource write access, works without the former navigation grant, survives restart, recovers a lost accepted receipt, explicitly cancels the update and preserves the ordinary draft. Original calls and zero dispatch counts remain exact; the server retains precisely the original record and accepted create. The module remains uninstalled where applicable.

Unit evidence separately covers retained original contracts/accepted receipts, ordinary drafts plus independent saved reviews after uninstall, original permission checks and revocation during archive settlement. These are not substitutes for every advanced review/collision UI journey.

The existing command, archived-input, independent-review and list/administration regressions remain included in the acceptance set. Browser runs are headless; native runs use isolated hidden/minimized, unfocused windows. Shared local services remain running, and every isolated acceptance database is removed by its runner.

## Inspected captures

| Scenario                                   | Browser                                  | Native                                      |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------- |
| Removed resource, original input offline   | [Capture](web-removed-offline.png)       | [Capture](native-removed-offline.png)       |
| Removed resource, ordinary draft           | [Capture](web-removed-draft.png)         | [Capture](native-removed-draft.png)         |
| Removed resource, recovered outcomes       | [Capture](web-removed-recovered.png)     | [Capture](native-removed-recovered.png)     |
| Uninstalled module, original input offline | [Capture](web-uninstalled-offline.png)   | [Capture](native-uninstalled-offline.png)   |
| Uninstalled module, ordinary draft         | [Capture](web-uninstalled-draft.png)     | [Capture](native-uninstalled-draft.png)     |
| Uninstalled module, recovered outcomes     | [Capture](web-uninstalled-recovered.png) | [Capture](native-uninstalled-recovered.png) |

## Limits and next work

Host-owned saved-review/collision/source-schema and legacy archive journeys need further real-client acceptance beyond the unit and existing generated-view regressions here. Command/record export from the independent recovery surface, deliberate reinstatement or correction, permanently revoked-workspace policy, profile/sign-out recovery, general background scheduling, cross-module/resource dependents and the broader offline workflow map remain required. No broad original requirement is declared complete.

The earlier intermittent linked-dialog close and concurrent Orders draft server-error concerns remain unresolved. This work does not establish their causes, signed installed-platform acceptance, final UI approval or whole-product accessibility conformance.
