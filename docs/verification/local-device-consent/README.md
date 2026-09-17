# Local device consent

17 September 2026. Locally verified consent UI milestone for SDK-05. Worker brokering, standalone device effects and corporate offline capability leases remain open.

## Behavior and evidence

- [Device access](../../../packages/shell/src/features/modules/local/access/devices.tsx) is part of the existing local module-management dialog. It verifies installed declarations before displaying opt-in controls, identifies the release, alias and declared permission, and persists decisions through the encrypted profile authority.
- Consent is separate for each capability. Saving preserves the focused control, announces completion and refreshes verified consent. Late verification results are discarded after leaving the screen. Failures never report a successful decision.
- Saved grants remain revocable when artifact verification fails. The UI blocks new grants, exposes the failure and offers removal of retained consent. Repair and reauthorization remain separate actions.
- The [shared real-interface journey](../../../tests/support/local-device-journey.ts) builds, submits, reviews, publishes and installs an independent signed standalone module through the local test registry. It checks default denial, accessible release descriptions, keyboard consent, independent notification consent, lock/unlock persistence and durable revocation.
- The [headless browser journey](../../../tests/e2e/local-device-consent.spec.ts) performs consent changes offline after installation. It also alters stored artifact bytes inside the real encrypted vault, verifies checksum rejection and removes the grant through the UI. A fresh decrypted read proves the grant was removed durably.
- The [native journey](../../../tests/desktop/local-device-consent.spec.ts) exercises the same installed-module consent flow in packaged Electron output, asserting that all windows remain hidden or minimized and unfocused. It does not present an OS notification, save dialog or LAN effect.

## Verification

| Check                                                                                                    | Result                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Final `pnpm build`                                                                                       | Passed strict TypeScript, environment separation, dependency/copy checks and all four application bundles |
| Initial browser consent and existing grant-authority proof                                               | 2 passed                                                                                                  |
| Final browser consent with offline/accessible-description checks and existing service-consent regression | 2 passed                                                                                                  |
| Hidden, unfocused native consent journey                                                                 | 1 passed                                                                                                  |
| Browser Axe checks                                                                                       | No violations at 1280 and 390 pixels in the captured consent state                                        |

The browser runs cover three distinct journeys; the consent journey was rerun after adding accessible descriptions and explicit offline execution. One test-helper type import failed an intermediate build and was corrected before the final passing build. No whole-suite or remote CI acceptance is claimed. Each interface run used a fresh migrated/seeded database and removed it afterward. Historical service-consent screenshots were restored.

Inspected [wide](wide.png), [narrow](narrow.png) and [native](native.png) captures show readable wrapping, visible controls and the existing dialog styling. This change adds no CSS or theme modifications and does not establish final UI polish or whole-product accessibility conformance.

Logs: `/tmp/gabs-device-consent-build-final.log`, `/tmp/gabs-device-consent-browser.log`, `/tmp/gabs-device-consent-browser-final.log`, `/tmp/gabs-device-consent-native.log`.

## Next boundary

Consent authorizes a request; it does not implement an effect. Connect worker requests and native effects with bounded messages, fresh authorization, cancellation and explicit transaction semantics. A save dialog must not occupy the profile write queue or prevent revocation. External effects cannot be treated as atomic, rollbackable business writes. Preserve these constraints while finishing SDK-05.
