# Application UI

The web and Electron clients share the interface through `@suite/app-web` and `@suite/ui-web`.

## Visual system

- Native system typography on macOS, with bundled Inter Variable as the interface fallback. IBM Plex Mono distinguishes SKUs and record identifiers. Bundled fonts are cached with application assets.
- Hugeicons Stroke Rounded for content controls and Phosphor filled icons for the compact navigation rail, through static `@suite/ui-web/icons` exports. Icon-only controls have accessible names.
- Sentence-case titles that name the view: Overview, Orders, Inventory, People & access. No eyebrow labels or promotional headings.
- The application fills its viewport. A mockup's surrounding wallpaper, device frame, outer padding, and presentation shadows are not application UI.
- Charcoal surfaces, warm white primary actions, subtle complete outlines, quiet status dots, and tabular numbers. Light, dark, system appearance, contrast preferences, and reduced motion remain supported. Dark is the initial appearance when there is no saved preference.
- Desktop translucency uses macOS under-window vibrancy with a translucent shared shell. Browser and other desktop platforms use the same surface palette. The app never paints the reference image's external wallpaper.
- A 50px navigation rail shares the translucent shell with an 8px inset around the main surface. Navigation uses 18px filled icons in compact 34px targets with even spacing and a faint, unoutlined background for the current page. Touch targets expand to 44px in the mobile drawer. Content summaries use quiet filled surfaces with 24px corners. Search and action buttons use pill geometry, icon-only actions use circles, form fields use 16px corners, and table-row highlights use 12px corners. The order inspector is narrower and inset on its outer edges.
- macOS keeps its real close, minimize, and full-screen controls inside the shared header. The header is draggable, with interactive controls excluded from dragging; sign-in and narrow windows reserve space for the native controls. Other desktop platforms retain their standard native title bars.
- One primary page action, explicit save/connectivity states, and task-specific empty/loading states.

## Form controls and feedback

Shared `@suite/ui-web` controls use Base UI for selects, action menus, checkboxes, number fields, tooltips, and toasts. Inputs, textareas, and the file picker share the same surface, outline, disabled, invalid, and focus styles. The file picker keeps the operating system's file selection dialog.

Select popups support typeahead, keyboard navigation, selected indicators, scrolling, and viewport collision handling. Popups inside dialogs stay within the dialog's focus boundary; Escape closes the popup before the dialog. Number fields offer styled steppers and keep decimal and negative entry available where the form permits them.

Navigation and icon buttons show tooltips on hover or keyboard focus. Successful product, stock, draft, and workspace saves produce dismissible Base UI toasts; actionable errors stay beside the relevant form. Discarding a local draft uses an in-app confirmation. All feedback uses the existing light/dark palette and honors reduced motion.

