# #900 — Bound all-history latest absence evaluation

Baseline: `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2`. Issue: <https://github.com/lolotam/PayPos.systems/issues/900>.

## Requirements

- Query-only optimization of the maximum eligible absent `working_date` over all history, independent of page dates, filters or cursor. No arbitrary lookback limit or migration.
- Preserve one SQL statement/snapshot, authorization, saved `as_of`, ended-shift and employment bounds, readable attendance branches, and leave/session suppression across the business including hidden branches.
- Use indexed backward `starts_at` seeking plus a proven timezone-safe refinement bound. Descending instant order is not working-date order; include timestamp ties and all unseen candidates that could beat the seed date.
- Document the stop proof using explicit UTC conversions and materialized working-day constraints. A LIMIT above a full-history aggregate is not an optimization.
- Keep existing 200 ms thresholds, five warmups, fifty samples, seed semantics and exact scenario assertions unchanged. No-absence can exhaust history; never claim constant time.

## Acceptance and proof

Real PostgreSQL result parity and EXPLAIN ANALYZE/BUFFERS evidence cover recent-hit early stopping, old latest absence, exhaustive no-absence, empty history and absence outside page dates. Cover multi-year data, Kiritimati versus UTC-12 date-order inversion, non-UTC database sessions, DST, overnight/split days, tie/boundary equality and hidden-branch leave/session suppression.

## Scope

Only staff `queries/leave-history-last.sql.ts`, at most one adjacent `leave-history-last-absence.sql.ts` helper, new dedicated `__tests__/leave-history-latest-absence*.ts` regressions/fixtures, and this task's docs. Existing history files are read-only unless manager explicitly extends this task-exclusive allowlist. Existing performance suite/fixture remains unchanged.

No new index, cache, job, migration, shared test infrastructure, contracts/OpenAPI, root configuration, lockfile, workflows or global-doc changes. Expected authored additions plus deletions: 700 lines; more than 1400 requires rescoping.
