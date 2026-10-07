# Commission engine II — Phase 1 PR 30

**Branch:** `feat/p1-30-engine-ii` · **Created:** 2026-10-03 · **Status:** Implemented; D-55 real plans recorded (2026-10-07)

Sources: Phase 1 SPEC §4, §5.1–5.8 and §6 input constraints; implementation-plan row 30;
PRD D-14, D-35 (superseded by D-50), D-37, D-45, D-49, D-50, D-51, D-55, D-57;
ADR-0005; engine I spec `006-commissions-engine-i/spec.md`, PR 30 seams.

## Requirements and acceptance scenarios

1. Select versions for the employee using the source's resolved business date. Ordinary
   versions apply from `effectiveFrom`; `wholePeriod` applies throughout the month containing
   that effective date. Latest `createdAt`, then greatest `version`, wins. Later ordinary
   versions can supersede a whole-period version. Never sort by effective date to choose a winner.
2. Keep both AMOUNT and SESSIONS accumulators across the entire employee period, independent
   of versions and service rules. Only counted service lines advance them. A shared line
   counts once for each performer; package sales advance neither accumulator.
3. WHOLE uses the final accumulator to price every FOLLOW_PLAN line using its own selected
   version's reached step, including excluded lines. Base always adds. SESSIONS/MARGINAL
   prices the entire line at the step active before the line, without splitting.
4. Salary history has one authoritative row per employee/date (projection revisions are
   already converged). Choose the latest effective date on or before the supplied period
   last day. SALARY_MULTIPLE values are positive integer hundredths of k; decimal parsing
   accepts at most two places and rejects floats/extra precision. Keep fractional-mill
   thresholds exact with a common scale of 100; never round thresholds.
5. Reuse engine I's chronological ordering, service override resolution, share allocation,
   exact calc numerators, marginal splitting and line rounding. Add evaluators through data
   dispatch. Each successful priced source invokes `roundKwd` exactly once.
6. A seller's package sale uses the selected version's package rule: PCT on paid less refunded;
   FIXED proportional to remaining paid value. Zero paid/full refund pays zero. Disabled sale
   commission pays zero, but an absent plan still returns NO_PLAN. A selected enabled
   salary-multiple plan requires salary even when the source is a sale (D-57).
7. The data-driven validator accepts every §5.7 combination, mixed PCT/FIXED calcs and
   independent switches; rejects unknown modes/accumulators/threshold or calc kinds,
   mixed threshold kinds, invalid ranges, nonascending steps and enabled empty tiers with
   named errors. Disabled components may omit their configuration; retained configuration
   is validated too. Literal amount thresholds are nonnegative mills, sessions nonnegative
   integers, PCT is 0…10000 bps and FIXED is nonnegative mills.
8. `computePeriod(input)` returns `{ ok: true, perSource, total }` or a named NO_PLAN/
   NO_SALARY result, never a partial payout. Source refs are `line:<id>` and `sale:<id>`.
   No plan is needed for standalone ZERO/PCT/FIXED lines. All source dates and the last day
   are resolved by the caller; UTC microsecond ticks are used only for ordering.

## Slice design

### Location and input contract

Only `apps/api/src/modules/commissions/domain/` and its unit tests contain business code.
Generalize engine I's selected-plan seam while preserving its callers. Keep plan selection,
validation, salary resolution, tier evaluation, package pricing and period evaluation separate.
Money, bps, session counters and multiplier hundredths are bigint. No external dependency.

The caller supplies active, revision-converged projection rows, unique source identities,
valid employee shares and canonical business dates. Period evaluation filters the employee
and calendar month; imported packages with no seller earn no sale commission. Cancelled
rows, tips, fingerprints, statement lifecycle, corrections and period locks are outside this
domain slice. Salary duplicates are not resolved here: §4 mandates one row per date upstream.

### Schema, API, permissions, events

None. No migration, database access, use case, controller, UI, startup or worker change.
Domain failures are typed codes; transport and bilingual error presentation belong to later
slices. No new module arrows or ADR are needed.

### Test plan

Literal hand-calculated expectations, with one-line Arabic arithmetic comments, cover every
§5.7 threshold row × both modes × base on/off × tiers on/off; all tier crossings; exact
boundaries; ordering ties, permutations and late insertion; every override on a half share;
excluded lines; 2/3-way remainder conservation; salary histories and fractional thresholds;
ordinary and whole-period versions; package slot values, proportional refunds and zero paid;
tiny values, sum of rounded lines and named missing-configuration errors. Validate the full
combination product and invalid values without a database.

Gates: `pnpm --filter @pospay/api exec vitest run --config vitest.unit.config.ts`,
`pnpm check` with FORCE_COLOR unset, `pnpm --filter @pospay/api build`.

## D-55 — salon plans

Recorded from the salon owner (hair specialist 2026-10-05; the four plans 2026-10-07).
Configuration for this salon, not engine logic. Other businesses configure their own plans.

| Role | Salary (KWD) | Rule | Mode |
| --- | --- | --- | --- |
| Hair specialist | 500.000 | 5% only on the part above 2× salary; no base | MARGINAL, AMOUNT, `SALARY_MULTIPLE` 2.00 |
| Nails specialist | 600.000 | 10% on all sales once the month reaches 3× salary; nothing below; no base | WHOLE, AMOUNT, `SALARY_MULTIPLE` 3.00 |
| Lash specialist | 400.000 (unused) | 20% only on the part above 5,000.000; no base | MARGINAL, AMOUNT, literal 5,000.000 |
| Massage therapist | 200.000 (unused) | 1% of every session; tiers off | base PCT 100 bps |

Owner decisions, every real plan:

- Commission is on sales after discount. A line's `netShare` is already net of discount.
- A salary threshold uses the salary on the period's last day.
- A package session counts like a service line at its slot value (`counts = true`). Selling the package pays no commission (`packageSale` disabled → 0).

Fixtures: `domain/__tests__/d55-salon-plan.spec.ts` (hair specialist), `domain/__tests__/d55-salon-staff-plans.spec.ts` (nails, lash, massage).
Suggestions the owner has not chosen: `domain/__tests__/d55-showcase-plans.spec.ts`.
