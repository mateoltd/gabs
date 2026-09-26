# Organization diagnostics and architecture review

Scope: GOV-02 / ORG-002, with shared permission evaluation under GOV-01. Checkpoint `06ae92c` and annotated tag `checkpoint/organization-architecture-2026-09-26` preserve the unfinished draft. The user requested Sol at xhigh, followed by independent parent review and a final commit.

## Ownership

The existing responsibility-based package hierarchy is retained. Governance schemas, graph diagnosis/layout and permission evaluation now have cohesive internal files behind the unchanged SDK public entry. No package identity, wire schema, signed release or host composition contract is renamed.

Graph diagnostics identify cycles and disconnected descendants. The shell owns repair interaction and presentation; the server independently rejects invalid policy. Invalid drafts remain available for repair, with save/layout guards and unavailable permission previews. Role deletion remains required and unimplemented.

## Acceptance

- Delegate: 23 focused unit tests across graph diagnosis, SDK invariants and role tags passed.
- Parent: strict TypeScript for the root, browser, Node, preload and workers; boundary/copy checks; all four fresh application builds passed.
- Parent browser acceptance: three headless journeys passed (diagnostics, classification and the 500-role chart). The final diagnostics journey passed again after adding an explicit keyboard-focus assertion and improving capture framing.
- Parent native acceptance: all three equivalent Electron journeys passed with hidden/minimized windows. The new journey confirms every window remains unfocused.
- Parent full isolated regression suite: all 1,047 unit/PostgreSQL tests across 139 files passed on the accepted source.

The shared repair journey sends invalid orphan/cycle graphs directly to the actual API and verifies rejection with unchanged saved policy/version. It then creates both invalid drafts in the interface, checks the affected nodes and disabled save/layout/permission controls, repairs with the keyboard, saves and reloads the valid graph. Scoped Axe A/AA checks and narrow overflow checks pass. This is scoped accessibility evidence, not whole-product conformance.

All eight final captures were inspected. Existing presentation is retained; diagnostics use the host notice, dialog and button components. A thin dashed treatment distinguishes keyboard focus on invalid nodes, and visible text accompanies the error outline. Incidental regenerated historical captures were restored.

| State | Web | Hidden desktop |
| --- | --- | --- |
| Disconnected branch | [Capture](web-orphan.png) | [Capture](desktop-orphan.png) |
| Cycle and keyboard focus | [Capture](web-cycle.png) | [Capture](desktop-cycle.png) |
| Narrow repair dialog | [Capture](web-repair-narrow.png) | [Capture](desktop-repair-narrow.png) |
| Saved repair | [Capture](web-repaired.png) | [Capture](desktop-repaired.png) |

Local logs: `/tmp/gabs-org-architecture-build.log`, `/tmp/gabs-org-architecture-web.log`, `/tmp/gabs-org-architecture-web-final.log`, `/tmp/gabs-org-architecture-native.log`, `/tmp/gabs-org-architecture-regression.log`. Logs are ephemeral; the repository retains journeys, assertions and captures.

## Limits

This bounded architecture review does not establish overall parity, complete GOV-01/GOV-02, or approve the UI as polished. Role deletion, remaining governance acceptance and external release/provider gates remain tracked separately.
