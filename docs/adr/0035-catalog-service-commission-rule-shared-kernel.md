# ADR-0035 — The service commission rule type lives in the shared kernel

Date: 2026-10-05. Status: Accepted for Phase 1 PR 32. Related: ADR-0010, SPEC §4 Service, §5 the commission engine.

## Context

`catalog` stores a service's `commission_rule` and must validate it; the commission engine (`commissions`, PR 29)
prices a line with the same rule. `CLAUDE.architecture.md` §3.1 lets a `domain/` file import **only**
`packages/domain`, and forbids a cross-module import entirely. The catalogue cannot deep-import
`modules/commissions/domain/commission-types.ts`, and adding a `catalog → commissions` import arrow for a type
would still fail the domain boundary because the validation must live in `catalog/domain`.

The rule type was therefore temporarily defined inside `apps/api/src/modules/commissions/domain`. A second,
identical copy in `catalog` would be exactly the duplicated money rule the project bans.

## Decision

Move `CommissionCalc` and `ServiceCommissionRule` to `packages/domain/src/service-commission-rule.ts` and
re-export them from `packages/domain/src/index.ts`. `apps/api/src/modules/commissions/domain/commission-types.ts`
imports and re-exports them from `@pospay/domain`, so every PR 29 file and test is unchanged. `catalog/domain`
imports the same type from `@pospay/domain`; no new module arrow is added and `catalog` still imports only
`tenancy`.

The wire (JSON) projection stays per-module: `catalog/domain/service.ts` defines the small `ServiceRuleWire`
with a numeric bps for `PCT` and a KWD string for `FIXED`, and converts to and from the bigint domain type.
Bigint is never placed in JSON.

## Consequences

- One definition of the rule semantics, shared by both bounded contexts; adding a rule kind is one edit in the
  kernel plus each consumer's handling.
- `packages/domain` stays dependency-free, so the POS may import it later.
- Moving the type is behaviour-preserving: only the definition site and an import change; `commissions` tests
  still import the same names from the same file.
- The rule is stored in relational columns (`commission_rule_kind`, `commission_pct_bps`,
  `commission_fixed_amount`) with CHECK constraints rather than JSONB, so no JSON number can hold money and the
  future `CatalogReaderPort` adapter maps columns directly.
