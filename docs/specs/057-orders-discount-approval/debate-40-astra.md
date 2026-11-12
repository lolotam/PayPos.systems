# Debate — rows 40 (057-6) and 39 (057-7) plans, Codex `gpt-6-astra`, effort `medium`, one round (PP-168)

> Run 2026-11-11 from the worktree root, `codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only`,
> prompt in `F:/Dev/Worktrees/PosPay/briefs/rows-39-41/debate-prompt.txt` (reviews `spec.md`, `plan-40.md`,
> `plan-39.md`). One round only. Output below is verbatim; the verdicts follow it.

## Astra output (verbatim)

1. **P1 — `plan-40.md` §2, item 7: stale decision time.** `now` and authority are read **before** `performers.lock()`, which can wait. Approval can therefore succeed after expiry or membership expiration; CAS uses the same stale `$now`. Sample injected `Clock` after the final lock, then recheck expiry, authority and limit. Add a blocked-performer-lock expiry test.

2. **P1 — `plan-39.md` §2, items 2–6: stale PIN/device proof.** The plan retains only `userId` after comparison, omitting `SignInStaffPin.current()`’s PIN revision, phone-binding and device-validity rechecks. A reset or revocation during verification can leave usable approval authority. Revalidate proof before returning success and fence device validity through the decision transaction. Test reset/revocation during hashing and lock waits.

3. **P1 — `plan-39.md` §2, item 3: device lockout race.** Checking the device counter only before comparison lets an in-flight successful comparison proceed after concurrent failures lock that device. Specify atomic Redis admission/failure accounting and a success-time lock recheck. Add concurrent, cross-phone tests using real Redis; sequential ten-failure coverage misses this.

4. **P2 — `plan-40.md` §2, items 2/9: rejected flag incompatible with schema.** The referenced `fd4c6df54` planner returns `approver_is_performer: false` for rejection; migration 0162’s `dp_approver_flag_ck` requires **NULL**. Explicitly adapt the decision type/write mapping to NULL for rejection. Assert persisted NULL and successful rejection without a reason; no migration needed.

5. **P2 — `plan-40.md` §2, item 7: refusal ordering contradicts FR-011.** Membership selection precedes `planDiscountDecision`’s status check. An expired/already-decided proposal with multiple eligible memberships returns 422 membership selection instead of 409 `DISCOUNT_PROPOSAL_NOT_PENDING`. Separate the scoped status/expiry check from approval planning and test competing failures.

6. **P2 — both plans §4: size gate silently rebased.** Remote estimates **1,700** production/test lines against **380–520**; PIN estimates **1,450** against **340–460**. Both exceed twice the spec’s upper estimate. Remote then doubles its enlarged estimate again. Reconcile the brief’s baseline explicitly or split delivery; do not redefine PP-112’s threshold inside the plan.

**Verdict: revise both plans before implementation; retain the 057-3b merge dependency.**

## Verdicts

| # | Sev | Verdict | Reason and plan change |
|---|---|---|---|
| 1 | P1 | **Accept** | Real: `performers.lock()` (`FOR SHARE` on employees) can wait after `now` was sampled, so the expiry/authority/limit checks and the CAS could run on a stale instant. plan-40 item 7: every lock (access → proposals → approve-only performers) is taken first, **then** `now` is sampled once from `Clock`, then every check and the CAS use it. FR-014 already places the performer read under the proposal locks, so no lock-order change. New test: hold an employee row lock in a second transaction, advance the injected clock past `expires_at` while the decide waits, release → 409 `DISCOUNT_PROPOSAL_NOT_PENDING`, nothing written. |
| 2 | P1 | **Accept (plan-39)** | Real for the PIN channel: the PIN check runs outside the decision transaction (D-9), so a PIN reset, phone rebinding or device revocation during the hash compare must not leave a usable proof. plan-39 item 2: the verify step rechecks the holder's PIN revision and phone binding after the compare (the same rechecks `SignInStaffPin` does before issuing a session) and returns `{ userId, pinRevision }`; item 5: the decision transaction locks the device row `FOR SHARE`, refuses a revoked/unpaired device or a changed PIN revision with the uniform refusal. Tests for reset/revocation between verify and decide. Not implemented in this run. |
| 3 | P1 | **Accept (plan-39)** | Real: a separate "check lock, then compare, then count" lets an in-flight compare succeed after concurrent failures locked the device. plan-39 item 3: one atomic Redis script admits (device not locked → in-flight +1), a second atomic script records the outcome (failure → counter +1 and lock at 10; always in-flight −1); a success re-reads the device lock atomically before returning `ok`. Concurrent cross-phone test on the real Redis of the T2 stack. Not implemented in this run. |
| 4 | P2 | **Accept** | Confirmed in 0162: `dp_approver_flag_ck` requires `approver_is_performer IS NOT NULL` ⇔ status in (`APPROVED`,`CONSUMED`); the fd4c6df54 reference returns `false` on reject. plan-40 items 2 and 9: the decision type carries `approver_is_performer: boolean \| null`, `null` on reject, written as `NULL`. Tests assert the stored `NULL` and a reject without a reason succeeds. No migration. |
| 5 | P2 | **Accept** | FR-011's text is the binding order: lock → status and expiry (and the terms hash, FR-015) at the fresh instant → authority (FR-012, incl. the D-11 selection) → approve-only limit → requester → flag. The earlier plan ran the D-11 selection before the status check. plan-40 item 7 now: scope check (rows not found in this business and branch → uniform 403, unchanged, it reveals nothing) → `planDiscountStatus` (409s) → `resolveDiscountApprover` (403/422) → `planDiscountDecision` (approve rules). This replaces the advisor's earlier "403 before 409" note, which FR-011 contradicts; the route guard already refuses a caller without the permission at the branch, so the 409 reveals nothing to an outsider. New test: an already-decided proposal with two eligible memberships and none chosen → 409, not 422. 057-7 keeps FR-015's own order (D-11 after a successful PIN, before FR-011), which is the spec's explicit PIN rule. |
| 6 | P2 | **Accept in part** | The plan does not split the slice (one use case, two routes; spec §7 lists it as one PR) but it stops rebasing silently: plan-40 §4 / plan-39 §4 now state that the PP-112 refusal threshold for these PRs is 2× **this plan's** per-category estimate, record the deviation from spec §7 (380–520 / 340–460, hand-written lines, before the repo's port + adapter + replay-recheck shape was known), and the deviation is reported to the manager. |

**Totals:** 6 findings; 5 accepted, 1 accepted in part, 0 rejected. Astra's closing verdict (keep the 057-3b merge
dependency) is kept: plan-40 §0.
