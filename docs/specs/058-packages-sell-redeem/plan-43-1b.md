# 43-1b writer refusals

PP-121.4 explicitly authorizes building this dependent slice in the same session
after storage push, before storage merges. The manager's later explicit no-waiting
instruction also authorizes stacked PR #839 before storage merges, with #838's
branch as base. The manager will retarget it to main before deleting that branch.
No migration or deployment belongs to this slice; manager owns both merges.

## Implementation

1. Extend the existing shared locked-line reader and port with nullable
   `redemption_id`, read under the same existing line lock and tenant transaction.
2. Feed the marker into domain refusal facts: price edits use
   `SESSION_LINE_PRICE_NOT_EDITABLE`; cancellation sets existing `not_cancellable` and
   performer changes set existing `not_changeable`, producing
   `SESSION_LINE_NOT_CANCELLABLE` and `SESSION_LINE_PERFORMERS_NOT_CHANGEABLE`.
   Preserve authority checks, identity policy and revision/status ordering.
3. Update paid-line fixtures with a null marker. Add focused own-private-PG16
   integration tests using a fully valid forced redemption, proving all three
   writers refuse without history, money, performers, revision or slot changes.
   Retain paid success/replay behavior and authorization-before-refusal negatives.

Target 300–700 authored additions plus deletions, including tests and docs. Stop
for a split plan above twice that bound. No sale-writer or generic authorization
files. No new model/provider or top-level task session.

## Verification and publication

Use the existing task-owned PG16 lane at loopback 55445, ADR0006 clones and the
journalled 0205 dependency. Focused local tests, typecheck, lint, docs and module
boundaries only (PP-113); no full local API/E2E suite. Independent Astra review,
all five current-head GitHub receipts and exact-head/current-base CI remain
required. Consolidate all findings under PP-119.1 and preserve the session's
existing correction counters. Manager owns merge.
