# debate 46 - pospay-advisor (Fable), one combined round (design advisor + debate)

Astra is out of quota until 11-14; manager decision 2026-11-12: one `pospay-advisor` round covers both the spec 058 section 7
design-advisor requirement and the debate. Verdict from the advisor: agree with changes. Findings below are the advisor's,
summarised; the verdict column is mine. All accepted; the plan addendum (plan-46.md section 6) carries them.

| # | Sev | Finding | Verdict |
| --- | --- | --- | --- |
| 1 | P1 | Integrity bypass after a constraint flush or in a later transaction (extra refund-slot row for a committed refund). Fix: one `package_refund_validate(company, refund)` called from all four deferred triggers, fail closed on NOT FOUND; plus an immediate statement-level `AFTER INSERT` on `package_refund_slots` refusing more slots than `refund.sessions` | accept |
| 2 | P1 | Revision and amount arithmetic wrong for non-last refunds and for 0.000 refunds. Fix: aggregate check on the entitlement locked `FOR UPDATE` in the validator: `refunded_amount = sum(amount)`, `revision = 1 + count(*)`, `max(entitlement_revision) = revision`; two refunds in one transaction legal at DB level, tested | accept |
| 3 | P1 | Slot guard must be an explicit allowlist: `OLD,NEW in {FREE,USED}` or `FREE -> REFUNDED`; keep constraint names and `to_jsonb` identity; the 0205 `redemption_complete` trigger must pass on `FREE -> REFUNDED` | accept |
| 4 | P2 | Entitlement guard: `NEW >= OLD`; revision exactly OLD+1 whenever amount or revision changes; amount change without revision change refused; `refunded_amount <= price_paid`; keep the expiry block and eight-key jsonb exclusion list verbatim | accept |
| 5 | P2 | Drop the vestigial "transaction pair / NULL system id" wording | accept |
| 6 | P2 | Lock-proof tests (hold component, then entitlement, from a second connection); slots `ORDER BY id FOR UPDATE` | accept |
| 7 | P2 | Slot update `WHERE state = 'FREE' ... RETURNING`, row count must equal `sessions`; ordinal to slot-id map in persistence | accept |
| 8 | P2 | Event payload built through the contract schema (strict object: `sale_id`, `business_id` included), money as three-decimal strings; builder placed for 42-3b1 reuse | accept |
| 9 | P2 | Earlier negative tests asserting the closed refund guards are rewritten, each listed in the Agy brief | accept |
| 10 | P2 | Extra DB tests: IMMEDIATE then DEFERRED then extra writes, slot added to a committed refund, two refunds in one transaction, revision +2, amount without revision, `IMPORTED_USED -> REFUNDED`, `REFUNDED -> USED`, wrong `entitlement_revision`, zero refund row, extension still works, 365-slot refund within 200 ms | accept, trimmed to this list (manager: keep DB specs to listed edge cases) |
| 11 | P2 | Spec sub-PR table must be updated in this PR (column, module-map row, ADR-0010 addendum move from 46-2a to this PR) | accept |
| 12 | P3 | Fingerprint includes entitlementId and branchId; `refunded_at` from `Clock`; `SET LOCAL lock_timeout`; RF-01 bell assertion deferred to 46-3 | accept |

Missing evidence the advisor named: I verify that record, append and cancel writers take the access lock before the component
lock (read `service-session-transactions.ts`) and that no `SELECT *` reader of `business_settings` exposes the new column.
