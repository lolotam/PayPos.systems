# ADR-0005 — Money rounding and percentage precision

- **Status:** Accepted
- **Date:** 2026-09-23
- **Slice:** Phase 0 · T3 — `packages/domain`
- **Decided by:** Waleed (2026-09-23)

## Context

`06` §5.5, the PRD §5.4 and `CLAUDE.md` §5 fix money as `bigint` mills and rounding as "half-up at
line level, totals from lines". Three things were left open, and each one changes a number that ends
up on an invoice:

1. What "half-up" means for a **negative** amount (returns, commission reversals — PRD P0-T3.2).
2. The **precision** of `Percentage` (PRD P0-T3.3 says "defined precision" without defining it).
3. Whether T3 computes tax, or only defines the `TaxRule` shape (D-27).

## Decision

### 1. Half away from zero

`roundKwd(numerator, denominator)` rounds an exact half **away from zero**:
`1.0005 → 1.001` and `-1.0005 → -1.001`.

A return is therefore the exact mirror of its sale: `round(-x) === -round(x)` for every `x`, so a sale
and its full return net to zero mills. Half toward +∞ (what `Math.round` does) would make a return
one fils smaller than the sale that it reverses.

The amount is passed as a numerator and a denominator, so no intermediate value is ever a `number`.

### 2. Percentage has 4 decimal places

`Percentage` is a `bigint` in units of 0.0001 %: `5 % = 50_000n`, `100 % = 1_000_000n`.
It covers any VAT rate or commission tier (for example 12.3456 %) and costs nothing extra, because the
value is a `bigint`. It is never negative; a negative result comes from the amount (a return), not from
the rate. There is no upper bound, since a markup can exceed 100 %.

`applyPercentage(amount, rate)` multiplies first and divides once, then rounds with `roundKwd`.

### 3. `TaxRule` is a type only

`TaxRule { code, countryCode, rate, mode: 'INCLUSIVE' | 'EXCLUSIVE' }`. Kuwait has no VAT today; the
tax computation is written with `computeOrderTotals` in P2-T4, against real invoice requirements.

### Parsing never rounds

`parseMoney` rejects more than 3 decimals and `parsePercentage` more than 4. Rounding is a business
step done by `roundKwd`; reading data must not change a value silently.

## Consequences

- The Postgres column for a percentage is `numeric(10,4)` or wider; the column for money stays `numeric(14,3)`.
- `MONEY_MAX = 99_999_999_999_999n` mills — the largest `numeric(14,3)` value. Every Money function
  rejects anything outside ±`MONEY_MAX` with a `RangeError`, before the database would.
- Transport format is a decimal string: `"12.500"` for money, `"12.5000"` for a percentage.
- Changing any rule here changes stored totals and needs a new ADR.
