# 42-3 personal manager plan review

Reviewed 2026-11-04 at 23:50 Kuwait against `f7b6f9ef`.

## Disposition

Approve the corrected sale design for implementation in the existing Codex Sol
medium session after reconciling the plan text listed below. This is the required
one-time manager review, not an assertion that Astra returned a later READY
receipt. Astra's reported NEEDS REVISION result remains part of the audit; the
corrections must be verified in the implementation review.

The manager read the complete `plan-42-3.md`, the current service-session access
reader and identity exports, the reused session-reader ports and place adapter,
and the existing tenancy timezone reader inventory.

## Ownership decision

Choose D-1(a): 42-3 owns the narrow permission-parameter extraction in
`identity/persistence/service-session-access.ts`, its package-sale wrapper, and
the corresponding export addition in `identity/index.ts`. Preserve every
existing service-session permission, owner/DENY rule, feature check, role snapshot
and transaction behavior. Keep the existing regression coverage.

42-4a was told not to edit these files. It retains the generic authorization port,
adapter, authorizer, AccessGuard/FeatureGuard and startup-test scope. Neither task
changes the public shared `RequestAuthorizer` interface. Both reuse the existing
feature reader; coordinate before any proposed change to that shared helper.

## Corrections to consolidate before code

1. Incorporate section 9 into the operative touch map, transaction-port description,
   pseudocode and test list. Do not leave the main plan describing the old
   business-only place reader while the addendum requires branch timezone.
   The new narrow tenancy read proves company/business/active-branch ownership
   and returns branch timezone with business fallback. Keep the visit reader
   unchanged. Include its public export, orders adapter, module-map read contract,
   result-shape/isolation and EXPLAIN checks in scope and size.
2. Keep the sale-specific expected-error mapping and preservation of details.
   No reuse of the session cleanup path that masks package errors. Verify real
   HTTP refusals and full rollback, including commit-time and audit/outbox failures.
3. IDs are pre-generated outside the pure domain and passed as data. Domain types
   must not import database audit types. Reuse existing money calculations and
   never perform money arithmetic in the use case.
4. Preserve the accepted lock order and fresh authorization/seller reads after
   waits. Keep concurrent same-key commit/replay and rollback/retry, revocation,
   expiry, DENY and feature-off proofs. A replay after catalog/month changes
   returns the recorded response without repricing or revalidating sale age,
   while still enforcing current caller authorization.
5. The single-PR approach is accepted within the original 2800 changed-line
   limit. The 2130 estimate is not the full delivery size: count added/deleted
   handwritten code, tests, this plan/review and generated artifacts. Re-estimate
   the added tenancy reader and tests before code. If the estimate or actual
   delivery exceeds 2800, stop and present the genuine domain/use-case split;
   do not compress documentation, remove tests or silently raise the limit.
6. SA-10 remains a real go/no-go gate: one warmup, five measured complete
   transactions including COMMIT, each below 200 ms, with environment and all
   durations recorded. A failure returns to the spec; do not weaken seals,
   transaction boundaries or the test. No migration is authorized by this review.

No new owner decision is needed for these settled corrections. Preserve the
disclosed first failed Astra attempt and second result rather than claiming two
successful reviews. Complete all governing-document reading before application
edits. Keep implementation checks and independent review gates in full; merge
and merge order remain with the manager.

## Size-gate disposition — 2026-11-04, 23:52 Kuwait

The inclusive revised estimate is 3140 added/deleted lines, above the original
2800 boundary. The full sale implementation remains stopped. The manager
approves the genuine sequence already described in plan section 7:

- **42-3a**, pure domain rules, fixed-data sale plan, typed errors and complete
  domain tests, plus the full planning/review audit. Expected 1000–1150 changed
  lines. No use case, persistence writer, route, timezone adapter or generated
  API artifacts. This is the current session's sole PR under the existing Sol
  medium trial. Update the spec's execution row to name the two parts and their
  dependency, without changing business requirements.
- **42-3b**, complete transactional sale integration and all DB/HTTP/race/replay/
  performance tests, after verified merge of 42-3a. Expected 2050–2300 changed
  lines. It is not started or assigned to this same session now. Its separate
  PR requires its own session within the existing slot limit; there is no
  authorization here for a second PR in this session or another Sol trial slot.

Apply the pipeline's twice-estimate size rule and the existing stricter absolute
boundary; do not increase limits, compress documentation, or remove tests.
No financial route ships in 42-3a, and 42-3b must include all acceptance evidence
before its route ships. Re-estimate both parts honestly as work becomes concrete.

The previously reserved identity access/export edits belong to the later 42-3b
scope; the current 42-3a must not touch them. Before 42-3b starts, refresh its
ownership against any merged 42-4a work. The next two newly started sessions
remain MiniMax under PP-120 unless Waleed changes that decision. No new session
is opened by this disposition.
