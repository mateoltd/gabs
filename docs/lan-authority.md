# Local network authority

Local networking is optional and requires a managed company certificate and peer policy. In **Settings → Local network**, a company member can select an available module's relay permission. The native main process verifies the selected actor, workspace, exact release and capability; the renderer selection is not a bearer grant. A `lan.status` declaration cannot start a listener.

## Connected and offline startup

- A connected module session uses current server authorization. Its authorization lasts at most one minute and is renewed every 15 seconds, before incoming receipts and before outgoing transfers. Online-only sessions can run even when corporate offline storage is disabled.
- To prepare offline startup, enable offline storage on the device while connected and use a module declaring `offline: "lease"` for its relay capability. Enabling that module's network access prepares its signed grants. Opening the module's custom view also prepares declared device grants through the shared host mechanism.
- After a process restart with the API unreachable, Settings remains available within the corporate offline lease. Select the module and explicitly enable local networking. The main process verifies its protected package and signed grant, including issuer trust, exact contract, account/workspace, current known permissions, policy revision, expiry and clock history.
- A server denial never falls back to a cached lease. Known revocation, expiry, clock rollback, opt-out or a different profile prevents offline startup. Connected reacquisition is required to recover expired or invalidated authority.
- Administrators retain the existing connected **Workspace administration** option. For offline startup they use a module's signed relay grant, with the same checks as an employee.

Offline grants last no longer than the workspace policy and the 24-hour maximum. A disconnected client cannot learn a new remote revocation until reconnection or lease expiry. No renderer-supplied permission list, connectivity flag or timestamp extends the grant. Certificate provisioning and peer trust remain separate from module authorization.

## Transport and data boundaries

A module-selected session accepts incoming and outgoing envelopes only for that selected module. Outgoing SDK calls also require their own current capability authorization. Incoming data remains encrypted quarantine; receipt does not finalize corporate changes. Changing network access requires stopping and enabling the selected session. The existing workspace administrator session retains its workspace-wide quarantine behavior.

Expiry bounds discovery as well as active traffic. Disable, logout, profile changes and authorization failures invalidate in-flight startup and stop the managed listener. Enabling a different workspace replaces the previous session; status and effects remain scoped to the session workspace. Module authority is checked during idle periods as well as data transfer. The persistent peer indicator uses current native status and disappears when the session is no longer available.

Settings permits local appearance preferences and authorized LAN control offline. Workspace policy, corporate appearance and billing changes remain connected operations. Corporate lease expiry still locks access to the workspace.

## Remaining acceptance

Employee receipt review/submission, archive/file recovery and inactive-release/remote-dependency reconciliation remain required follow-up work. The existing recovery interface requires same-account administrator authority; module session access does not grant that permission. Broader explicit-sign-out/profile recovery, production certificates, other target operating systems and deployment-network acceptance retain their tracker gates.
