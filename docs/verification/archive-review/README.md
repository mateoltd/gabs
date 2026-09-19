# Explicit archive review

Status: OFF-01-ARCHIVE active; final acceptance pending.

A failed queued archive previously used the generated create/update review handler and opened an empty **New record** form. The real browser baseline reproduced that behavior against the previous built client: `/tmp/gabs-archive-before.log`. The original archive input remains unchanged; this was a review-flow defect, not an accepted business effect.

The new review shows original target/version and a fresh server snapshot. Confirmation settles the original identity first. Accepted originals recover their verified receipt; cancelled originals permit a new durable archive using the explicitly reviewed version. Interrupted replacement preserves the cancellation and original request. Current read/write access and exact installed release are checked before and after settlement and in the final enqueue transaction. Uncertain requests and submitted direct dependents cannot be replaced here.

Focused storage checks passed 63 tests before the final small receipt-provenance addition. Final strict builds, browser/native acceptance and visual inspection are pending. Existing presentation components are reused without style changes. This does not implement archive target reassignment after failed-create collisions, nor complete other legacy/profile/release gates.