References: [Base UI](https://base-ui.com/react/overview/quick-start), [shadcn Base UI Select](https://ui.shadcn.com/docs/components/base/select).

## Navigation and workflows

The compact navigation rail exposes labels on hover and keyboard focus. A shadcn Base UI breadcrumb shows the workspace and current page. The workspace crumb links to Overview; the separate icon at the top of the rail opens a shadcn dropdown radio menu for switching workspaces. Search, notifications, and the account menu share the header. Small-screen navigation uses a focus trap and makes obscured content inert.

Breadcrumb and action menus use the official shadcn Base UI component composition, restyled in shared CSS. Menu rows use a compact type scale, 4px corners, local selection feedback, and a thin complete popup outline without shadow. The previous workspace select styling is removed. Header controls use neutral local keyboard focus; rail hover uses a subtle local fill, while the current page retains its selected tile. Tooltips use a small contrasting label with no border or shadow. Upstream sources and license are recorded in `packages/ui-web/src/shadcn`.

Workspace search opens from the header or Command/Control+K. It finds permitted pages, orders by customer, and products by name/SKU within the selected workspace. Product results open an Inventory search for the selected SKU. Workspace switching resets the search and its query scope.

The search palette groups page, order, and product results and supports arrow-key navigation, Enter to open, and Escape to dismiss. Dialogs use one flat surface without backdrop blur or a shadow halo. The order editor separates customer details, items, and total through spacing and typography; the total stays beside the save action.

Unused workspaces show one compact starting point with authorized inventory and order actions. The populated overview uses the Work surface composition: three compact summary panels, one primary order table, and a smaller stock-review panel beside it. The order queue keeps each count beside its action label and opens the table's Ready to fulfill view; keyboard-accessible tabs switch between the oldest confirmed orders and recent activity. Each table row has one accessible link covering its rounded hover area. Draft and inventory summaries navigate to their source lists. The fulfillment chart labels all seven days and their exact counts, including zero-height days, with the UTC date range below the plot. Stock health uses a 25-cell percentage grid; partial cells preserve exact proportions for any product count, with accessible counts and a tooltip explaining the scale. Low stock includes active products with ten or fewer available units. Reserved units are excluded from availability. Summaries use the same number scale, while the main table and the stock list use spacing instead of repeated separators. Single-module, empty, and cached offline states remain explicit and do not invent totals.

Orders applies status filters before server pagination. On wider windows, selecting an order opens a persistent nonmodal detail panel beside the interactive list. Smaller windows use a focus-trapped dialog. The list scrolls independently of its title, filters, and summary. Orders uses a borderless table with quiet hover, inspected-row, and checkbox-selection fills. A header checkbox selects the current page; search, status, page, workspace, and connectivity changes clear selection. The search row shows a selected count and permission-aware Confirm, Fulfill, and Cancel actions. Bulk review names eligible orders and skipped records before changes; results report partial failures and retain failed selections. Single and bulk commands share version checks and durable idempotency keys for safe retries. The summary pairs the current fulfillment queue and a draft-review link with exact daily fulfillment bars. Counts come from workspace-wide server totals, dates use UTC, zero days have zero height, and today is identified as incomplete in the tooltip. An empty week shows a message. Detail activity comes from that order's allowlisted audit events. No simulated metrics or activity are rendered.

Inventory supports a low-stock filter for active products with ten or fewer available units. Offline views identify cached records and do not present partial cached records as workspace-wide totals. Local drafts retain explicit save/upload/conflict behavior.

Filters support arrow keys, Home and End. Dialogs preserve contents during closing, restore focus, and disable closing content. Web updates appear as a compact control above Settings in the navigation rail, or beside Help in the sign-in footer. The control opens a small menu with a save reminder and an explicit reload action; an available update does not shift the page or interrupt unsaved work.

## Sign-in

Sign-in uses a full-height split layout: a compact account form on the left and the supplied orange halftone artwork on the right. Small screens hide the decorative artwork to prioritize account access.

The artwork and reusable filter are bundled in `packages/app-web/src/artwork`. The filter was supplied by the user. Its regular grid encodes source brightness in circle area. Rendering keeps a 12 CSS-pixel pitch while fitting the source to the pane, retains supersampling for high-density screens, debounces resizing, and bounds the working surface. Artwork failure cannot block sign-in.

Local preview accounts and unconfigured desktop builds have truthful, separate states. Managed sign-in accepts an email hint or opens single sign-on; account creation opens the hosted signup flow. Passwords, Google/other enabled providers, and recovery remain on Auth0 Universal Login. The app does not invent active provider connections, legal-policy links, or language support. Native login options are allowlisted and cannot override callback URLs, state, nonce, or PKCE.

## Motion

`packages/ui-web/src/motion.css` owns shared motion tokens and the transitions-dev modal, sliding-tabs, and panel-reveal recipes. Modal opening is 250 ms and closing is 150 ms; the backdrop follows the same presence lifecycle. The tab indicator moves over 250 ms. Detail-panel opening is 400 ms and closing is 350 ms, with the list resizing alongside it. React reads close timing from CSS and handles both `ms` and `s`, including production minification. Closing surfaces retain their contents, become inert, and restore focus after dismissal.

`packages/app-web/src/motion.css` sequences initial content by hierarchy: shell, heading, controls, primary data, then supporting panels. Staggers are capped at 200 ms. Page navigation uses a 250 ms content-only View Transition, keeping the navigation and header live. Snapshot navigation suppresses duplicate child entrances so the browser captures opaque content. Unsupported browsers retain the entrance animations; reduced-motion preferences bypass snapshots and remove CSS and JavaScript motion.

Orders, products, stock history, and audit pagination retain the previous query result while fetching. The result region announces its pending state and pagination prevents repeated requests until the new cursor resolves. Data arrives with a short reveal without remounting controls. People tabs share the same result transition. Initial list and overview requests use sized skeletons; background refreshes do not replay entrance motion. The sign-in artwork has a one-time fade and remains stationary.

## Preserving the established interface

The September 2026 [reconciliation baseline](verification/ui-reconciliation/README.md) records the restored interface. Unconfigured workspaces use `modern-dark` without overriding the existing shared geometry, typography or shadows. Its name does not force dark mode: light, dark, system and high contrast remain separate preferences. A different workspace archetype applies only when explicitly selected; visiting Settings must not silently select or cache one.

Keep Overview, Orders and Inventory first in the rail, with their distinct icons. New modules are discovered through contracts and use the shared segmented tabs, search, table, form, dialog and page-heading controls. Administration belongs in its own navigation group. Keep settings additions in the shared grid and organize module lifecycle controls by task.

Before extending a screen, inspect its recorded baseline. After changes, verify actual populated and empty views, narrow and wide layouts, relevant themes, keyboard interactions and Electron where applicable. Preserve readable table columns through bounded scrolling. Review the screenshots themselves: passing tests did not catch the local-profile field/background problem. Update evidence deliberately when an intended change has been verified. Never overwrite the baseline just to silence a failing visual comparison.

## References

- [Inter font](https://fontsource.org/fonts/inter)
- [Phosphor React icons](https://github.com/phosphor-icons/react)
- [Hugeicons React integration](https://hugeicons.com/docs/integrations/react/quick-start)
- [Transitions.dev](https://transitions.dev)
- [Auth0 Universal Login and sign-in hints](https://auth0.com/docs/authenticate/login/auth0-universal-login/universal-login-vs-classic-login/universal-experience)
- [Electron BrowserWindow vibrancy](https://www.electronjs.org/docs/latest/api/browser-window)
- [Local verification](verification/README.md)

## Shared operational lists (UI-R02)

`packages/ui-web/src/work-list.tsx` and `work-list.css` own the common list foundation. Every native table renders through `Table`; `ListTable` adds bounded horizontal scrolling. `ListPage`, `ListToolbar`, `SummaryStrip` and `RecordIdentity` provide shared page spacing, controls, summary surfaces and primary/secondary identity hierarchy. The generic `DataTable`, generated module tables, Orders, Inventory, People, Audit and administrative tables use this base. Notification/export rows and virtual list items use the same borderless row treatment.

Rows have no outlines or bottom dividers. Use shared cell padding, quiet muted headers, token-based corner geometry and surface fills for hover/selection. Preserve semantic tables and readable columns inside their own scroll area on narrow screens. Page-specific styles may define column widths, numeric alignment and content; they must not rebuild row borders, density or selection geometry.

People combines seat utilization and pending invitations with searchable member, invitation and role views. Permissions and protected roles keep their existing server semantics. Inventory groups product identity with SKU and uses workspace-wide active-product, replenishment and available-unit totals; its replenishment action filters the product list. Zero availability is explicitly out of stock. Offline views do not invent current summary totals. Audit retains exact action keys and complete record IDs beneath readable labels, distinguishes outcomes, separates date/time, and offers refresh and pagination. Empty and exhausted pages are explicit.
