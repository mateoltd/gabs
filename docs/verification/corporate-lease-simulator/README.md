# Corporate offline lease simulation acceptance

18 September 2026. SDK-05 milestone; full SDK-05 and product parity remain open.

## Implemented behavior

Module-owned fixtures accept allowances only for declared `offline: "lease"` aliases, with inferred names, inputs and results and runtime validation for JavaScript callers. Corporate allowances are rejected in personal simulations. Omitted, valid, expired and revoked states remain distinct. A deterministic clock supports expiry without wall-clock waiting; renewal requires online company context and current capability/view permissions. Observed permission changes invalidate allowances, while unchanged normalized permission sets preserve them.

`prepareHost(alias, input)` holds a simulated effect open and rechecks authority on single-use completion. Expiry, revocation and replacement of the prepared offline allowance reject it. Reconnecting uses current simulated online authorization. Online-only capabilities remain unavailable while disconnected. No device adapter, business journal entry, audit effect or event is created by a simulated host effect.

The development inspector exposes selected lease status, bounded lifetime, renewal/revocation and clock controls. Host observations distinguish online versus leased results. Fixture/source reload resets the clock and allowances, and requests carrying the previous source revision cannot modify the new simulator. Existing standalone and online host controls retain their behavior.

## Executed verification

- 22 focused tests across seven files passed, covering host capabilities, corporate leases, standalone simulation, module operations, services and stores. Strict TypeScript checks include compile-time rejection of online-only/unknown lease aliases and invalid prepared-action inputs.
- Two independently authored CLI scenarios passed through `pnpm module test tests/fixtures/corporate-lease-simulation`, including fixture inheritance, fresh scenario state, expired/revoked rejection and a held action.
- Three headless browser journeys passed: corporate leases, existing online host simulation and standalone device simulation. The new journey exercises actual preview controls, permission denial, offline renewal disablement, renewal/revocation, expiry, runtime rejection of online-only lease requests, revocation despite an invalid renewal-duration input, source reload and rejection of stale actions. No downloads occur.
- Root and browser/Node/preload/worker TypeScript checks, dependency/environment/copy checks and all four production builds passed. Existing bundle-size warnings remain.
- Axe checks passed at wide and 390-pixel widths. Keyboard activation, no page overflow and inspected [wide](wide.png) and [narrow](narrow.png) captures verify the developer controls. The business application UI and styles were not changed. No desktop was launched.

Logs: `/tmp/gabs-lease-simulator-tests-final.log`, `/tmp/gabs-lease-simulator-cli-final.log`, `/tmp/gabs-lease-simulator-browser.log`, `/tmp/gabs-lease-simulator-browser-final.log`, `/tmp/gabs-lease-simulator-build-final.log`. Browser acceptance used a temporary headless Playwright configuration without corporate API/web startup; each journey owns and closes its independent loopback preview. Existing shared previews were preserved. Historical screenshots overwritten by regression runs were restored.

Initial TypeScript checks identified generic fixture/index typing and expected-error placement issues, corrected before final acceptance. The first CLI run expected the default export outcome despite inheriting an explicit cancelled fixture; the scenario now verifies that inherited result. Final review separated revocation from renewal-duration validation; the affected browser journey passed again after that preview-only correction. SDK sources and application bundles were unchanged by this correction. No production authorization rule or acceptance gate was weakened.

## Limits and next work

The clock and allowances model author-visible outcomes, not signatures, issuer rotation, encrypted persistence, production policy delivery or native dialog execution. Existing browser/native lease acceptance remains the evidence for those implemented behaviors; broader profile, provider and release gates remain open. Permission controls represent a policy already observed by the client, not instantaneous knowledge of remote revocations while disconnected.

Next audit/migrate official module host effects through the public capability contracts, then finish administrator capability review and the remaining SDK-05 map. In particular, review the Orders export flow and distinguish host-owned export-job/data transport from module-requested device effects. Positive native LAN and actual notification presentation retain separate acceptance. This does not close the parity goal or start UI refinement.
