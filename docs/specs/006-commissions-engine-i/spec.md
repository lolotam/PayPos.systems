# Commission engine I — Phase 1 PR 29

**Branch:** `feat/p1-29-engine-i` · **Created:** 2026-10-02 · **Status:** Specified

Sources: Phase 1 SPEC §5.1–5.5, implementation-plan row 29, D-14/D-37/D-49/D-50/D-57,
ADR-0005. This is the named domain-only parallel track.

## User scenarios and acceptance

1. **CE1-ORDER:** Replaying the same employee's active period lines in any input order yields
   the same ordering by occurred time, recorded time, then line id. A late insertion takes
   its chronological position and may change later estimates. Sorting never mutates inputs.
2. **CE1-SHARES:** Floor `net × share_bps / 10000`; distribute the remaining mills one each
   by ascending employee id. Two- and three-way splits conserve net, including zero and tiny
   values, unequal shares and zero-share performers.
3. **CE1-RULE:** Filter employee/service overrides by business date; latest created time then
   greatest id wins, regardless of effective-date ordering. Otherwise use the line snapshot.
   ZERO/PCT/FIXED replace both base and tiers; FOLLOW_PLAN uses the supplied selected plan.
4. **CE1-AMOUNT:** Only counted lines advance the employee's amount accumulator, regardless
   of their pricing rule. Pricing reads the accumulator before the current line. Changing
   the supplied plan never resets it; excluded lines still earn at the active step.
5. **CE1-PLAN:** Base and tiers are independently enabled. Base always adds; tiers replace
   each other. Missing selected plan for FOLLOW_PLAN returns `NO_PLAN`, including zero-value
   lines. Disabled components in an existing plan pay zero.
6. **CE1-MARGINAL:** Split the half-open interval `[x, x + share)` at boundaries if every
   touched step has PCT calculation. Below the first step no tier pays. A boundary at the
   right endpoint is untouched. Any positive-length FIXED part prices the entire line at
   the step active before it, and the next counted line can use the new step.
7. **CE1-ROUND:** Sum exact base/tier fractions, then call shared `roundKwd` once per priced
   line on every rule path. Positive and negative half mills round away from zero. Expected
   values are literal hand calculations, not generated from the implementation.

## Requirements and business rules

- All money, bps and amount thresholds are bigint. Bps use denominator 10000; they are not
  the shared kernel Percentage units. Exact commission numerators share this denominator.
- Owner example: share 1000000 mills, first tier 500000 mills at 500 bps, base off → 25000 mills.
- Endpoint example: steps 0→500 bps, 50000→1000 bps, 100000→FIXED 2000;
  x=40000, share=60000 → 5500 mills. With share=60001 the FIXED part is touched, so the
  old 500 bps prices the whole line → 3000 mills.
- Input instants are normalized bigint UTC microsecond ticks, preserving database timestamp
  precision without date parsing. Override effective dates and the line's already-resolved
  business date are canonical `YYYY-MM-DD`; the engine never assigns a timezone or period.
- Inputs are already valid: nonnegative active line net, unique performers, shares totaling
  10000 bps, strictly ascending literal amount steps. Validation belongs to PR 30 (§5.7) and
  recording slices. Cancelled lines are removed by the caller before a recomputation.

## Slice design

### Location and callable seams

Only `apps/api/src/modules/commissions/domain/` and its `__tests__/` are created for business
code. Ordering, share allocation, rule resolution, amount advancement, exact calc/tier
evaluation and line pricing remain separate pure functions. Arabic JSDoc accompanies exports.
No NestJS wiring or empty adapter folders are needed.

§5.4 plan selection is deliberately **a seam**, because implementation-plan row 30 and the
lane instructions reserve versions to PR 30. Line pricing receives a selected plan or null;
it does not choose versions. The plan type supports only MARGINAL/AMOUNT with literal mills.
PR 30 can reuse ordering/shares/overrides/exact arithmetic and add other evaluators, version
selection and full `computePeriod`. This slice does not expose a partial `computePeriod`.

### Schema changes

None: no tables, RLS, indexes, foreign keys or migrations.

### API contract and permissions

None: no endpoint, transport Zod contract, guard, idempotency store or user-visible string.
The internal pricing result is `{ ok: true, amount: bigint } | { ok: false, code: 'NO_PLAN' }`.

### Events

None published or consumed; all state is supplied as plain data.

### Test plan and gates

- Pure unit tests for CE1-ORDER through CE1-ROUND, independent of database setup, cover
  ties, permutations, late insertion, large bigint values, immutable inputs, all switches,
  half mills, multiple boundaries and PCT↔FIXED crossings.
- A dedicated unit runner config omits the API integration runner's Postgres global setup;
  the specs also remain discoverable by the normal API test command and `pnpm check`.
- Run the focused suite, `pnpm check` with FORCE_COLOR unset, and the API build.
- Add only the existing internal `@pospay/domain` workspace dependency to API for shared
  rounding (already mandated by CLAUDE.md §2.1/§5 and ADR-0005). No new external dependency
  or architectural decision is introduced.

## Explicitly deferred

PR 30: WHOLE, SESSIONS, salary multiples, plan versions, package-sale pricing, §5.7 validation,
§5.8 fixture matrix and D-55 real plans. PR 29 tests are synthetic boundary microcases only.
No database, screen, migration, use case, persistence, jobs, startup change or statement flow.

## Success criteria

Every numbered scenario has passing pure tests; shared rounding is used once per line;
all module/documentation checks and the API build pass; no PR 30 behavior is implemented.

## Open questions for the owner

None for this slice. D-55 remains the recorded input gate for PR 30, not a PR 29 TODO.
