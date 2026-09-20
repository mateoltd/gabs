# Corporate saved-work file portability

Scope: **ID-03-BACKUP-PORTABILITY**, within the active ID-03-BACKUP-CORPORATE requirement. Verified locally on 20 September 2026. This closes the missing real export-to-import path for ordinary drafts and unsubmitted create requests; it does not complete corporate backup or advanced saved-review recovery.

## Actual product journey

The fixture provisions an isolated company workspace through the API. The source signs in through the actual development sign-in screen, enables offline storage and opens Contacts. With transport offline, the user captures a queued contact and a separate ordinary draft through the real forms. Settings exports both using **Export saved request** and **Export saved draft**. The tests retain the exact downloaded/native-written bytes; they do not construct or rewrite the recovery payload.

The source then closes while still offline. A destination starts with an empty storage profile, fresh authentication and fresh offline-storage consent. It receives only the two recovery files, with no source cookies, cache, credentials or desktop key. Settings initially shows no saved work. The user selects each original file and explicitly restores it:

- The uncommitted original request is authoritatively cancelled under its exported identity. A later send of that exact original receives `ATTEMPT_CANCELLED` from the real API/PostgreSQL host.
- The separate draft opens through **Resume review**, retains its entered name and submits through the normal server-authorized form. The original queued contact has not been created.
- Both imported copies remain visible as restored, and both original source files are byte-for-byte unchanged.

## Verified paths

| Source | Fresh destination | Result |
| --- | --- | --- |
| Browser | Browser context with separate storage/session | Passed |
| Browser | Electron with empty encrypted storage | Passed |
| Electron | Browser context with separate storage/session | Passed |
| Electron | Electron with a distinct profile and independent protected-storage key | Passed |

`tests/support/corporate-portability/journey.ts` owns the common observable workflow. `tests/support/corporate-portability/devices.ts` provides headless browser contexts and hidden/minimized Electron devices, authenticates through the actual development flow and captures the actual export file. Native save-dialog selection is controlled to avoid opening an OS dialog; native file export, IPC, main and utility storage remain real. Each native device has a separate controlled AES-GCM OS-protection key installed before application startup. Window assertions verify no focus and hidden/minimized state before shutdown. All temporary device profiles and isolated databases are removed.

## Evidence

- Three browser/cross-surface cases passed: `/tmp/gabs-portability-web.log`.
- One final native-to-native case passed: `/tmp/gabs-portability-desktop.log`.
- Strict root and browser/Node/preload/worker type checks passed: `/tmp/gabs-portability-types.log`.
- Dependency-boundary and copy checks passed: `/tmp/gabs-portability-lint.log`.

This change adds acceptance tests and evidence only. Application source and styles are unchanged from `50f86ab`; its earlier builds/regression and dialog visual checks remain historical evidence. No full unit suite or new release package is claimed for this test-only change.

## Limits and continuation

The devices are separate local test profiles/contexts, not multiple physical computers. Authentication uses the local development provider; OS protection is explicitly controlled. These tests establish real product file interoperability and independent-store recovery, not live MFA, physical OS security, signed Windows/Linux/macOS deployment, or comprehensive key-loss recovery.

Advanced collision/continuation graphs, review/schema/target transitions, delayed denial/profile/expiry/process-death acceptance, larger encrypted corporate archives and recovery from an unreadable existing corporate store remain under ID-03-BACKUP-CORPORATE. Files here are the existing authorized JSON exports, not encrypted bulk backups. No original requirement or overall parity is marked complete.
