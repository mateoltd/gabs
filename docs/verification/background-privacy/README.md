# Background screen privacy

Date: 19 September 2026. Tracker: ID-01-PRIVACY, under ID-01. Status: renderer behavior exercised; real OS lifecycle acceptance remains open.

## Implemented behavior

The shared shell responds synchronously to window blur and hidden document visibility. It covers the whole viewport, hides body-level portal content, makes the page inert to interaction, and restores the existing component tree and connected focus target when foreground visibility returns. A focus signal cannot reveal a still-hidden document. The cover also applies when the shell mounts in a hidden document.

The opaque, theme-aware cover intentionally provides stronger visual concealment than the original specification's blur. It contains no account or business information. Hiding is immediate even when a portal has an opacity transition; newly mounted portals are covered too. It does not unmount editors, mutate the operation journal or silently submit unsaved input. Existing authorization, lease checks and standalone profile locking remain responsible for access.

This is screen privacy, not PIN/biometric unlock, session termination, encrypted-memory erasure or a security boundary against code running in the renderer. ID-02 and broader identity acceptance remain required. No foreground screen was opened for these checks.

## Verification

- Strict root/browser/Node/preload/worker type checks, architecture/copy checks and four fresh application builds passed.
- The full isolated unit/PostgreSQL suite passed: 688 tests in 101 files. Disposable databases were removed.
- Two headless browser journeys cover an offline corporate editor, an open dropdown portal, a late portal with an explicit visibility override and long transition, inert keyboard input, original pending-request preservation, unsaved-input restoration, hidden startup, and focus arriving before visibility.
- Five sign-out recovery journeys passed on the final build. Saved-profile switching (two cases) and profile-authority recovery (three cases) also passed before the final immediate-transition styling correction.
- One hidden/minimized Electron journey passed on the final build. It checks renderer concealment and restoration of unsubmitted profile input, and asserts the window stays unfocused and hidden/minimized before, during and after the check. It does not create an encrypted profile or require Keychain access.
- Final captures were inspected: [wide cover](covered-wide.png), [narrow cover](covered-narrow.png), [restored corporate editor](restored-editor.png), [hidden native cover](native-covered.png). The cover contains no prior content, and the restored editor retains its original unsaved value. Existing foreground styling is unchanged.

Browser and native tests deliver controlled blur/focus/visibility signals to the production renderer. They verify observable UI responses, not OS event delivery. Electron's documented [page visibility behavior](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility) differs when background throttling is disabled, as it is in the existing minimized harness. Physical focus, minimize/occlusion, system lock/unlock and task-switcher capture timing must still be exercised on supported OSes. This evidence does not claim that a renderer can remove historical OS thumbnails or cover a compromised OS.

## Next work

Continue ID-02 corporate local unlock and supported biometric/PIN flows, including unavailable hardware, cancellation, delayed completion, profile removal and recovery. Complete real-provider/native saved-account acceptance and the physical lifecycle matrix when its environment is available. Full ID-01, functionality parity and the later UI-refinement goal remain incomplete.
