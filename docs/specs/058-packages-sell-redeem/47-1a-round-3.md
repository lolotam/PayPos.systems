# 47-1a — correction round 3 of 3 (final)

Thread 4482401713 identifies an early acknowledgement risk during the 47-1b rolling
activation. The manager withdrew the round-2 registration instruction. This correction
supersedes round 2's known-type choice and restores ADR-0010's rollout invariant.

`PackageImportPreviewRequested` is removed from the production known-event list.
Coverage has one explicit, test-only exclusion for this deliberately fenced producer,
with an ADR-0010/47-1b comment. Every other emitted event remains subject to exactly
the existing recognition check. No prior exclusion mechanism existed in this spec.

The existing deliverer test infrastructure proves that the actual assembled known
types do not acknowledge this event: delivery returns false, `TypeError`, and the
normal first-attempt backoff; no tenant transaction occurs. No consumer or transport
is added. Production routes remain 404 until the real consumer is activated in 47-1b.

The manager owns review triggers. No Codex/MergePilot request or merge is authorized
here. Only thread 4482401713 will be answered and resolved after the single push.
After this last correction round, new P2/P3 findings become linked follow-up issues;
P0/P1 continue to block. Hamza's failed review is reserved for Waleed's decision.

The initial parallel outbox run passed 55 tests, including the new retry case, but
the existing TypeScript emitted-event enumeration exceeded its 20-second timeout
(46 seconds). The timeout and enumeration semantics were not weakened; the whole
outbox directory is rerun alone after other local gates finish. Slice API/domain
tests passed **30/30**, with warm HTTP median **84.2615 ms**. Contracts/OpenAPI
passed **7**, labels **4**. Guard passes cover the small registry/test/docs delta.

Final isolated outbox rerun passed **56/56 across five files**, including all 12
known-event spec tests and the new retry assertion, without timeout changes.
Typecheck passed **29 tasks**, lint/boundaries **30 tasks**, docs lint **0 errors /
29 existing warnings**; role defaults **1080**; module-map, formatting and diff
checks passed. Private test Postgres and Redis are removed before publication.
