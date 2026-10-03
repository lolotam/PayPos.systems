# Feature Specification: Business default discount limit

**Created**: 2026-10-03
**Status**: Implemented; NOT_CONFIGURED enforcement remains an owner question for PR 35.
**Input**: Phase 1 PR 7c, dependent on PR 7b.

Sources: Phase 1 SPEC §§2–4, plan row 7c, PRD D-56/D-44,
016-identity-discount-limit, Phase 0 settings and owner decision 2026-10-03.

## User Scenarios & Testing

### User Story 1 — Manage a business default (P1)

An authorised manager sets, changes or clears the selected business's default
discount percentage with a reason. Each decision preserves the previous value.

**Independent Test**: save 12.34%, change to 5.00%, clear; inspect the three audits.

**Acceptance Scenarios**:

1. BD-01: set/change/clear stores one current value and exact before/after/reason/actor.
2. BD-02: 0 and 10000 bps are valid; fractions, out-of-range values and invalid reasons fail.
3. BD-03: missing, expired, denied or insufficiently scoped authority leaves no change/audit.
4. BD-04: a business in another tenant cannot be edited or read; siblings remain independent.
5. BD-05: concurrent edits produce a continuous audit chain; audit failure rolls back settings.
6. BD-06: active owner holders are unlimited, including sibling memberships and employee holders.
7. BD-07: explicit personal limit wins (including zero), then business default, then NOT_CONFIGURED.
8. BD-08: missing/inactive/out-of-business memberships cannot receive any default.
9. BD-09: other settings survive every discount change; a generic settings patch cannot bypass the reason.
10. BD-10: the admin shows the selected business's value, validates two-decimal percentages and translates errors.

### Edge Cases

Clearing means returning to the settings template, whose discount default is null.
Repeating a set or clear is another audited decision. Closed companies are refused.
Owners remain unlimited even if old data contains a personal value or a default.
Membership scope must cover the requested business; a branch membership covers
its own business only. The read capability does not grant authority to discount.

## Requirements

- FR-001: use existing business settings, with a nullable integer limit_bps, 0..10000.
- FR-002: require existing manage:settings:business plus effective manage:discounts:company
  at the business and every descendant branch, following PR 7's possession/scope/DENY/expiry policy.
  No default role grants; PR 7a owns those. No role-name-based manager gate.
- FR-003: reload authority after company/membership locks and retain locks through audit commit.
- FR-004: reason is trimmed, mandatory, 1..500 characters for set/change/clear.
- FR-005: pure resolution: active owner -> UNLIMITED; explicit person -> SET/PERSON;
  business default -> SET/BUSINESS; neither -> NOT_CONFIGURED.
- FR-006: expose resolution through settings/index.ts for PR 35, inside its tenant transaction.
- FR-007: reuse PR 7b validation/reader and person-based active owner protection.
- FR-008: admin field belongs in permissions screen header for selected business (no settings screen exists).

## Slice design

### Business rules

The numerical limit is inclusive; PR 7b owns effectiveDiscountBps/isWithinLimit.
Approval issuance and consumption stay in PRs 38–41. No new discount execution rule.

TODO(spec): Neither D-56 nor the SPEC settles whether NOT_CONFIGURED permits a discount.
The reader preserves that named state; recommendation: treat it as 0%, so every positive
discount needs approval. PR 35 must obtain the decision before enforcing that state.

### Schema changes

business_settings: nullable integer limit_bps with CHECK 0..10000. Existing composite
PK/FK, ENABLE/FORCE RLS and grants retained. No table, new filter, index or dependency.
Generate one additive migration; never edit existing migrations. No backfill default.

### API contract

- GET /v1/businesses/:businessId/settings: existing response adds limit_bps: integer|null
  and limit_bps in overridden when set. Existing read:settings:business declaration.
- POST /v1/businesses/:businessId/settings/discount-limit: 200 {limit_bps: integer|null},
  strict PR 7b DiscountLimitInput {limit_bps, reason}. One manage:settings:business declaration;
  discount authority reloaded inside transaction. Generic PATCH stays unable to write this field.
- Errors reuse bilingual VALIDATION_FAILED, FORBIDDEN, PERMISSION_NOT_HELD,
  PERMISSION_SCOPE_OUTSIDE_REACH, NOT_READY and TRANSACTION_RETRY_REQUIRED.
- Audit entity business_discount_limit, action business_discount_limit.set/cleared;
  before {business_id,limit_bps}; after additionally reason, permission_code, decided_at.
- Same audit-only configuration lifecycle as PR 7b: no Idempotency-Key, outbox or feature flag.
- Settings cache invalidated after commit; financial reader bypasses Redis.

### Permissions and boundaries

Reuse catalog manage:discounts:company (7b) and manage:settings:business (Phase 0).
ADR-0023 declares settings -> identity read capabilities for locked authority and membership
limit/owner metadata. No synchronous cross-module write. PR 35 owns its consuming read port.
The existing settings -> tenancy arrow supplies confirmed business/branch scope;
identity's membership query does not join tenancy business/branch tables.

### Test plan

- Pure domain: all precedence states, 0/10000, invalid values and owner dominance.
- Contracts: strict input, trimmed reason, null/zero, limits, OpenAPI route/status.
- Real Postgres/HTTP: BD-01..09, rollback, concurrent edits, restricted-role RLS negatives.
- Query result shapes and EXPLAIN index checks for new/modified reads.
- UI: selected business, save/clear, exact percentage, invalid values/reason, ar/en feedback.
- pnpm check with FORCE_COLOR unset; API, admin and regenerated POS client builds.
- Optional-empty production startup smoke because settings module wiring changes.

## Success Criteria

Every permitted change has one exact audit; refused changes have none. Personal,
business, unlimited-owner and unconfigured outcomes remain distinguishable.

## Assumptions

The existing design system and selected workspace are canonical. No new dependency,
default role grant, approval workflow, lane-specific value or deployment is introduced.
