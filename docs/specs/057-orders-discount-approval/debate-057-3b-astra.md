# Debate 057-3b — Astra, one round (2026-11-11)

Reviewer: Codex `gpt-6-astra`, effort medium, read-only sandbox, on `plan-057-3b.md` at base `9afcb73`. Output verbatim, then the verdicts.

## Findings (verbatim)

1. **P1 — [Plan: 057-6 unhold point, lines 69–70](F:/Dev/Worktrees/PosPay/feat-p1-057-3b-self-approval-bell/docs/specs/057-orders-discount-approval/plan-057-3b.md:69).** Consumer registration in merged code does not prevent event loss during rollout or rollback. Existing workers already recognize `DiscountApprovedByPerformer`; `createDeliverer` acknowledges known events with no matching consumer. An older worker can therefore permanently swallow approvals. **Fix:** require verified rollout of the consumer to every worker before activating 057-6; explicitly prohibit rollback to a consumer-less worker while the producer remains active.

2. **P2 — [Plan: 3b-3/3b-4 split, lines 65–71](F:/Dev/Worktrees/PosPay/feat-p1-057-3b-self-approval-bell/docs/specs/057-orders-discount-approval/plan-057-3b.md:65).** 3b-3 enables default-on bells and releases 057-6 while their individual rule remains hidden in admin. Owners cannot change recipients or disable this bell without disabling all team alerts. That is incomplete DA-Q11 behavior, not later hardening. **Fix:** include the admin listing and visible editing test in the activation slice, or retain the producer hold until 3b-4.

3. **P2 — [Plan: deferred proofs, lines 66–70](F:/Dev/Worktrees/PosPay/feat-p1-057-3b-self-approval-bell/docs/specs/057-orders-discount-approval/plan-057-3b.md:66).** Activation precedes tests for explicit DP-19c requirements: edited recipients, master-off suppression, groups ≤100, and replay retention after suppression. Ledger concurrency and actual inbox delivery are also deferred. Green 3b-3 CI therefore cannot establish the advertised bell guarantee. **Fix:** move these acceptance and concurrency tests before activation; keep optional performance investigation separate.

4. **P2 — [Plan: place-adapter reuse, line 28](F:/Dev/Worktrees/PosPay/feat-p1-057-3b-self-approval-bell/docs/specs/057-orders-discount-approval/plan-057-3b.md:28).** The existing adapter returns `DiscountApprovalNoticePlace`, whose method requires a complete `DiscountApprovalNoticeRequest`. Self-approval input lacks `requestId`, `requestedBy`, `lineCount`, and other request fields. The preserved implementation explicitly narrowed this signature; the refreshed plan omits that prerequisite. **Fix:** include the compatible `Pick<…, 'companyId' | 'businessId' | 'branchId'>` port change and updated Arabic JSDoc. Do not bridge it with a cast.

5. **P2 — [Plan: size estimates, lines 57–67](F:/Dev/Worktrees/PosPay/feat-p1-057-3b-self-approval-bell/docs/specs/057-orders-discount-approval/plan-057-3b.md:57).** The five-way split understates its largest slice. At `0785d2cef`, fixture/data alone total **452 lines**, exceeding 3b-3’s **420-test-line** allowance before its 221-line main spec, 81-line mismatch spec, 45-line always-on guard, or rollback coverage. Domain plus ports total **281**, versus 3b-2’s **220** production estimate. **Fix:** provide file-level estimates including handwritten fixtures and identify concrete reuse/reductions; then resize the slices without postponing activation-critical tests.

## Verdicts

| # | Verdict | Reason and plan change |
|---|---|---|
| 1 | accept | The deliverer acknowledges a known event with no consumer, so activation is when 057-6 emits, not when 3b merges. Plan: 057-6 unholds only after the consumer is deployed to the staging worker and verified there; no rollback of the worker below 3b-3 while 057-6 is live. |
| 2 | accept | 057-6 stays held until 3b-4 (and 3b-5) are merged, so no bell rings while its rule is hidden; the slices stay as split because nothing emits the event before then. |
| 3 | accept | Same unhold point: every DP-19c acceptance and concurrency proof (3b-4, 3b-5) is merged before 057-6 emits. |
| 4 | accept | Confirmed: `DiscountApprovalNoticePlace.forBranch` takes the full request. 3b-2 narrows it to `Pick<DiscountApprovalNoticeRequest, 'companyId' \| 'businessId' \| 'branchId'>` with its Arabic JSDoc updated; no cast. |
| 5 | accept | Plan sizes redone per file from `0785d2cef` and the 057-3 sibling (fixture 59 + data 310 reusable for proposal seeding); 3b-3 tests and 3b-5 tests are slightly above 420 and are flagged, not hidden. |
