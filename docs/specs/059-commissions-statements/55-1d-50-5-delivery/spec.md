# Closed-month package corrections and commission estimates

Planning baseline `68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51` (2026-11-22). One delivery PR with three ordered work items. The [implementation plan](plan.md) maps each outcome to files and proofs. The governing [059 specification](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/spec.md) and [owner answers](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/owner-questions.ar.md) supply the money and access rules.

## User scenarios and testing

1. **A refund after approval or payment.** A seller earned 3.000 KWD on a 30.000 sale under a 10% package rule. A cumulative refund of 10.000 revises the entitlement to 2.000. With 3.000 frozen and no previous correction, the target records −1.000. A later full refund records −2.000. Replaying either revision leaves the ledger unchanged. The original statement still shows 3.000.
2. **A manager reads the current month.** With the same complete inputs the estimate matches the engine for every seller and performer. A disabled package rule yields zero package commission. A missing applicable plan yields NO_PLAN, and a missing salary required by the selected plan yields NO_SALARY. These statuses must remain distinguishable from a valid zero.
3. **A branch manager reads part of a month.** An employee transfers on the 15th. Each manager sees only sources on days covered by their attachments, including work performed elsewhere. A jointly attached day is visible in either branch. Tiered amounts match the full-month run. A permitted manager viewing only some rows gets a labelled subtotal. Supplying the employee ID cannot reveal additional rows or names.

## Requirements

### 1. Correct the closed source month (55-1d)

- Consume the existing PackageSaleChanged snapshot, including cumulative refunded amount. Preserve revision ordering, valid money, business identity, and business-date period from [50-4](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/50-4-package-sales/spec.md). Revisions may change seller, branch or date. Recompute each distinct affected closed (period, employee) pair, including the previous seller/month whose sale disappeared. Reopen affected REVIEWED periods by D-5. Projection continues when the feature is off.
- Apply FR-039/040 to APPROVED and PAID sources. Reprice the whole employee month after updating the projection. Across frozen, previously corrected and newly computed sources, record each nonzero difference between the new amount and frozen plus already posted. Retain previous, new and signed delta, generation, initiating event and target. A sale uses kind SALE and reference `sale:<id>`. A sale never contributes to service tiers. The existing engine owns proportional refunds for percentage and fixed rules, zero-price handling and rounding.
- Choose the earliest subsequent DRAFT from the locked candidate statuses through the business current month, before reopening any REVIEWED period. Copy attribution for a known (source period, employee, source ref). For a first late sale use its source branch and business date and the closed statement’s frozen attachment intervals. An empty attachment set remains valid. Subsequent corrections preserve that attribution.
- Keep projection, generation, corrections or existing block/bell outcome, REVIEWED return and consumed-event mark atomic. Follow FR-046…049 on missing plan/salary, preserving first-event identity and deduplicating notices. Invalid payload or transaction failure leaves no partial monetary effect. Coverage/replay remains as settled in CS-Q51.

### 2. Estimate on read (50-5)

- Assemble the employee’s month from active service lines and sales, applicable plan versions, overrides and selected salary. Use one full-month engine run per candidate employee. Tips and corrections received in the target month pass through unpriced. Return per-source amounts, sales, tips split by method, corrections separately, total and OK/NO_PLAN/NO_SALARY (FR-021…023). Preserve negative values, informational cash tips and separate card/commission sides as in FR-041/045. Include eligible correction-only employees, including departed employees. Carry inputs arrive with 51-1, their writer with 53-2.
- Compute from available projections in a read-only tenant transaction, including when no statement has been generated. No estimate persistence, period lock, new statement, consumption mark, audit or outbox effect (D-4/7/25). Names come from provider-owned readers under D-16. No approval, settlement, export or staff-self service is part of this delivery.

### 3. Expose the scoped read (50-5)

- Proposed public contract per FR-021: `GET /v1/businesses/:businessId/commissions/periods/:period/estimate?employee_id=`. Validate business UUID, calendar month and optional employee UUID. Human session, commissions feature and grantable `read:commissions:business`; default owner, general manager, business manager, accountant and branch manager (CS-Q14). Apply normal validation, authentication and feature errors. GET needs no Idempotency-Key.
- Resolve the active grant union in the same read transaction. Ignore expired overrides. Subtract every effective DENY. Empty set gives uniform 403. Only a company/business grant without a current relevant DENY gives unrestricted visibility. A union of branch grants covering all branches is still branch-scoped (CM-23g).
- Test employee eligibility from dated attachments or overlapping incoming correction attribution. Price before filtering. Current sources use employee attachments on their business date; corrections use immutable attached branch IDs. Display the actual source branch. Return only visible totals and details. Hide empty-set corrections from branch-scoped readers. Employee filtering cannot distinguish an inaccessible employee from an absent one. Exercise the transfer, union, DENY, simultaneous attachment and mid-month addition cases CM-23b…h.

### Key entities and money contract

Sale revision, monthly projection, frozen source and attachments, correction generation and ledger, blocked correction, dated employee attachment, effective grant scope, transient employee estimate. Use KWD decimal strings with three fractional digits at the wire boundary and Money/bigint mills inside pricing and aggregation. Keep basis points distinct from money. Preserve source precision and the engine’s rounding points.

## Success criteria

The two refund deltas reconcile exactly to the frozen amount. Duplicate, older and concurrent deliveries converge on the same projection and cumulative ledger. A failed delivery retries without duplicate monetary effects. For each CM-23 fixture every visible amount equals its full-month engine amount and every forbidden row, name and amount is absent. Repeated GETs on unchanged input return the same figures and leave database state unchanged.

## Assumptions and decision receipt

Baseline includes the [55-1b](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/plan-55-1b.md), [55-1c](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/plan-55-1c.md) and [55-2](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/plan-55-2.md) paths used below. The established permission is a product decision; its catalog registration is work item 3. No further pricing or branch-policy decision identified. Future implementer selection, Waleed verbatim: «MiniMax Flash بالإعداد المتاح (المقترح). نفس الموديل، وهنسجّل الإعداد الفعلي في التقييم.» Execution settings and independent gates are in the plan.
