# shadcn/ui components

Breadcrumb and Dropdown Menu were pulled from the official shadcn/ui Base UI registry:

- https://ui.shadcn.com/r/styles/base-nova/breadcrumb.json
- https://ui.shadcn.com/r/styles/base-nova/dropdown-menu.json

The component composition, Base UI primitives, semantic attributes, radio selection, positioning, and render API are retained. Tailwind classes are translated to the shared theme-aware CSS in `styles.css`. Icons use the existing Hugeicons exports. Unused submenus, checkbox items, and breadcrumb ellipsis are omitted. Menu portals respect the application's modal focus boundary.

Upstream source: https://github.com/shadcn-ui/ui (MIT license, included in LICENSE).
