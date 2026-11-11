# Debate 057-3b-3 — Astra, one round (2026-11-12)

Reviewer: Codex `gpt-6-astra`, effort medium, read-only sandbox, on the 3b-3 slice brief (consumer: use case, handler, repository, recipients adapter, wiring, DB integration tests) against the spec, plan-057-3b.md, CLAUDE.md §§3.1/4/5/6/9/11, the sibling consumers, the 3b-2 pure layer, the contracts and migration 0219.

## Findings (verbatim)

1. **P2 — Tests require losing the zero-recipient decision.** Brief:40 says "ledger row count 0" for zero recipients and null place. DP-19c, settled design, and sibling consumers require **one ledger row with `recipient_count = 0`**. Fix both assertions; require zero outbox rows.

2. **P2 — Source proof does not authenticate displayed snapshots.** Brief:36 verifies IDs, amounts, actor, and status but trusts service names and approver labels. A corrupted event retaining valid proposal facts can claim successfully and publish false attribution or unrelated text. Fix: validate against immutable stored service/decision snapshots before claiming, with forged-label tests. This gap is inherited from "Settled design"; correcting it requires updating that design, not silently changing the implementation.

3. **P2 — Replay test can pass with a broken ledger claim.** Brief:40 does not require bypassing `consumed_events`. `createDeliverer` skips an already-consumed event before calling the consumer, so ordinary redelivery proves only dispatcher dedupe. Fix: repeat through `consumer.handle` inside `withTenant`, or remove only the test's consumed receipt as the sibling test does; assert unchanged ledger and outbox rows. Keep two-connection concurrency tests in 3b-5.

4. **P2 — Tenant-negative coverage misses forged source proposals.** Brief:41 tests another branch/business but omits another company's proposal. "Owner of another company never" tests recipient selection, not source isolation. Fix: process a tenant-A envelope referencing tenant-B proposals through `pospay_app` and `withTenant(A)`; assert rejection and no ledger, outbox, or consumed receipt.

5. **P2 — Rollback assertion proves only half the atomicity requirement.** Brief:40 requires only "no ledger row" after outbox failure. An independently committed outbox row or consumed receipt could survive unnoticed. Fix: force failure after a real outbox insert, assert **ledger, generated outbox, and consumed receipt all absent**, then retry successfully and assert exactly one decision and notice.

## Verdicts

| # | Verdict | Reason and change |
|---|---|---|
| 1 | accept | The brief's wording was wrong (it meant `recipient_count = 0`). Zero recipients, a null place and a closed rule each leave exactly one ledger row with `recipient_count = 0` and no outbox row; a closed company leaves no row at all (it is consumed without a claim). Brief fixed. |
| 2 | reject | Out of scope for 3b-3 and a design change: plan-057-3b.md "Source proof before claim" settles that labels stay the event's decision-time snapshot, and the sibling request bell (`discount_approval_requested`) and every other bell on main trust the event's names the same way. The event is written by the 057-6 decision transaction as `pospay_app` under RLS, so forging it already needs a database-level compromise that no consumer can defend against. What the consumer does prove is every fact that decides who is told and about what amount (ids, service, bps, decider, channel, performer flag, status, tenant, branch). Recorded for 057-6 and the plan as a possible hardening; no code change here. |
| 3 | accept | Replay tests call `consumer.handle` through `withTenant` a second time (the fixture's `consume`), and a delivery test through `createDeliverer` shows the dispatcher dedupe separately. Both assert unchanged ledger and outbox rows. Two-connection concurrency stays in 3b-5. |
| 4 | accept | The mismatch matrix gains a "proposals belong to another company" row run as `pospay_app` inside `withTenant(A)`; it asserts rejection, no ledger row, no outbox row and no consumed receipt. |
| 5 | accept | The rollback test runs the use case through `consumer.handle`, throws after it returns (so the real claim and outbox insert both ran), then asserts ledger, outbox and consumed receipt are all absent; a retry then succeeds with exactly one ledger row and one notice. |
