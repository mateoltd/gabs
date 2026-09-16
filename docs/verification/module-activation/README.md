# New-module administration acceptance

16 September 2026. Local Chromium, compiled authoritative API, PostgreSQL 18.6, Node 24.19.0.

## Scope

An existing company can administer a module published after the company was created. The fixture compiles an independent React view and server handler, submits both signed artifacts, records an explicit fixture review, stages the server and publishes through the official CLI. Neither host source nor company permission records are patched to install that module.

The browser journey in `tests/e2e/module-activation.spec.ts` verifies:

- No activation row exists before administration. The administrator sees the new release, but cannot install it without entitlement, publication and assignment.
- Publication without entitlement is rejected. Required configuration is validated before publication.
- Employees cannot discover the draft module. Publishing makes it visible without granting operation permissions or assignments.
- The role editor discovers the release's declared permissions. Invented permissions and privileged platform permissions cannot be added to a business role through the API.
- Member administration lists every available module, including Contacts, Projects and independently published modules. It saves the new role and module assignment through the real UI.
- The member dialog remains scrollable at a 390-pixel viewport, with its save action reachable.
- Opening the assigned module installs its signed client, and the independent server operation applies the configured prefix to persisted data.

Identity membership and entitlement are explicit database fixtures. This is not a Stripe checkout, invitation or publisher authentication acceptance test. Configuration, publication to employees, role creation and member assignment use normal application boundaries.

## Verification results

- `pnpm check`: strict TypeScript, boundary/copy checks and all 63 unit/PostgreSQL tests passed.
- `pnpm build`: API, worker, web and desktop passed.
- Full Chromium suite: 56 journeys passed, including the new administrator flow and delayed-result contrast assertion.
- Native Electron suite: 5 journeys passed, including independent executable installation and shared administration screens.
- Formatting passed. Wide and narrow activation screenshots were inspected; historical unrelated regression images were retained.

The prior remote run on `2f5ce51` passed unsigned packaging on all three systems but failed the browser contrast check addressed here. The earlier CI order-read latency failure remains unresolved; local functional verification is not remote performance acceptance.

## Visual evidence

- [Member assignment](member-assignment.png)
- [Narrow member assignment and reachable save action](member-assignment-narrow.png)
- [Running custom view with server-configured output](activated-view.png)

The screenshots record the current engineering interface, not approval of the overall visual design. The fixture's technical description and navigation name are acceptance content, not a proposed business application.

## Loading contrast regression

A remote CI accessibility check found unreadable muted table text while results faded. Pending results now retain their original contrast; the existing busy state and status announcement remain. The slow-pagination browser test holds the response open and verifies both retained rows and their contrast. The whole-page menu accessibility check waits for query completion and entrance animation completion before assessing the settled page.

EXT-02 remains active. The publisher review interface and remaining release acceptance are still open, as are per-module migrations and complete update recovery. See [the tracker](../../parity-tracker.md).
