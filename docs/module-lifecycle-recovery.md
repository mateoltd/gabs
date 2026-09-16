# Device module lifecycle and recovery (EXT-04)

Module installation records describe a device's accepted release selection. They do not grant corporate authority: every business operation still checks current server permissions, assignment, entitlement, configuration and module availability.

## Installation and update

The client holds one account/workspace installation lock and reads the current release policy after acquiring it. It resolves host/backend compatibility, pins, stored schema and dependencies. Inconsistent dependency selections report which versions need administrator attention.

Before downloading, it durably saves an attempt containing a stable request ID, device ID, exact module/version/digest selections, start time and phase. These records use the existing scoped IndexedDB store on web and encrypted record persistence in the Electron utility process. Each complete package is signature-checked and retained independently, so a resumed attempt reuses verified downloads. Interrupted transfers restart that package; this is not byte-range HTTP transfer resumption.

Once every package verifies, the attempt changes to **awaiting confirmation**. The server requires the exact downloaded selection and rejects changed policy before accepting device records. The device selection, audit entry and idempotency result commit together. The reply contains a typed receipt. Local installed packages switch together only after a matching receipt; the previous release set stays intact until that local write succeeds.

Lost responses, process interruption and local write failures retain the same attempt. Retrying reuses its request ID. Replaying an old receipt rechecks current authorization, release policy and device state; it cannot undo a later removal or reinstall. A definitive rejection clears that attempt while preserving business data and a local explanation. A changed selection settles an uncertain earlier request before creating a new one.

Resume controls reuse pending intent even if background recovery finishes while the click is waiting. Installing a dependent at the same version preserves its dependency’s original receipt, so independent recovery can still finish.

Modules shows pending confirmation, resumable installation/removal and repair controls. A server record without the matching local version is labelled **Device setup incomplete**. Background completion refreshes the displayed state. Module-specific failures remain with their module and clear after recovery; authentication and workspace revocation still invoke the host's identity handling.

## Local executable storage

Executable packages are stored as immutable, content-addressed chunks, scoped to account and workspace. Installed entries and staged downloads reference the same bytes. The module-state record retains metadata, drafts, pages, the journal and pending receipts, without duplicate executable payloads. Each chunk is at most 256 Ki UTF-16 code units and stays below the existing 2 MiB serialized IPC write bound, including JSON escaping; serialized package UTF-8 size is limited to 64 MiB. This is a package bound, not a whole-workspace quota.

All chunks are durable before the single metadata commit switches the release set. A failed write keeps the prior release set. Readers and writers share a workspace lock, and unreferenced bytes from old versions or interrupted writes are collected before the next mutation. Existing inline records migrate on their next successful write. Missing or corrupted package chunks invalidate that executable while preserving drafts and unrelated installed modules for repair. The desktop pruning capability accepts only the artifact namespace for the authenticated profile and supplied workspace; it cannot delete arbitrary paths. Workspace/profile purging also removes their artifact chunks.

Business-cache working-set selection and quotas remain OFF-02. This change removes the catalog-size coupling to one IPC record; it does not claim unlimited local storage or efficient selective hydration of every cache access.

## Repair and removal

Repair starts a fresh verification pass. If that pass is interrupted, verified packages from the same attempt can be reused. Runtime entry checks the root and every installed dependency, including signatures, versions, activation, assignment and pending local removal. Offline entry additionally relies on the host's existing authorization lease; this change does not extend it.

Uninstall takes the same installation lock and uses its own durable request. A pending removal blocks local runtime entry, including offline entry, until the outcome is resolved. The server checks dependencies against the releases actually installed on that device. Publishing a newer dependency-free release does not permit removal of a dependency still required by an installed older release.

Accepted removal deletes only the local executable installation and its downloaded package cache. Business records, drafts and the operation journal remain. Reinstall can restore access to those records. Destructive business-data deletion is a separate action and is not part of uninstall.

## Pins, migrations and suspension

Pin changes validate affected active modules, dependency selections and stored-schema compatibility before committing. An incompatible pin leaves the previous policy intact. Executable rollback never rolls stored data backward: the earlier executable must declare compatibility, and its writes must satisfy the current stored schema. See [storage migrations](module-storage-migrations.md).

Suspension and revocation reject server installation acceptance and receipt replays. A disconnected client cannot learn new corporate policy before reconnecting or its existing offline lease expires. Mandatory/optional rollout controls, targeted deployment cohorts, pushed invalidation and lifecycle dashboards remain EXT-05/GOV-04/OPS-02 work.

## Standalone local profiles

Standalone profiles use their encrypted local vault and local authority. Their saved download set records the selected root/dependency versions and source account/personal workspace. Each verified package is committed separately; reconnecting resumes only missing packages through current server access checks. A different account/workspace cannot resume those requests. Once every package is present, configuration review and installation can finish offline.

`LocalSession.beginDownload`, `saveDownload`, `dismissDownload` and `installDownload` expose this host lifecycle. Installing revalidates the complete release set and consumes the download in the same durable commit that stages the recoverable installation attempt. Downloading alone never activates code. Invalid configuration keeps the saved set; interruption after staging uses the existing installation recovery. Discarding downloads preserves installed code, business records and operation receipts. See [verified web/native recovery](verification/local-downloads/README.md).

Recovery is per complete package, without HTTP byte-range resumption. This explicitly local workflow does not finalize corporate business changes or replace corporate entitlement/lease checks. Local lifecycle history and a general retained-release selector remain in SDK-02.

## Release scope

[Local acceptance](verification/module-recovery/README.md) covers browser reload, complete native Electron process restart, failure recovery, exact selections, corruption, compatible rollback and data-preserving uninstall. This candidate changes the unreleased installation command contract: clients must send exact selections and consume receipts. Rebuild clients with the candidate. Mixed released-client protocol compatibility, hosted trust rotation and signed/notarized cross-platform update acceptance remain separate release gates; this document does not claim them complete.
