# Signed LAN module leases

18 September 2026. SDK-05-LAN-LEASE; scoped local acceptance.

## Behavior and boundary

Modules may explicitly declare `offline: "lease"` for `lan.status` and `lan.relay`. The authoring API preserves inferred aliases and inputs. Runtime validation, authoritative issuance and signature verification share the permitted effect kinds. Grants remain bound to issuer, actor, workspace, exact module release, declaration digest, permissions, policy revision and expiry. Omitted declarations remain online-only.

New client packages with leased LAN declarations require `client.host` revision 2. Signed manifest verification and the executable view factory reject older hosts before initialization. Online-only LAN packages continue to require revision 1. Historical releases were not rewritten.

These grants permit effects over an already enabled, unexpired, trusted corporate transport. They do not start transport, establish peer trust or finalize corporate data. Startup still requires a connected administrator. Employee authorization and protected offline restart remain open in SDK-05-LAN-AUTH.

## Native acceptance

The new hidden Electron journey installs an independently published executable module and acquires its grants online. It enables the administrator transport, then blocks main-process API requests by replacing its fetch with a connection-refused failure. This exercises the actual transport-failure fallback; renderer connectivity flags remain unchanged.

The module reads peer status and transfers a provisional draft over real mutual TLS. The receiving peer observes the expected module/workspace envelope, while the authoritative database contains zero committed module records. Restoring API access and revoking the module permission rejects the next action. Blocking API access again still rejects replay; the peer receives no additional envelope.

Scoped Axe checks pass. The [inspected capture](offline.png) shows the lease description, provisional result and quiet peer indicator within the existing interface. All Electron windows stayed hidden/minimized and unfocused. No OS network settings or foreground dialogs were changed. This is not an offline process-startup, employee, multi-host deployment or whole-product accessibility proof.

## Executed verification

| Check | Evidence |
| --- | --- |
| Build | Strict root/environment types, boundaries/copy and all four bundles passed. `/tmp/gabs-lan-leases-build.log`. Final types after the test-fixture correction: `/tmp/gabs-lan-leases-final-types.log`. |
| Unit/PostgreSQL | Initial isolated full run: 373 passed, two failed out of 375. Both failures were the new parameterized negative test retaining a file-export declaration for LAN inputs. Correcting that fixture to the selected kind with no offline declaration produced three passing focused cases. `/tmp/gabs-lan-leases-full.log`, `/tmp/gabs-lan-leases-focused.log`. This is cumulative coverage, not one uninterrupted all-green full run. |
| Authority and compatibility | The checks above cover real server issuance/audit/idempotency, permissions, policy changes, expiry/key rotation, signed binding rejection and revision-1 host rejection before view initialization. |
| Native leased LAN | The new TLS, provisional-only, disconnected API and revoked replay journey passed. `/tmp/gabs-lan-leases-native.log`. |
| Existing native export | Protected offline file-export process restart, expiry and post-dialog revocation regression passed. `/tmp/gabs-lan-leases-native-regression.log`. |
| Existing browser exports | Two headless journeys passed: cached offline exports with revocation/tamper/expiry and published typed effects with undeclared/foreign/revoked rejection. `/tmp/gabs-lan-leases-browser.log`. |

Generated historical regression captures were restored. Full parity and the later UI refinement goal remain open.
