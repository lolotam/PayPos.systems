# 47-1a — correction round 2 of 3

CI run 42048718179, job 127318809277 failed the worker emitted-event coverage
assertion on `b412b1de`: `PackageImportPreviewRequested` was absent from the worker
registry. The request transaction remains the intended atomic event producer.

The minimal correction registers the type in `KNOWN_EVENT_TYPES`, matching the
existing pre-consumer `PackageSaleChanged` and `SessionTipsChanged` pattern. The
existing parameterized delivery test now includes it, proving acknowledgement
without a consumer or tenant transaction. No consumer, queue or processing behavior
is added. Production routes remain 404 until 47-1b registers the actual consumer;
47-1b must activate consumer and producer together. Removing the event producer
would break the approved atomic acceptance contract and its tests.

Optional UUID normalization follows the existing orders controllers (session-tips,
session-recovery and service-sessions): validated business/preview path IDs use
`id.toLowerCase()`. Integration coverage sends uppercase IDs through POST and GET
and checks canonical pending status. Body file-ID behavior is unchanged.

Verification: worker known-event spec **12 passed**, slice integration **19 passed**,
domain **11**, contracts/OpenAPI **7**. Full HTTP warm median **77.1857 ms** with
the unchanged 200 ms assertion. Docs lint: zero errors, 29 existing warnings.
The three guards were reapplied to this small registry/controller/test/docs delta.
No migration changes, fake consumers, protected use-case edits or review-trigger
comments are included. Exactly one commit and explicit branch push are authorized.

Before publication, inspect the latest panel receipt and include valid new findings
in this same correction. The prior receipt has three completed bots with no published
findings and Hamza failed; this is not PP-126 snapshot-only completion.

Final local gates: typecheck **29 successful tasks**, lint/boundaries **30 successful
tasks**, role-default policy **1080 passed**, permission labels **4 passed**,
module-map and formatting/diff checks passed. The final pre-push receipt inspection
still showed review `PRR_kwDOUlyqPc8AAAABWPA_hA` on `b412b1de`, three completed
bots and Hamza failed, with zero published panel findings. No newer receipt was
available to consolidate. The manager owns the pending panel retry and Codex request.
