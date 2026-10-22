# ADR-0051 — Discount approval: the reception computer as a branch device, the PIN as an approval proof, and the request event

- **Status:** Proposed
- **Date:** 2026-10-21
- **Spec:** [057 discount approval](../specs/057-orders-discount-approval/spec.md) (Phase 1 rows 38–41), sub-PR 057-1
- **Owner answers:** DA-Q6 = PP-15.1, DA-Q7 = PP-15.2, DA-Q8 = PP-15.3, DA-Q9 = PP-20.3 (Waleed, 2026-10-21, through
  the super agent). Waleed answered the money questions DA-Q1…DA-Q5 at 14:00 on 2026-10-21 (relayed by the
  orchestrator; written into spec 057 by PR #466): the four managers approve by default (DA-Q1), within the
  approver's own limit (DA-Q2); a manager **may** approve a discount on a service she performed and the owner gets a
  bell (DA-Q3); a request is valid **24 hours** from the request, and an approval does **not** start a fresh window:
  `expires_at` is written once by the request and never changes (Abu Salem's binding pick on DA-Q4b, confirmed by
  Waleed on 2026-10-22; issue 494); `expires_at` is never NULL (DA-Q4 and DA-Q4b = PP-25.2, recorded in spec 057 by
  PR #471); an edit of a saved line may request and use an approval the same way (DA-Q5, `kind = EDIT`). Recorded in
  spec 057 by PR #466.
- **Scope:** `orders` (owner of `discount_proposals`), `identity` (approver proof and authority), `notifications`
  (the bell), the POS app as the approval screen.

## Context

A line whose effective discount is above the recorder's limit is refused today (spec 050, SS-Q6). Phase 1 SPEC §4
(`DiscountProposal`) and M2 promise the way past it: the recorder asks, someone with authority approves, and the line
is saved only with exactly the approved terms, consuming the approval in the line's own transaction.

Recording happens on the admin app at the reception computer, each recorder with her own login (SS-Q3). Waleed chose
(PP-15.1, against the recommendation of a separate branch tablet) that a manager at the branch types her PIN on that
same reception computer, with a lockout after failed tries, and (PP-15.2) that a new request rings a bell for
**everyone** holding the approve permission at the branch, the requester excluded. A PIN typed into a recorder's admin
session would let any logged-in user probe any manager's PIN, and SPEC §3 has no event for a request.

## Decision

1. **The reception computer is paired as a branch device.** It is paired through the existing device pairing and
   approval of ADR-0003 §4 path B, using the POS app's pairing screen in that computer's browser. It is then an
   ordinary approved device bound to one branch and revocable like any other. Any active paired device of the branch
   can serve the approval routes; the reception computer is the one deployed for it.
2. **Two screens, two credentials, side by side.** The approval screen is the POS app on that computer; the recording
   screen stays the admin app with each recorder's own login (SS-Q3 unchanged). The device credential never
   accompanies an admin request, and an admin session never authorises a device route: both are refused with the
   uniform 403. A recording is still attributed to the logged-in recorder with her own limit (spec 050 FR-002); an
   approval is attributed to the PIN holder.
3. **The PIN is an approval proof on a paired device, for one action.** The approver types phone + PIN, the shape of
   the staff PIN sign-in. The phone resolves through auth's approved global phone binding (ADR-0019) and the user's
   PIN record is compared by identity's existing facility (hash in `packages/auth`, Redis reservation, the
   placeholder hash for an unknown holder), **outside** the database transaction. No staff session is issued,
   `login:staff:branch` is not required, and `app.` is never opened. The approval transaction then rechecks authority
   under the proposal locks: the holder's memberships **covering the device's branch** must grant
   `approve:discounts:branch`, and DENY wins. The PIN never enters a log, an audit entry, an event, a response or the
   idempotency store; the device routes take no Idempotency-Key.
4. **Lockout: two counters, both in Redis on Redis's clock.**
   - **Per holder** (D-08, ADR-0003 §4.2): 5 failures lock that holder's PIN for 15 minutes (423 `PIN_LOCKED`). An
     unknown phone, or a bound user with no PIN, is compared against the placeholder hash on its own per-phone
     counter, so it answers `PIN_INVALID` with the same timing.
   - **Per device** (D-15): 10 failures across all phones from one device within 15 minutes lock that device's PIN
     approval for 15 minutes, for every phone (423 `PIN_LOCKED`), audited `device.pin_approval_locked`. Another paired
     device and remote approval keep working. This stops one computer from walking through many bound phones.
5. **Remote approval** (row 40) is an ordinary admin session with `approve:discounts:branch` on the proposal's branch.
   On both channels the approver membership is selected like the recorder's (35d D-9): it must itself grant the
   permission; several eligible without `approver_membership_id` answer 422 `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED`;
   never the highest limit.
6. **One new event, `DiscountApprovalRequested`,** emitted by `orders` once per stored request, inside the request
   transaction. It carries `request_id`, `business_id`, `branch_id`, `requested_by`, `line_count`,
   `max_effective_bps`, the distinct `services` with their name snapshots, and `occurred_at` — never a customer, a
   phone or the terms. Rejects and consumption emit **no** event: commissions read the line's `net` from the existing
   line events. An approval emits no event either, **except** (DA-Q3) when the approver is linked to a performer of at
   least one approved proposal (request-time snapshot ∪ current link): the decision transaction then appends
   `DiscountApprovedByPerformer` (spec 057 D-19: `business_id`, `branch_id`, `decided_by`, the decider label snapshot
   `decider_label_en` / `decider_label_ar`, `decided_via`, and `proposals [{id, service_id, name_en, name_ar, effective_bps}]`
   for the flagged proposals only). The flag `approver_is_performer` never refuses; it is stored and audited.
7. **The bell.** A worker `orders` consumer (`orders.discount-approval-notice-v1`, 057-3) claims a ledger row keyed
   `(company_id, request_id)`, resolves the recipients through a new worker identity reader
   `discountApproverRecipients(branch)` — every active user whose membership covering the branch effectively grants
   `approve:discounts:branch` (role defaults and ALLOW overrides, minus any covering DENY), managers or not; **not**
   the ADR-0037 manager rule — drops the requester, and appends `DiscountApprovalNoticeRequested` to `notifications`
   in groups of at most 100 (existing IN_APP storage). Zero recipients is a durable decision. The template
   `discount_approval_requested` (revision 1, ar/en) shows the branch, the **first** service of the request (the
   event's `services` order), the number of lines and the largest percent (`max_effective_bps` / 100 without trailing
   zeros, so a raw four-digit bps never reaches the safe-text filter). It never shows a customer, a phone or the
   requester; the details are read only through the guarded approval lists.
   The owner bell of DA-Q3 follows the same shape: a worker `orders` consumer of `DiscountApprovedByPerformer`
   (`orders.discount-self-approval-notice-v1`, 057-3b) resolves every active membership covering the branch
   whose role is in the kind's effective alert rule (by default `owner`; DA-Q11), through the worker identity scoped-role
   reader (the approver is **not** excluded, ED-Q10) and
   appends `DiscountSelfApprovalNoticeRequested` in groups of at most 100, template `discount_self_approved`
   (revision 1, ar/en: branch, the approver's label, the first flagged service, the largest percent).
   **Addendum (2026-10-22, DA-Q11 = PP-29.2, both owners; closes the question of issue #476):** the request bell (057-3)
   always rings and is outside the team-alerts master switch and rules; the owner bell (057-3b) follows the master switch
   (AL-Q4 = PP-18.24) and its own per-kind alert rule, whose roles replace the fixed `owner` set above (spec 057 D-19).
8. **No new import arrow.** `orders → identity, settings` already exists; the new consumer-owned ports
   (`DiscountApprovalAccessPort`, `DiscountPinApproverPort`, worker `DiscountApprovalNoticeRecipients`, worker
   `DiscountApprovalNoticePlace`, and for the owner bell worker `DiscountSelfApprovalNoticeRecipients` and
   `DiscountSelfApprovalNoticePlace`) and the reuse of `DiscountLimitPort` for the approver are listed in
   `docs/module-map.md` §3.

## Consequences

- A PIN approver needs an approved global phone binding and a PIN set by a manager. Owners and admin-only managers who
  sign in with email + TOTP may have neither; until both exist for them they approve **remotely** only. A tenant-side
  binding or enrollment flow is out of scope and needs its own decision.
- If Waleed later wants approval limited to the reception computer only, a device role or flag is added in 057-7;
  this ADR does not need to change.
- The numbers 5 / 15 minutes (per holder) and 10 / 15 minutes (per device) are fixed here; changing them is an
  amendment to this ADR, not a setting.
- SPEC §3 is amended in the same PR (057-1) with the event and its consumer.

## Alternatives rejected

- **Approval only on a separate branch tablet** (the recommended option of DA-Q6): Waleed chose the reception
  computer (PP-15.1).
- **Typing the manager's PIN into the receptionist's admin session:** any logged-in user could probe any manager's
  PIN, and the PIN would travel with a session that is not the approver's.
- **The per-holder counter alone:** a device could try four PINs on every bound phone.
- **Events for every transition:** no consumer needs them; only the DA-Q3 owner bell needs an approval event, and only
  when the approver performed the service.
