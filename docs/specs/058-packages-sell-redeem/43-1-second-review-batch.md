# 43-1 second consolidated review batch

CodeRabbit comments on `c90951d8`: `r4475178907`, `r4475178924`, `r4475178913`.
The manager confirmed that head's complete MergePilot panel and added its sole
finding `r4475278899` (LOW), then authorized publishing all four fixes together.

- Marked the original lane receipt explicitly superseded by PP-123, with both
  0205/0206 assigned to #838 and #785 moved to 0207.
- Replaced the tenant-switch false positive. The control commits a fresh valid
  redemption and verifies its row. A second fresh, precommitted package receives
  another complete valid redemption; the only bad step is switching context as
  the transaction's last statement. Creating the package beforehand keeps 0200's
  deferred conservation check from masking the intended line validation error.
  The refusal asserts `23514 / package_redemption_complete`, no redemption row
  remains, and the slot rolls back to FREE with no pointer.
- The cheap performance fix queues service-line deferred validation only when
  `NEW.redemption_id IS NOT NULL`. The immediate marker guard forbids clearing or
  changing a marker; redemption-side validation still catches a redemption that
  borrows an unmarked paid line. Added a catalog assertion for the WHEN clause.
- Updated slot state/current-redemption schema comments and the grant inventory
  comment to describe the enabled guarded FREE/USED transitions and the remaining
  expiry/refund closures, replacing the stale pre-43-1 claims.

Focused actual journalled PG16 regressions: **77 passed in 4 files, 19.41 seconds**,
started 2026-11-05 03:50:38 Asia/Kuwait. This includes isolation, links, reversal
and FK/trigger catalog checks. Focused ESLint passed; no full suite was repeated.

The independent PP-123 recheck of c90951d8 was APPROVED with complete reads;
it remains the earlier-head receipt, not certification of this local batch.
DB typecheck and diff whitespace checks also passed. Fresh exact-head generation
and drizzle-kit check must pass before publication, preserving snapshot204→206.
Current session review/fix budget advances from 3/5 to **4/5** when this batch is
published; #838 correction pushes advance to **2**. The subsequent dependency-only
merge/push to #839 is not another review/fix cycle. Never reset either budget.
No merge or deploy authorization.
