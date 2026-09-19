# Saved online profile checkpoint review

Date: 19 September 2026. Tracker: ID-01-SAVED, under ID-01. Status: browser scope implemented and exercised; native/provider acceptance remains required.

## Ownership and behavior

The client identity layer owns a serialized, validated directory containing only account ID, display name, email and last-used time. Browser persistence uses IndexedDB and a cross-tab lock; Electron stores verified account metadata with protected storage, scoped to the configured API origin. Neither directory grants authority or stores credentials.

The shell owns account selection and the sign-in attempt. Selecting an account requests fresh authentication and verifies the returned account ID before opening a workspace. Switching signs out the active account while preserving business work. Forgetting removes sign-in labels and retains a tombstone against background resurrection; explicit reauthentication may add the account again. Forgetting is not data erasure.

Parent review added the missing generation check to the native directory writer, corrected the new acceptance fixture's modal timing and close-button label, and applied existing form-stack spacing to prevent adjacent links and controls touching. No styles, package identities, signed artifacts or business contracts changed.

## Verification

- Four directory tests cover restart persistence, serialized accounts, metadata-only storage, forget/re-add behavior, delayed stale writers and unreadable storage preservation.
- Two real headless browser journeys cover account A to B to A, pending offline work retained through sign-out, fresh authorization, original request recovery, authoritative version-2 readback, forgetting and re-adding, and rejection/logout of a wrong-account authentication response. The wrong-account test substitutes the development login request and receives a real server session; it is not real OIDC-provider acceptance.
- Eight existing sign-out and profile-authority browser regressions passed in the initial combined run. The two new fixtures initially failed due to an immediate visibility check racing automatic dialog opening; a separate rerun passed after correcting the fixture.
- Final rerun after the spacing correction and authoritative readback assertion: both browser journeys passed. Wide (1440 × 1000) and narrow (390 × 844) captures were inspected; links are separated, controls fit, and the narrow page has no horizontal overflow. Strict checks, four fresh builds and 688 unit/PostgreSQL tests passed; see [the architecture review](../architecture/README.md#saved-online-profile-checkpoint-review-19-september-2026).

Captures: [wide chooser](chooser-wide.png), [narrow forget confirmation](forget-narrow.png). These show functional continuity, not completion or approval of the later UI-refinement goal.

## Remaining acceptance

Native switching, protected metadata persistence across process restart, real-provider OIDC/MFA/refresh, corporate local unlock and background privacy remain open. macOS reported the screen locked during this review; no protected-storage bypass or foreground desktop run was attempted. The unrelated collision-outcome checkpoint retains its existing acceptance limits. Full ID-01 and functionality parity remain incomplete.
