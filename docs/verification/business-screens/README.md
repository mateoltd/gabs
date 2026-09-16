# SDK-01: business screens after scoped storage conversion

Verified locally on 16 September 2026. Existing Orders and Inventory screens now operate against the selected scoped business release. Administrator permission review, coordinated cutover controls and default-release promotion remain open.

## Implemented behavior

- Transitional business read routes select the current signed SDK backend after storage conversion: Orders lists/details, products, movement history and both overview summaries. Each request uses a read-only, repeatable-read transaction with current authorization. Legacy workspaces retain their guarded relational reads. Retained source tables are never used as the migrated workspace's active read model.
- Pagination accepts bounded opaque SDK cursors, validates UUID cursors before legacy SQL, and rejects foreign-workspace tokens. These responses are `no-store`. The shared order-line schema now correctly accepts named product snapshots inside overview results; OpenAPI and client declarations are regenerated.
- ModuleGate passes the actual verified installed definition to both business screens. Command version headers no longer use a fixed bundled release. Inventory dispatches scoped product edits, receipts, adjustments and counts through public operations; in-flight retries retain the original contract. Release changes reset incompatible page cursors.
- Drafts and pending Orders commitments persist the version used for their request key. Historical records without that field use the original Orders 1.1 contract for receipt recovery. New/reviewed edits select the installed contract and receive a new key. This does not complete broader profile/removal/revocation recovery in OFF-03.
- SDK version-conflict errors use the existing explicit review flow. Validated module rejection messages reach the user. No layout, theme or style changes were made.

## Evidence

- **130 unit/PostgreSQL tests in 24 files** passed, with strict types, boundaries and copy checks: `/tmp/gabs-business-ui-check.log`.
- **Four builds passed** after the installed-contract and durable-version changes: `/tmp/gabs-business-ui-final-build.log`. The final cursor-reset change also passed all four builds plus the complete scoped browser and hidden native journeys (`/tmp/gabs-business-ui-cursor-build.log`, `/tmp/gabs-business-ui-cursor-browser.log`, `/tmp/gabs-business-ui-cursor-native.log`). Final TypeScript and API regeneration are recorded separately in `/tmp/gabs-business-ui-final-types.log` and `/tmp/gabs-business-ui-final-generation.log`.
- API acceptance checks current migrated summaries, stock, fulfilled order details, pagination across pages, foreign cursor rejection and newly committed movement history. The unchanged legacy relational source is checked alongside the active SDK records.
- **Three headless browser journeys passed**: migrated business workflow plus existing legacy stock/fulfillment and offline recovery. Log: `/tmp/gabs-business-ui-browser-final.log`. The migrated journey was then expanded to include product editing, adjustment and physical count; that final focused journey passed in `/tmp/gabs-business-ui-final-scoped.log`.
- The migrated browser journey also resolves a real concurrent edit, saves/reloads an offline draft, deliberately drops an accepted server response, reloads the uncertain attempt, and verifies the same request key/version recovers exactly one order. Both wide and narrow settled layouts were inspected.
- **Three hidden/minimized Electron journeys passed**, including the new scoped stock/draft/confirmation/fulfillment flow and both native boundary tests. Logs: `/tmp/gabs-business-ui-native-final.log`. The scoped test verifies minimized/unfocused windows and the resulting private stock balance. Its settled capture shows the list, summary and inspector agree on fulfillment.

## Visual evidence and limits

- [Wide Orders with migrated history and recovered draft](orders.png).
- [Narrow order inspector without horizontal overflow](orders-narrow.png).
- [Hidden Electron fulfillment](desktop.png).

These captures preserve the existing engineering baseline. They do not establish accepted visual polish, all-theme accessibility, signed desktop distribution or complete application acceptance. Only isolated acceptance workspaces were converted. No normal workspace or default release was migrated.

Next: administrator review of permissions and cross-module grants, readiness diagnostics, coordinated cutover/recovery controls, then default public-SDK business releases. Independent release/performance gates remain open.
