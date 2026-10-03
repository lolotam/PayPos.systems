# Feature Specification: Membership discount limit

**Created**: 2026-10-03
**Status**: Implemented; owner decisions recorded 2026-10-03; integrated with the design brand shell
**Input**: Phase 1 PR 7b, per-person discount permission parameter.

Sources: Phase 1 SPEC §4 and M13; plan rows 7b/7c/35/38/39; PRD D-56,
D-44; ADR-0005; PR 7 spec edit policy, holder protection and lock protocol.

## User Scenarios & Testing

### User Story 1 — Set, change or clear a person's limit (P1)

A manager selects a membership on the permissions screen, enters a percentage
and a reason, and saves it. Clearing removes the person's override so a later
business-default reader can apply its configuration.

**Why this priority**: reception needs an explicit authority boundary for discounts.
**Independent Test**: save 12.34%, change to 5.00%, clear, and inspect each audit.

**Acceptance Scenarios**:

1. DL-01: a permitted manager saves 1234 bps; detail and the public reader return 1234.
2. DL-02: changing to 500 records before 1234, after 500 and the required reason.
3. DL-03: clearing records before 500, after null; the reader returns NOT_SET.
4. DL-04: self edits, including a sibling membership, are refused without an audit.
5. DL-05: protection follows active owner holders, including employee holders and siblings.
6. DL-06: missing, expired, denied or out-of-scope authority refuses writes.
7. DL-07: another company's membership cannot be read or edited.
8. DL-08: simultaneous changes serialize; audit before/after forms one complete chain.
9. DL-09: concurrent owner promotion is observed after waiting on membership locks.
10. DL-10: audit failure rolls back the value; existing RLS protects the new column.

### User Story 2 — Reuse the limit and discount arithmetic (P2)

Future service-session recording reads a membership's explicit limit without
assuming an unset value means zero or unlimited.

**Independent Test**: read SET/NOT_SET/MEMBERSHIP_NOT_FOUND results and compute
discount on bigint line prices, including free services and price increases.

### Edge Cases

0 bps and 10000 bps are valid; fractions, negative values, values above 10000,
blank reasons and reasons longer than 500 characters are refused. Repeating a
set/clear writes another audited decision, with only one current value retained.
Inactive memberships and closed companies are refused. List price zero gives
zero discount; net above list never yields a negative discount.

## Requirements

- FR-001: one nullable integer limit per membership, 0–10000 inclusive.
- FR-002: every set/change/clear atomically audits actor, membership, reason,
  parameter permission, before/after and decision time.
- FR-003: require PR 7 management authority and effective possession of
  manage:discounts:company at a scope covering the membership and descendants.
  DENY and expiry apply. Never silently grant default bundles; PR 7a owns them.
- FR-004: reuse PR 7 person-based self protection and locked owner snapshot.
- FR-005: show percentage with two decimals, storing integer bps; translated ar/en
  field, reason, save, clear and errors use the existing owned UI kit.
- FR-006: expose a read capability only through identity/index.ts; retain null as
  NOT_SET, missing/inactive as MEMBERSHIP_NOT_FOUND; no business default here.
- FR-007: pure effectiveDiscountBps and isWithinLimit are exported for future reuse.

### Key Entities

- Membership discount parameter: membership's current optional limit.
- Audit decision: immutable before/after and mandatory reason, with the editor.

## Slice design

### Business rules

- Per line, never per order: (listPrice − net) / listPrice × 10000, with bigint
  money throughout; a lower overridden price also counts. 10000 mills → 8766
  mills is 1234 bps. Free lines give 0; price increases give 0.
- Fractional bps are rounded UP when enforcing the limit (owner decision 2026-10-03): any fraction above the
  limit counts as over the limit and needs approval. This is enforcement precision, not a change to ADR-0005's
  half-away-from-zero rounding of monetary amounts.
- An active owner has no discount limit (owner decision 2026-10-03): nobody may set, change or clear a limit on
  any membership of a person who is an active owner (PERMISSION_OWNER_PROTECTED).
- No role-specific cap is introduced: the requested 0–10000 range is exhaustive.
- Approval issuance/consumption belongs to PRs 38–41; business default belongs to 7c.

### Schema changes

| Table | Change | RLS | Indexes/FKs |
|---|---|---|---|
| memberships | limit_bps nullable integer, CHECK 0..10000 | existing ENABLE/FORCE and bridge policies retained | existing (company_id,id) PK serves reads; no new filter/FK |
| permissions | catalog-only manage:discounts:company | existing global read-only catalog | existing PK; no default role grants |

Generate an additive migration, never modify an existing one. Existing audit_log
retains all history, so there is no new tenant table or new RLS policy.
Lock company FOR NO KEY UPDATE → all memberships ascending id FOR UPDATE;
reload holders/access and sample decision time after locks. Retain locks through
value update and audit commit. Invalidate company/membership grant versions after commit.

### API contract

- POST /v1/permissions/memberships/:membershipId/discount-limit, status 200,
  strict {limit_bps: integer|null, reason: trimmed string 1..500}; null clears.
- Exactly one @Require('manage:memberships:company'); discount authority is
  reloaded and checked inside the transaction against the target scope.
- GET membership detail includes discount_limit: {limit_bps: integer|null}.
- Contract: identity/discount-limit.ts; regenerated OpenAPI/admin/POS clients.
- No feature flag; no financial/stock effect, therefore no Idempotency-Key or outbox
  event (same audit-only parameter lifecycle as PR 7).
- Existing bilingual VALIDATION_FAILED, FORBIDDEN, PERMISSION_SELF_EDIT,
  PERMISSION_OWNER_PROTECTED, PERMISSION_NOT_HELD, PERMISSION_SCOPE_OUTSIDE_REACH,
  NOT_FOUND and TRANSACTION_RETRY_REQUIRED envelopes.

### Permissions

manage:discounts:company is a catalog code; effective grant scopes follow PR 7
COMPANY/BUSINESS/BRANCH semantics. No default grants added; synthetic fixtures
explicitly grant it to the editor. PR 7a owns role bundle decisions.

### Events

None published or consumed. Audit-only permission parameter change.

### Test plan

- Domain: all bps inputs and boundaries, zero list, no discount, price increase,
  exact/fractional ratios, maximum bigint money, inclusive comparison.
- Integration: DL-01..10 through real Postgres/HTTP, existing protection/access,
  negative RLS on memberships and audit rollback; restricted runtime role.
- Queries: public reader result shape and EXPLAIN ANALYZE membership PK usage;
  existing detail query includes new result shape and retains index checks.
- Contracts: strict body, null/zero, invalid integers, reason trim and length,
  OpenAPI route/status/components; UI: save/clear, two decimals, invalid percentage,
  translated errors and disabled self-edit form.
- Gates: pnpm check (FORCE_COLOR unset), builds API and admin; optional-config
  production readiness coverage when module wiring changes.

## Success Criteria

- All allowed updates display the exact stored percentage and have one audit decision.
- Every refused edit leaves both current value and history unchanged.
- Unset, zero and missing membership are distinguishable to a future consumer.

## Assumptions

Existing styles/design kit in this checkout are canonical. This slice creates no
default limit, approval workflow, role grants, membership writer, or new dependency.
