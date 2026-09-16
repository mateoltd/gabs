# SDK-03: React preview and source reload

16 September 2026. The module developer workspace now renders custom views through the public React/SDK/UI contract and runs resource-based scoped handlers against isolated fixtures. SDK-03 remains active for cross-module fixtures and provider integration.

## Implemented behavior

- Independent directory entry, strict source checking, manifest compatibility, fixture/configuration validation and the existing public client bundle builder. No central host catalog edit is required.
- Manifest view selection, host React/UI sharing, Shadow DOM containment, typed clients/business rejections and declared editable view state. The simulator controls connectivity and permissions through the same interface as generated operations.
- A persistent loopback HTTP host with a restartable module process. TSX, CSS, backend, configuration and fixture changes invalidate old requests, rebuild and reload. Diagnostics survive invalid source; render errors stay within the preview. Simulation state deliberately resets on rebuild.
- Existing origin/Host protections plus request revision checks, bounded bodies and worker execution timeouts. Custom-view calls use immediate acceptance; generated inspector captures retain provisional offline semantics. Production app routes, shared styles and desktop startup behavior are unchanged.

## Verification

Strict TypeScript, module/browser boundaries, copy rules and targeted formatting passed. Two headless Chromium journeys passed, including a final rerun after selector labeling, settled-animation checks and narrow-table spacing corrections:

1. A module copied to an independent directory renders its real custom React view, reads fixtures and saves via a scoped command using keyboard form submission. Revoked operation permissions reject writes; revoked view permission hides the preview. Offline inspector capture remains pending until synchronization. Foreign origins, missing/stale build revisions and actions during a failed build are rejected. Actual TSX, CSS, backend, fixture and configuration edits rebuild without catalog changes; invalid TypeScript reports its source location and correction recovers. The changed backend produces a different saved value.
2. A stateful public view retains draft input across connectivity changes, handles a typed business rejection without clearing input or creating a record, saves successfully and clears its checkpoint. An authored render exception is contained; correcting the file restores a fresh preview.

Scoped Axe checks pass after entrance animations settle. Wide and 390-pixel captures were inspected. No horizontal overflow occurs at the narrow viewport. An initially wrapped table heading was corrected with a nonwrapping header; the preview selector now has clear spacing from its surface. Wider inspector tables have a named, keyboard-focusable scroll container. These are developer-tool checks, not whole-product accessibility or final UI approval.

- [Wide preview](wide.png)
- [Narrow preview](narrow.png)

Session logs: `/tmp/gabs-preview-final-types.log`, `/tmp/gabs-preview-final-lint.log`, `/tmp/gabs-preview-final-browser.log`, `/tmp/gabs-preview-scroll-browser.log`. The combined browser run passed both journeys in 42.8 seconds; the final inspector-scroll rerun passed the full source-reload journey in 33.0 seconds. Desktop tests were not needed for this browser-only developer tool; no foreground application or native test window was launched.

## Limits and next work

The workflow performs automatic rebuild/page reload, not state-preserving React Fast Refresh. Private stores, corporate audit execution, cross-module fixture/service simulation and external provider-directory integration remain SDK-03 work. The current light preview does not certify themes/archetypes. Actual server, persistence, worker, lifecycle and full product release gates retain their separate acceptance requirements. [Developer guide](../../module-development.md).
