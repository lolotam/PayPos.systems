# Feature Specification: Package allocation and slots

**Feature Branch**: `feat/p1-31-package-allocation`
**Created**: 2026-10-02
**Status**: Implementation specification
**Input**: Lane L4, Phase 1 plan row 31; pure domain rules from SPEC §4 and §8, D-42/D-51 and ADR-0005.

## User Scenarios & Testing

### User Story 1 - Preserve the paid value (Priority: P1)

The merchant needs every package component and session to have an exact value fixed at sale.
**Why this priority**: subsequent commission and refund amounts must conserve the original payment.
**Independent Test**: hand-calculated fixtures without any database or screen.

**Acceptance Scenarios**:

1. PKG-01: A 10.001 KWD package with weights 20:10 allocates 6.667 and 3.334 KWD.
2. PKG-02: Equal fractional remainders award the extra fils in ascending service-id order, independent of input order.
3. PKG-03: When all list prices are zero, weights are session counts; a zero payment produces only zero values.
4. PKG-04: Component value 10 mills over 3 sessions produces ordinals worth 3, 3, 4 mills.

### User Story 2 - Preserve imported usage (Priority: P1)

The merchant imports a partly used package without repricing its remaining sessions.
**Why this priority**: remaining entitlements must retain their original allocated value.
**Independent Test**: original and imported slot values match ordinal by ordinal.

**Acceptance Scenarios**:

1. PKG-05: With 3 original sessions and 1 remaining, ordinals 1 and 2 are IMPORTED_USED and ordinal 3 is FREE.
2. PKG-06: Zero or all sessions remaining are accepted; remaining outside 0…original is rejected by name.

### User Story 3 - Determine eligible slots (Priority: P1)

Later package writers need deterministic decisions on the snapshots they load under locks.
**Why this priority**: redemption, cancellation and refund must agree on which entitlement is available.
**Independent Test**: shuffled snapshots with holes, used/imported/refunded slots and expiry boundaries.

**Acceptance Scenarios**:

1. PKG-07: Redemption selects the lowest FREE ordinal; none free is INSUFFICIENT_SLOTS.
2. PKG-08: Refund selects exactly the requested positive integer count of highest FREE ordinals and sums their stored values; insufficient capacity rejects the whole selection.
3. PKG-09: Redemption and refund are allowed on expires_on and refused the following branch-local date; an extended date is used as supplied.
4. PKG-10: Cancellation can free a USED slot only for its current unreversed redemption; reversed or stale snapshots are no-ops.
5. PKG-11: Types, sale definitions and import definitions share rejection of empty components, duplicate service ids, non-positive/non-integer sessions, more than 365 sessions per component (owner decision 2026-10-03) and negative prices.

### Edge Cases

Single component/session, tiny amounts, uneven weights, mixed zero weights, multiple tied remainders,
zero refunds on free packages, partly used/imported/refunded snapshots, numeric(14,3) limits,
intermediate weights above the Money range, unsafe counts, invalid calendar dates and immutable inputs.

## Requirements

### Functional Requirements

- FR-001: Allocate price_paid in proportion to list_price_snapshot × original sessions, falling back to sessions only when total weight is zero.
- FR-002: Use largest remainder with ties by service_id; preserve the exact payment sum.
- FR-003: Give each ordinal floor(component_value / sessions); the final ordinal receives all remaining mills.
- FR-004: Imported usage marks the first original-minus-remaining ordinals IMPORTED_USED; original allocation remains unchanged.
- FR-005: Select only FREE slots in the prescribed order; never mutate supplied snapshots or partially select an insufficient refund.
- FR-006: Check expiry using caller-supplied branch-local calendar dates and match cancellation ownership.
- FR-007: Return named domain errors for invalid definitions and rejected selections.

### Key Entities

- Component definition: unique service id, original sessions and optional remaining sessions for import.
- Valued component: original list-price snapshot, component value and original session count.
- Slot snapshot: ordinal, immutable unit value, FREE/USED/REFUNDED/IMPORTED_USED state and current redemption identity when USED.

## Slice design

### Business rules

SPEC §8 is the allocation rule: largest remainder and floor-plus-final-remainder are deliberate,
so independently applying roundKwd to proportional shares would violate conservation. Money stays
bigint mills and uses the shared kernel's range checks and exact summation (ADR-0005).
No new rounding policy is introduced. Ordering uses a deterministic lexical service-id comparison;
production service ids are canonical UUIDs. Session counts are integers from 1 to 365 (owner decision 2026-10-03); ordinals are safe integers.

### Schema changes

None. No tables, migrations, RLS policies, indexes or tenant-qualified foreign keys are introduced.

### API contract

No HTTP endpoint or Zod transport contract. Functions live in apps/api/src/modules/orders/domain.
Named errors cover INVALID_PRICE, INVALID_COMPONENTS, DUPLICATE_SERVICE, INVALID_SESSIONS,
INVALID_REMAINING_SESSIONS, INVALID_SLOTS, INVALID_DATE, PACKAGE_EXPIRED and INSUFFICIENT_SLOTS.
Later HTTP adapters own bilingual error rendering.

### Permissions

No route or authorization layer. Manager authorization for extension/refund belongs to later writers.

### Events

No emitted or consumed events. Later sale/redemption/refund writers publish the committed stored values.
Imported seller omission and zero sale commission remain the responsibility of PR 47 and the commission engine.

### Test plan

- Domain unit: PKG-01…PKG-11, hand-calculated fixtures and bounded exhaustive conservation/permutation checks.
- A dedicated Vitest config runs these tests without the API's database global setup.
- Integration, RLS and EXPLAIN: no new persistence, queries or use cases; not applicable to this domain slice.
- Gates: unset FORCE_COLOR; pnpm check and the API build, plus focused pure unit/lint/format checks.

## Success Criteria

### Measurable Outcomes

- SC-001: Every fixture conserves 100% of price_paid across components and slots, to the fils.
- SC-002: Every valid import retains 100% of original ordinal values.
- SC-003: Every selection either satisfies the exact requested count or fails without changing input.
- SC-004: PKG-01…PKG-11 pass without a database connection.

## Assumptions

- Caller converts its clock to the branch-local date before invoking expiry checks.
- Slot snapshots come from one component; locking, idempotency, persistence, cumulative refund revisions,
  external_ref dedupe, paid-in-full recording and event delivery belong to PRs 42–47.
- This slice creates only the domain skeleton it needs. No NestJS startup wiring or screens.
- No unresolved business rule is needed for this slice; no TODO(spec).
