# 43-1 personal manager plan review

Disposition: approved for bounded implementation, with the clarifications below.
The migration lane is NOT granted by this review.

The manager read `plan-43-1.md` and the complete saved Astra response, and checked
the storage requirements, current slot schema/0200 guards and actual database
test setup. This is plan review only; no implementation or database-test success
is claimed.

## Accepted design

All six Astra findings are addressed by the proposed design: final-state checks
from both ends and the removed slot pointer; one-way cancellation-backed
reversal with subsequent reuse; immediate marker/money immutability; standalone
strict draft union without enabling existing routes; retention of 0200 seals,
terminal-state and future-transition closures; complete ACL/table/function/FK
inventory with SQL-owned deferred circular constraints.

Keep missing or RLS-hidden referenced rows fail-closed. Foreign-key existence
alone must not replace the customer/service/amount and reciprocal-link checks.
Preserve every existing paid-line and historical-event contract. A storage-only
PR does not add the 43-1b application refusals or a redemption writer.

## Bounds and ownership

- Up to 2500 authored additions plus deletions, including SQL, tests, fixtures,
  plan, receipts and this review. The 1700–2500 range is an estimate, not a claim
  about completed work.
- Up to 30000 generated additions plus deletions, limited to one schema snapshot,
  its journal entry and actually required contract/OpenAPI/client generation.
- Combined maximum 32500. Report all three counts. If any bound is exceeded,
  stop for a revised artifact/split plan rather than hiding generated lines,
  removing tests or editing generated output by hand.

The large snapshot allowance is justified by the existing 26369-line baseline
and applies only to this storage PR. It does not raise other task size limits.
Do not produce a second duplicate snapshot merely to hold custom guard SQL.

The existing PP-120 session implements and tests 43-1, then starts 43-1b only
after verified storage merge. Keep one PR active at a time. No new session,
model substitution, Opus/Claude request, application activation or deployment.

## Private tests before the lane grant

The existing global setup only migrates journalled files. An unnumbered SQL file
is not picked up automatically. Record the exact task-local test preparation
which applies the reviewed candidate SQL to each private clone (or to the private
template before cloning), after baseline migrations and before test data.
Use the same candidate SQL intended for the eventual migration; no substitute
schema, disabled guards or shared-harness changes just to make the tests pass.

That preparation is restricted to the verified task-owned PG16 container and
fresh databases. Never fall back to port 5432, another task's cluster or staging.
Keep the temporary candidate/test routing outside the production migration
journal. Baseline and candidate execution results must be distinguished in the
receipt. After a later lane grant, regenerate against then-current main, preserve
custom SQL ordering, and rerun relevant tests against the actual journalled
migration and generated artifacts; pre-lane candidate tests do not certify those
future artifacts.

## Lane hold

Implementation, reviewed unnumbered SQL and private testing may proceed under
PP-121. Migration numbering/renumbering, `db:generate` and any push remain held
until the manager explicitly says `lane granted`. Do not reserve 0204. The
current sequence is #793, then #785, then this storage turn as coordinated by the
manager. Its merge additionally requires the owner's applicable migration
authorization, fresh backup/restore, current-head CI/reviews and current base.

Align the plan with this review before the corresponding implementation step;
no second planning delegate or owner question is required for these settled
clarifications. Report an actual implementation conflict rather than guessing.
