# ADR-0035 — Commission rule kinds are owned per bounded context

Date: 2026-10-05. Status: Accepted for Phase 1 PR 32 (decision 40). Related: ADR-0010, SPEC §4/§5/§5.7.

## Context

`catalog` validates stored service rules; `commissions` prices commission inputs. Their domains cannot import
one another (CLAUDE.architecture.md §3.1). The POS never prices a commission. Moving module-owned commission
kinds into the shared kernel would couple unrelated bounded contexts and repeat the rejected staff-rule move.

## Decision

`packages/domain` contains only runtime-neutral value primitives: Money, Percentage, TaxRule, Quantity/UoM
and KWD rounding. An enumeration owned by a module is declared in that module's `domain/`.
`catalog/domain` owns its service rule type and validation; `commissions/domain` retains its PR 29 types unchanged.
The same literal set in two modules is accepted: the Phase 1 SPEC is the single source of rule semantics.
Catalog exports no rule type from `index.ts` until a current consumer needs it.

Consumers define the DTO they need in their own port. At the boundary, the adapter maps each kind explicitly
using an exhaustive switch with `assertNever`, plus a unit test iterating every kind. Apply this when orders'
`CatalogReaderPort` arrives in PR 35; do not add a speculative port or adapter in PR 32.

The JSON representation keeps PCT as integer bps and FIXED as a KWD string. Domain money stays bigint mills.
Validated relational columns and CHECK constraints mirror catalog's validation.

## Consequences

- No commission types or pricing enter the shared kernel; this PR leaves packages/domain and commissions unchanged.
- No new cross-module arrow is needed for catalog's local rule type.
- Adding a kind requires changing the SPEC and each bounded context's handling; exhaustive boundary mapping
  and the all-kinds test detect missing conversions when the consumer exists.
