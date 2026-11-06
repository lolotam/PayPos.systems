# 47-2b — correction round 1 of 3

Baseline: PR #889, c292dcc216088b208cf7c9ba71faaca3941713d6.
The manager confirmed all four panel receipts completed on that head before the
single consolidated correction push. Automatic Codex was clean; no repeat review
was requested by this session.

## Findings and correction

- r4492595443 and r4492598467 are the same created-count issue, treated once at
  the higher MEDIUM severity. The use case collects at most 500 sequential insert
  outcomes. The pure domain count function derives the successful count; existing
  persisted/audit/outbox summary mapping is unchanged. No parallel transaction,
  slot batching, allocation or performance-bound change is introduced.
- r4492595439: an Arabic business-step comment now precedes CommitPackageImport.
- CI run 42220373581 / job 127900699600 was reproduced locally: the original
  package-preview-status assertion at line 230 resolved [] instead of rejecting.
  This was not a timeout or a zero-row proof: UPDATE had no RETURNING, and 0215
  deliberately permits commit_requested-to-failed when only status/error_code
  change. The 47-2b brief explicitly requires that financial failure transition.

The API fixture uses a one-source-row, all-skipped preview and now reaches
commit_requested through real pending-to-ready proof
and accepted-membership transitions. RETURNING proves exactly one row for both
accepted failure and successful zero-created completion. Negative cases preserve
23514 refusals for returning to ready, changing accepted requested_at during
failure, and over-reporting created_count. Failed and committed rows remain
immutable, and a different tenant affects zero rows. Full persisted JSON is
compared after rejected writes. The original failed-result and tenant tests remain.
No production SQL or API behavior was changed to satisfy the stale assertion.

## Review provenance

Waleed 5800318903, MergePilot 5800321512 and Hamza 5800322644 completed on the
baseline. Security receipt 5800394409 also completed, with 0 inline and 0 outside
findings; its two rejected-verification items repeat the count and documentation
issues above.

Security's disclosed primary model was minimax-coding-plan:MiniMax-M3.1-Flash.
It did not answer within 300s (review.callTimeoutMs); the review bot completed
using its fallback openai:gpt-5.6-sol. This session did not request a model change.
That provenance is retained as disclosed, not reported as a completed MiniMax run.

## Verification and release boundary

Focused worker/domain verification: 5 files / 40 tests passed, including immutable
outcomes at the 500-result bound, mixed skips/conflicts, persisted counts, exact
audit/outbox counts, all-skipped success, duplicate jobs and rollback/retry.
The full API status file passed 10 tests after reproducing the original failure.
Only this slice's tests ran locally; the API shards remain CI-only.
Root typecheck, lint, lint:docs, module-map:check, migration-chain:check and the
three boundaries tests passed. The three guard skills were applied to the patch.
Production SQL, slot batching, transaction atomicity and performance/timeout
thresholds are unchanged.

Production/migration SQL, snapshots and journal are unchanged. SHA256:

- 0215: a1900631eb181b8a331bb19f24157969e92ae7b3003b65375ec44a6eb78e1c03.
- 0216: 1361da69949c84ef176933fbec4c205631b0695d3f0321c210fc0843c2a45691.

DEP-1 receipt 008e44fd / restore213 was accepted for the baseline head only.
The new correction head requires the manager's DEP-1 rematch. Migration approval
has not been requested; this session performs no merge, deploy or server change.
