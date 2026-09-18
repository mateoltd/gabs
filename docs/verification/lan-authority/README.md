# Module-granted LAN startup and offline restart

18 September 2026. SDK-05-LAN-AUTH; scoped local acceptance.

## Implemented behavior

[Local network authority](../../lan-authority.md) now allows an ordinary company member to enable a session through an explicitly selected `lan.relay` declaration. The native main process verifies current server authority or a protected exact-release signed lease. Read-only peer status cannot start a session. Selected sessions only accept the selected module's envelopes; each outgoing SDK effect also retains its own capability check. Idle sessions renew every 15 seconds, and incoming/outgoing work rechecks authority. Connected authorization lasts at most one minute; disconnected authority is bounded by the verified lease.

Settings exposes available module grants without requiring `modules.manage`. Device preferences and LAN controls are available offline while corporate access remains valid. Administrative policy, corporate appearance and billing mutations remain connected operations. The initial root redirect now unmounts immediately when navigation changes, preventing a cold-start redirect from overwriting a newer Settings click.

The workspace-wide administrator startup option remains connected. Administrators can choose a module grant for offline startup. Employee receipt review/submission and archive/file recovery are still separate required work: session authority does not grant access to the existing administrator recovery interface.

## Observable native acceptance

The independently published executable fixture is assigned to an ordinary company member whose effective permissions explicitly exclude `modules.manage`; a separate membership preserves root administration. The hidden desktop journey verifies:

- Keyboard selection of the module grant and rejection of the unrestricted administrator startup path.
- Online grant preparation and initial startup, followed by an actual Electron process restart with main-process API fetch blocked before application initialization.
- Offline Settings access, rejection of the read-only grant and successful startup from protected signed relay authority.
- Real mutual-TLS peer status and provisional draft transfer. The authoritative module-record count remains zero.
- Rejection of startup after expiry and clock rollback, with the application wall clock controlled in the test. The OS clock and network are untouched.
- Explicit reauthentication and fresh grant acquisition after invalidated authority, followed by successful offline startup again.
- An actual server permission-denial message after revocation, then rejected offline replay and no additional received envelope.
- Native windows remain hidden/minimized and unfocused. High-contrast Settings passes scoped Axe at 390px without horizontal overflow.

The complete extended journey passed twice after the routing correction; the final startup-guard review has an additional affected native run. Inspected [offline Settings](offline-settings.png), [narrow high contrast](offline-narrow.png) and [provisional transfer](offline.png). These are scoped behavior/layout checks, not acceptance of the overall UI as polished or a whole-product AAA claim.

## Executed checks

| Check | Result and evidence |
| --- | --- |
| Full isolated unit/PostgreSQL suite | 385/385 passed across 73 files. Includes new selected-grant startup, read-only rejection, exact release/workspace/profile isolation, expiry, clock rollback, opt-out, permission revocation, connected-only startup without offline storage and module-filtered receipt checks. `/tmp/gabs-lan-auth-full.log`. |
| Builds | Final strict root and browser/node/preload/worker checks, boundaries/copy checks and all four builds passed. `/tmp/gabs-lan-auth-review-build.log`. The root-routing and startup-guard corrections followed the full unit run and have final focused/native/browser evidence. |
| Final startup guards | 25/25 focused authority/lifecycle checks passed, including expiry during certificate loading with no listener bound. Review also clears the renewal timer after failed startup. `/tmp/gabs-lan-auth-review-tests-final.log`. |
| Extended native startup | Two complete runs passed, including clock recovery and actual server revocation. `/tmp/gabs-lan-auth-native-clock.log`. Final affected startup/lease pair: `/tmp/gabs-lan-auth-review-native.log`. |
| Existing native regressions | Both administrator peer lifecycle/status and leased TLS effects passed in `/tmp/gabs-lan-auth-native-final.log`; that combined run's new startup journey failed the then-unfixed routing race. The final affected reruns above verify the correction. |
| Browser | Two headless journeys passed: Settings keyboard/theme/mobile behavior, plus cached offline export/revocation/tamper/expiry with added offline Settings preferences and hidden administrative/native-only controls. `/tmp/gabs-lan-auth-browser.log`. |
| Final types/style | Final strict types after test refinements and focused Prettier checks passed. `/tmp/gabs-lan-auth-types-final.log`, `/tmp/gabs-lan-auth-format-final.log`. |

Early acceptance attempts also corrected fixture expectations, awaited window creation, used the fixture's actual immutable release version, reauthenticated after process restart, and reselected the peer after view reload. Recovery now waits for the UI's completed grant preparation instead of racing a second renewal. No authority check was weakened to accommodate those corrections.

Historical captures generated by regression tests were restored. No production provider, external release, multi-host deployment, other operating system or signed installed-package acceptance is claimed. Employee receipt recovery, inactive-release/remote-dependency reconciliation, profile/sign-out recovery and wider SDK-05/OPS gates remain required.
