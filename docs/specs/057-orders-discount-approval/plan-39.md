# Plan 057-7 — Row 39: approve / reject by PIN on the paired device (spec 057 FR-015, FR-016, FR-023, D-9, D-10, D-15)

> Task session «rows 39–41», batch 2026-11-11 (PP-168). **Planned only; not implemented in this run.** 057-7 starts
> after 057-6 (`plan-40.md`) merges (spec §7 blocks it on 057-6; PP-118 one PR per session at a time). It reuses
> 057-6's `DecideDiscountProposalsUseCase`, `planDiscountDecision`, `resolveDiscountApprover`, records and CAS writes.
> Revised after the Astra debate (`debate-40-astra.md` findings 2, 3, 6).

## 1. Migration

**None expected.** The deciding-device FK `(company_id, branch_id, decided_device_id)` → `devices` and its key exist
(057-2); `decided_via = 'PIN'` ⇔ `decided_device_id NOT NULL` is a `CHECK` already. The D-15 per-device counter lives
in Redis (ADR-0051 §4), not Postgres. The device list index `(company_id, branch_id, status, expires_at)` exists (057-2);
the `EXPLAIN` test proves it serves the device list. If `EXPLAIN` shows the keyset order `(requested_at DESC, id DESC)`
needs the partial `/pending` index instead, no new index is needed (both filter `branch_id`, `status='PENDING'`).

## 2. Files (CLAUDE.md §1 order)

| # | Layer | File | Change |
|---|---|---|---|
| 1 | contracts | none | `deviceDiscountProposalQuery/List`, `deviceApproveDiscountProposalsInput`, `deviceRejectDiscountProposalsInput` and the device OpenAPI paths shipped in 057-1. |
| 2 | identity (owns PIN) | `apps/api/src/modules/identity/use-cases/verify-discount-approver-pin/…` (new) + one add-only export line in `identity/index.ts` | Verifies `{ phone, pin, device }` with the **existing** facility only — `sessions.candidate(phone)`, `pinCounterKey(phone)` for an unknown holder, `PinAttempts.reserve/failed/succeeded/release`, `PinHasher.verify` against the stored `cashier_pins` user hash or the placeholder (no new hashing; CLAUDE.md §8: PIN hashing only in `packages/auth`). After a matching compare it **rechecks** the holder's PIN revision and phone binding (the rechecks `SignInStaffPin` runs before issuing a session; debate #2) and returns `{ kind: 'ok', userId, pinRevision } \| 'refused' \| 'locked' \| 'busy'`. Issues **no** session, does not require `login:staff:branch` (D-10). Concurrency cap = the facility's existing one (`STAFF_LOGIN_CONCURRENCY`) → `busy`. |
| 3 | identity | same use case, D-15 device cap | Redis counter per device on Redis's clock: 10 failures / 15 min across all phones → device locked 15 min (`locked` for every phone), audited `device.pin_approval_locked` once per lock. **Atomic (debate #3):** one Redis script admits (device not locked → in-flight +1, else `locked`) **before** the PIN compare; a second script records the outcome (failure → counter +1, lock at 10; always in-flight −1); a successful compare re-reads the device lock in that same script and returns `locked` if concurrent failures locked it meanwhile. Key namespace beside `pinCounterKey`; fixed numbers from ADR-0051 §4. |
| 4 | orders ports | `apps/api/src/modules/orders/ports/discount-decision.port.ts` | add `DiscountPinApproverPort` (`verify({ phone, pin, deviceId, branchId })` → outcome only, never the hash). |
| 5 | orders use case | `decide-discount-proposals.usecase.ts` | add the `PIN` channel: `{ via: 'PIN', deviceId, approverUserId }` after a successful PIN check (done **outside** the DB transaction, D-9); access is the PIN holder's memberships **covering the device's branch** (path B), DENY from any active membership, owner DENY ignored (D-10); `decided_device_id` written; inside the decision transaction the device row is locked `FOR SHARE` and a revoked/unpaired device or a PIN revision ≠ the verified one → the uniform refusal (debate #2); everything else as REMOTE. |
| 6 | orders persistence | `discount-approval-access.adapter.ts` | a device-branch variant of the access read for the PIN holder (identity function `readDiscountApprovalAccess` already takes `userId, businessId, branchId`; branch = the device's). |
| 7 | orders queries | `apps/api/src/modules/orders/queries/device-discount-proposals.query.ts` (new) | FR-016 list for the device's branch: live `PENDING` (`expires_at > now`), keyset `(requested_at DESC, id DESC)` cursor without business, projection exactly FR-016/FR-027 from the D-18 snapshots, requester first name falling back to the role label; never a phone. Result-shape + `EXPLAIN ANALYZE` tests. |
| 8 | orders http | `apps/api/src/modules/orders/http/device-discount-proposals.controller.ts` (new) | `GET /v1/devices/me/discount-proposals`, `POST …/approve`, `POST …/reject`; `@Authenticated()` + device-only (`request.staffDevice`/device context, an admin session refused, DP-08b) + PP-7.1 declaration of where the permission check lives (the use case transaction); no `Idempotency-Key` (FR-023: the PIN never enters the idempotency store; a retry of a decided proposal answers 409). Outcome mapping: `refused` → 401 `PIN_INVALID`, `locked` → 423 `PIN_LOCKED`, `busy` → 429 `TOO_MANY_REQUESTS`. DP-09b: 422 `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` only **after** a successful PIN check. |
| 9 | wiring | `orders.module.ts` (add-only), `identity.module.ts` | provider lines. |
| 10 | logging | request logger redaction | assert `pin` and `phone` are in the pino redaction list for these routes (FR-023, CLAUDE.md §8); add only if missing. |

## 3. Tests (Agy) — DP-08…DP-12, FR-023

Unit: device-cap counter logic, outcome mapping. Integration: DP-08 list (no phone, no other branch, first names
only); DP-08b admin session on a device route and device credential on an admin route → uniform 403; DP-09 PIN approve
(`decided_via='PIN'`, `decided_device_id`, `expires_at` unchanged); DP-09b two memberships → 422 after a good PIN, then
success with the pick; DP-10 wrong PIN → 401, 5th → 423, in-flight cap → 429, unknown phone / no PIN → same 401 and its
own counter; DP-10b ten failures over different phones → device 423 for every phone, another device and remote still
work, audit row; **concurrent** cross-phone failures on the real Redis with one correct PIN in flight → no success after
the lock (debate #3); PIN reset / phone rebinding / device revocation between verify and decide → refused, nothing
written (debate #2); DP-11 other branch proposal / device / revoked device → 403; DP-12 permission only at another branch →
403. Privacy: no PIN or phone in logs (captured pino stream), audit, outbox, response, idempotency table.

## 4. Size estimate

Production ~550 (identity verify + device cap ~200, query ~120, controller ~110, use-case channel ~60, wiring ~30,
port ~30, debate #2/#3 rechecks ~60); tests ~1000. Spec §7: 340–460 hand-written lines; **the PP-112 baseline for
057-7 is this plan's per-category estimate (debate #6), reported to the manager.**

## 5. Open points for the debate (no owner question)

- D-15 counter keys: per device id under the company, so a revoked-and-re-paired device starts clean (a new device id).
- Whether the device list may be served to a device of the branch that is not the reception computer: yes (D-9, §9
  assumption); a device role/flag is added only if Waleed asks.
