# Spec 057 — Discount approval: request, approve by PIN or remotely, consume (Phase 1 rows 38–41)

> **Status:** Draft · 2026-10-21 · docs-only PR. Owner questions in [owner-questions.ar.md](owner-questions.ar.md):
> the three permission/technical questions are **answered** by Waleed through the super agent on 2026-10-21 (DA-Q6 =
> PP-15.1, DA-Q7 = PP-15.2, DA-Q8 = PP-15.3; DA-Q6 and DA-Q7 against the recommendation). A fourth permission
> question raised in review, **DA-Q9** (which checks a rejection runs), is **answered** too (DA-Q9 = PP-20.3, the
> recommendation): a rejection needs only the approve permission at the branch. The five charges/money
> questions DA-Q1…DA-Q5 are **answered** by Waleed on 2026-10-21 (super-agent cards; published on the decisions page
> as batch 34, where Abu Salem's pick replaces Waleed's if it differs): DA-Q1 and DA-Q2 the recommendation; **DA-Q3
> and DA-Q5 against the recommendation** (an approver may approve a discount on a line she performs, with a bell to
> the owner; an edit of a saved line may request an approval the same way recording does); **DA-Q4** answered with a
> value, not an option: an approval lives **24 hours**, not 15 minutes. Its follow-up **DA-Q4b** (what the 24 hours
> count from) was answered by Waleed on 2026-10-21 (card PP-25.2, batch 42, the second option: a fresh 24 hours from the
> approval to save). **Abu Salem answered both on 2026-10-22 and his pick binds** (CLAUDE.md §1 5b): **DA-Q4b = 24 hours
> from the request for everything** (the approver decides and the requester saves before `requested_at` + 24 h; an
> approval does **not** start a fresh window, FR-010), the recommended option; his DA-Q4 pick (a 15-minute window with a
> fresh 15 minutes after the approval) **conflicts with his DA-Q4b**; this spec works on DA-Q4b (his later, more specific pick) until he confirms it himself in the pending question **DA-Q12** (Waleed's chat line of 2026-10-22, «24 ساعة من الطلب
> (المقترح)», agrees with DA-Q4b; DA-Q12 blocks no sub-PR). Merged code written for the old reset rule changes in issue #494. A follow-up of DA-Q3, **DA-Q10** (does an
> owner who approves on her own work get the owner bell herself), is **answered** too (card PP-26.1, batch 43, the
> recommendation): the bell goes to every active owner covering the branch, the approving owner included (D-19). Abu
> Salem's pick replaces Waleed's wherever it differs (DA-Q4b only here). **DA-Q11** is answered too (PP-29.2, batch 45, the recommendation; Waleed «جرس الطلب شغال دايماً (المقترح)»
> and Abu Salem the same): the request bell (057-3) always rings and is outside the team-alerts master switch and rules; the
> owner's self-approval bell (057-3b) follows the master switch and has its own per-kind rule like every team alert, so
> 057-3b also waits on 62-1, 62-3 (the worker `orders` read of `AlertRulesPort`) and A-0 (issue #485). No sub-PR waits on an owner question.
> **Rows:** 38 `request-discount-approval` (proposal with terms hash) · 39 `approve-discount` by PIN on the device ·
> 40 `approve-discount` remotely · 41 above-limit discounts consume the approval in the line's transaction (SPEC M2).
> **Extends:** [spec 050](../050-orders-record-service-session/spec.md) (the create and append routes, SS-Q6 partial
> acceptance, FR-007/FR-008 limit read and effective bps) · [spec 016](../016-identity-discount-limit/spec.md) (the
> per-person limit) · [spec 018](../018-settings-business-discount-default/spec.md) (the business default) ·
> [ADR-0003](../../adr/0003-auth-rls-boundary.md) §4 path B and §4.2 (device + PIN, lockout D-08) ·
> [ADR-0019](../../adr/0019-staff-otp-login.md) (the user-held PIN).
> **Relates to:** [spec 35d](../050-orders-record-service-session/spec-35d.md) (an edit keeps the editor's own limit;
> DA-Q5: an edit above it may request and consume an approval, D-20) · [spec 055](../055-orders-change-line-performers/spec.md) (shape,
> bell family, self rule).
> **Depends on:** row 35 (35a create/append, merged), rows 7/7b/7c (permissions, per-person and business limits,
> merged), 35b-2 (the worker `orders` bell pattern, merged).
> **Needs, before code:** a new ADR in 057-1 (D-9: the reception computer paired as a branch device, the PIN as an
> approval proof on a paired device with lockout per D-08, and the two new events) and a SPEC §3 amendment for the
> two new events (plan §4: "any module arrow or event not in SPEC §3" stops for a decision; DA-Q7 and DA-Q3 answered
> that bells are wanted), plus a SPEC §4 amendment: `DiscountProposal.expires_at` is 24 hours, not 15 minutes: 24 hours
> from the request, written once at the request and never reset by an approval (DA-Q4, DA-Q4b = Abu Salem).

## 1. What and why

Today a line whose effective discount is above the recorder's limit is refused and returned for editing (row 35,
SS-Q6). The SPEC promised the way past that refusal: the recorder **asks**, someone with enough authority **approves**
(by PIN on the branch device, or remotely from the admin app), and the line is saved **only** if it matches exactly
what was approved, consuming the approval in the same transaction as the line (SPEC §4 `DiscountProposal`, M2).

**Worked example (salon «صالون الأميرة», branch السالمية, `Asia/Kuwait`).** Receptionist منى has a personal limit of
1000 bps (10%); branch manager ليلى has 2000 bps; the owner is unlimited. Customer نورة: صبغة list 25.000.

1. منى records the visit with صبغة at discount 5.000 (net 20.000, effective 2000 bps) and مناكير 7.125 without
   discount. The visit saves `PARTIAL`: مناكير is saved, صبغة comes back with `SESSION_DISCOUNT_ABOVE_LIMIT`
   (spec 050 §8).
2. منى presses «اطلب موافقة» on the returned صبغة draft. One proposal is stored: terms = branch السالمية, نورة, the
   visit just saved, صبغة, list 25.000, price 25.000, discount 5.000, net 20.000, 2000 bps, performer سارة, requester
   منى; its `terms_hash` is the SHA-256 of those terms. Status `PENDING`; the request, the approval and the save all fall within
   24 hours from the request (DA-Q4, DA-Q4b, FR-010). Everyone at the branch who may approve discounts, except منى, gets a bell (DA-Q7).
3. ليلى comes to the reception computer, which is paired as the branch's device (DA-Q6), opens the branch approval
   screen beside منى's recording screen, picks the request, types her phone and PIN. Her limit (2000) covers 2000 bps,
   she is not منى: the proposal becomes `APPROVED`, `via = PIN`, and منى can save until the same `expires_at` (24 hours from her
   request; the approval does not extend it, DA-Q4b, FR-010). Had the approver been a
   performer of the line (here سارة), the approval would stand, flagged, and the owner would get a bell (DA-Q3).
4. منى's screen (polling) shows «اتوافق». She re-sends صبغة on the append route with the proposal id. In **one**
   transaction the line is inserted and the proposal moves `APPROVED → CONSUMED` with `consumed_line_id` = the new line
   (compare-and-set). Had she changed the discount to 5.500, the hash would differ and صبغة would come back again,
   refused, with `approval_refusal = TERMS_MISMATCH` (M2: "changed terms … fail").
5. Variant: منى asks for 30% (7.500). ليلى's 2000 does not cover 3000 bps → `DISCOUNT_APPROVER_LIMIT_TOO_LOW`; the
   owner, unlimited, approves remotely from the admin app (row 40).

## 2. Scope and what this spec settles

| Item | Decision | Where |
|---|---|---|
| Which discounts need approval | **settled, not asked:** every line whose effective discount is above the recorder's effective limit (D-56; spec 016 "any fraction above the limit … needs approval"; spec 050 FR-007/FR-008: `NOT_CONFIGURED` = 0, owner unlimited) | FR-003 |
| How long an approval lives (DA-Q4) | **answered (batch 34; Waleed typed «24 hours», not an option; Abu Salem's 15-minute pick conflicts with his DA-Q4b; working rule = DA-Q4b until DA-Q12 is answered):** 24 hours, replacing SPEC §4's `expires_at (15 min)` (SPEC §4 amendment in 057-1). **What the 24 hours count from (DA-Q4b): answered by Abu Salem (batch 42, 2026-10-22, binding; the recommended option, replacing Waleed's «fresh 24 hours after the approval»):** 24 hours from the request for everything: the approver decides and the requester saves before `requested_at` + 24 h, and an approval does not reset `expires_at`. Merged code written for the reset: issue #494 | FR-010, D-7 |
| One approval ↔ one line | **settled, not asked:** SPEC §4 `consumed_by_line?` is singular; one proposal is consumed by exactly one line (an `EDIT` proposal by exactly one `service_line_edits` row, D-20) | D-3, FR-019 |
| Terms or price change after approval | **settled, not asked:** M2 "exactly matching terms … changed terms, replay and cross-branch use fail": a new proposal is needed | D-4, FR-020 |
| Consumption | **settled, not asked:** M2 compare-and-set in the line's own transaction; two concurrent uses of one approval: one wins | FR-019, DP-20 |
| Who may approve (DA-Q1) | **answered (batch 34, the recommendation):** new permission `approve:discounts:branch`, default owner, general manager, business manager, branch manager, grantable to anyone by name | FR-012 |
| How much (DA-Q2) | **answered (batch 34, the recommendation):** the approver's own effective limit must cover the line's effective bps | FR-013 |
| Approver on her own line (DA-Q3) | **answered (batch 34, against the recommendation):** allowed, with a bell to the owner: the approval is flagged `approver_is_performer` and every active owner covering the branch is told, the approving owner included (DA-Q10 = batch 43, card PP-26.1, the recommendation) | FR-014, D-19 |
| Approval on an edit of a saved line (DA-Q5) | **answered (batch 34, against the recommendation):** yes, the same way as recording: the editor requests, an approver decides, the 35d edit consumes the approval in its own transaction | D-20, FR-025…FR-027 |
| Where the PIN is typed (DA-Q6) | **answered (PP-15.1, against the recommendation):** the reception computer is paired as a branch device; recording and approval both happen on it; PIN lockout after failed tries; a new ADR | FR-015, D-9, D-15 |
| Bell for a new request (DA-Q7) | **answered (PP-15.2, against the recommendation):** an in-app bell to **everyone** holding the approve permission at the branch, non-managers included, the requester excluded | FR-024 |
| What the device shows before a PIN (DA-Q8) | **answered (PP-15.3, the recommendation):** the request details (service, amounts, requester and customer **first** names, time left), never a phone | FR-016 |
| Checks on a rejection (DA-Q9) | **answered (PP-20.3, the recommendation):** any approver may reject: a rejection needs only the approve permission at the branch (FR-012), not the limit (FR-013) or the requester rule (D-5), and a rejection is never flagged as a performer's (FR-014), because it moves no money | FR-011 |

**Not in 057:** a discount on a **package** sale line (rows
42/46: SPEC §4 checks a package's discount once on its sale line, and that writer adopts this consumption when it
lands); counter-offers (an approver approves or rejects the exact terms, M2); a requester "cancel" action (an unused
proposal simply lapses); offline approval on the POS (ADR-0003 §4: an offline action without an operator credential
is quarantined; P2-T9); WhatsApp or email for the request (tenant outbound stays closed, ADR-0013); payments, printing.

### Decisions record (technical; none is an owner question)

| ID | Decision | Alternative rejected |
|---|---|---|
| D-1 | **Ownership.** `orders` owns `discount_proposals` (SPEC §3: orders owns "discount proposals"), because the proposal is consumed in the line's transaction and no module writes another's table. `identity` supplies what SPEC §2 lists under it ("discount approval (PIN on device or remote request)"): verifying the approver's PIN and resolving the approver's authority, through consumer-owned ports in `orders/ports` (the ADR-0041 pattern). `settings` supplies the approver's limit through the existing `DiscountLimitPort` | the proposal in identity (the line writer would then write identity's table, or consume through a second transaction, which breaks M2) |
| D-2 | **Terms** (`DiscountTermsV1`) = `{ v: 1, company_id, business_id, branch_id, customer_id, session_id \| null, occurred_business_date, service_id, list_price, price, discount, net, effective_bps, performer_ids (sorted, distinct), requested_by, requested_by_membership_id }`, money as canonical three-decimal strings. `terms_hash` = SHA-256 (hex) of the canonical JSON (sorted keys, the shared fingerprint helper of spec 050 §8). Shares are **not** in the terms (they do not change the discount); the performer set is, so the DA-Q3 performer flag is decided on what the approver saw | hashing amounts only (an approval for one customer or service would then pay for another, against M2); including shares (a share fix would void an approval for no money reason) |
| D-3 | One proposal per line (an `EDIT` request, D-20, is always one proposal for one edit). A request may carry **1…20 lines** of one draft visit (the spec 050 limit); they share a `request_id` (one bell, one list row) but each line is its own proposal with its own hash, approval and consumption. A batch approve is all-or-nothing and checks every proposal on its own | one proposal for a visit total (D-56 and 7b check per line, never per order) |
| D-4 | Exact match only. At consumption the line's terms are recomputed from the line being written (for a `RECORD` proposal: the fresh catalog list price and the same domain functions; an `EDIT` proposal uses the line's **stored** `list_price` instead, D-20) and hashed; any difference refuses. No tolerance, no "smaller discount is fine" | a tolerance band (M2 says "exactly matching") |
| D-5 | **Requester ≠ approver**, always, whatever the role (the same user can never ask and approve). The proposal is consumed only by the **requester's own user** on the same membership (both are inside the hash) | anyone at the branch may consume (replay by another person; M2 refuses replay) |
| D-6 | A request is refused unless **every** line is above the requester's own effective limit at request time (`DISCOUNT_APPROVAL_NOT_NEEDED`, with the input indexes). A line inside the limit with a proposal id at consumption is saved on the recorder's own limit and the proposal is **not** consumed (it lapses) | consuming an unneeded approval (it would record an approval that authorised nothing) |
| D-7 | `EXPIRED` is **derived**, never written: a `PENDING` or `APPROVED` row whose `expires_at ≤ now` (injected clock, the fresh instant after every lock wait) reads and behaves as `EXPIRED`. No sweeper job | a status-writing job (one more writer to race the approver and the consumer) |
| D-8 | Approval does not change the line row's limit columns: `limit_source` / `limit_bps_applied` stay the **recorder's** own (what she really had); the line gains a nullable `discount_proposal_id` and a deferred composite FK proves the proposal points back at it (§6) | a new `limit_source = 'APPROVAL'` (rewrites the `service_lines_limit` CHECK on a live table and hides the recorder's real limit) |
| D-9 | (DA-Q6 = PP-15.1) **The reception computer is paired as a branch device**, through the existing device pairing and approval of ADR-0003 §4 path B, using the POS app's pairing screen in that computer's browser; it is then an ordinary approved device bound to one branch, revocable like any other. The **approval screen** (DP-08) is the POS app on that computer; the **recording screen** stays the admin app with each recorder's own login (SS-Q3 unchanged). The two run side by side with **separate credentials**: the device credential never accompanies an admin request and an admin session never authorises a device route, so a recording is still attributed to the logged-in recorder with her own limit (spec 050 FR-002, DP-06) and an approval to the PIN holder. The PIN identifies the approver for **this one action**, opens no session and never opens `app.`. It is verified by identity's existing facility (hash in `packages/auth`, Redis reservation and lockout: 5 failures → 15 min, D-08; an unknown holder is compared against the placeholder hash) **outside** the database transaction; the approval transaction then rechecks authority under locks. **The new ADR (057-1)** records: pairing a reception computer as a branch device, the PIN as an approval proof on a paired device, the lockout of D-15, and the request event. Any active paired device of the branch can serve the approval routes; the reception computer is the one Waleed chose to deploy for it | the recommended option, approval only on the branch tablet (PP-15.1 chose the reception computer); typing the manager's PIN into the receptionist's admin session (a PIN outside a paired device: any logged-in user could probe any manager's PIN) |
| D-10 | The approver is identified on the device by **phone + PIN**, the shape of the existing staff PIN sign-in (`staffPinInput`, `SignInStaffPin`): the phone resolves to a user through auth's **approved global phone binding** (`candidate(phone)`; a binding is a platform-reviewed operation, `approvePhoneBinding`, ADR-0019), then that user's PIN record (`cashier_pins` user holder, set through `staff-pins/reset`) is compared under the same reservation/lockout. Only the lookup, compare and counters are reused: **no** staff session is issued and `login:staff:branch` eligibility is not required. The approver's authority is that user's memberships **filtered to scopes covering the device's branch** (ADR-0003 path B); DENY wins. The approver membership is selected as in D-11 (optional `approver_membership_id`; FR-015). **Prerequisite:** an approver needs both an approved phone binding and a PIN (§9) | picking a name from a list (it would list every approver on the reception screen) |
| D-11 | Remote approval (row 40) is an ordinary admin user session with `approve:discounts:branch` on the proposal's branch. On **both** channels the approver membership is chosen like 35a's recorder: an eligible membership is active, covers the branch and **itself** grants `approve:discounts:branch` (35d D-9); one eligible is picked automatically; several without `approver_membership_id` → `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` with the eligible ids and their role/scope labels; a supplied one that is not eligible → uniform 403; never the highest limit | the principal-wide limit (a membership without the grant would lend its higher limit, 35d D-9) |
| D-12 | Reject is allowed by the same authority on both channels, with an optional reason (≤ 500 characters, trimmed) shown to the requester; a rejected proposal is final | requiring a reason (slows a manager at the till; nothing moves money on a reject) |
| D-13 | A consumption failure inside a create/append is an **above-limit** refusal of that line under SS-Q6 (the line returns for editing with `approval_refusal`), never a whole-request 403, so the other lines still save (SS-26). A proposal id that is unknown, foreign, of another branch or of another requester returns the same `NOT_FOUND` refusal (no oracle) | rolling back the whole visit for one stale approval (contradicts SS-Q6) |
| D-14 | Orders emits two new events, each only for a bell: `DiscountApprovalRequested` (DA-Q7) and `DiscountApprovedByPerformer` (DA-Q3, D-19). Rejects, consumption and an approval by a non-performer emit **no** event: commissions read the line's `net` from the existing line events, and nothing else consumes an approval | events for every transition (no consumer) |
| D-15 | (DA-Q6: Waleed asked for lockout after failed tries) Two counters guard the device PIN path: the existing **per-holder** lockout of D-08 (5 failures → 15 min; an unknown phone has its own per-phone counter, `pinCounterKey`), and a **per-device** cap so one paired computer cannot walk through many phones: 10 failures across all phones within 15 minutes lock the device's PIN approval for 15 minutes (423 `PIN_LOCKED`), audited `device.pin_approval_locked`. Both live in Redis on Redis's clock, like D-08; the numbers are fixed in the ADR | the per-holder counter alone (a device could try 4 PINs on every bound phone) |
| D-16 | **Request-time identity snapshot.** At request time each performer's linked user is read `FOR SHARE` through the existing performer port and stored per proposal (`discount_proposal_performers`); the approver-is-performer test (FR-014, DA-Q3) reads that snapshot **∪** the performer's current link, so relinking between request and approval never hides that the approver performed the line (the owner's bell still rings) | checking only the current link (the line does not exist yet, so a relink would open a gap) |
| D-17 | **Neutral decision fields.** Approve and reject write the same columns (`decided_by`, `decided_by_membership_id`, `decided_via` PIN/REMOTE, `decided_device_id` — set for `PIN`, `NULL` for `REMOTE` —, the decider role and name snapshots, `decided_at`); only an approval also writes `approved_limit_source` / `approved_limit_bps` and `approver_is_performer` (D-19); only a reject may write `reject_reason` | separate approve/reject column sets (twice the columns and `CHECK`s for one fact: who decided, how, when) |
| D-18 | **Request-time label snapshots.** Everything the lists show about people is stored on the request at request time, so the `orders` `queries/` read only `orders` tables and join no other module: the requester's role and name snapshot (the 35d-3b editor shape, for the label) plus her first names, the customer's **first name only** (never the full name, never a phone), and each performer's first names on its `discount_proposal_performers` row. **Every first name is cut once, at write, by the pure `firstName()` of `orders/domain` (057-4a); the lists never cut in SQL.** `firstName` splits on any Unicode whitespace (JS `\s`: space, tab, newline, NBSP U+00A0, the other `Zs` spaces, U+FEFF), ignores leading and trailing whitespace, and returns the first word; a name with no non-whitespace character is returned unchanged, so the function is total. Unit tests: one word, several words, a tab, an NBSP, leading and trailing whitespace, mixed runs, Arabic | joining `customers`, `employees` and identity from the `orders` lists (a read across module boundaries, and labels that drift after the request); cutting the first name in SQL (a second definition that would have to match the domain function on every whitespace character) |
| D-19 | **An approver who performs the line (DA-Q3, against the recommendation).** On approval FR-014 computes `approver_is_performer`: the approver's user is linked to a performer in `terms.performer_ids` by the request-time snapshot (D-16) or by the current link. It **never refuses**: it is stored on the proposal with the decision (frozen like the rest of it), written to the `.approved` audit entry, and when any proposal of one approve transaction has it, that transaction appends one `DiscountApprovedByPerformer` (`business_id`, `branch_id`, `decided_by`, the decider label snapshot, `decided_via`, `proposals: [{ id, service_id, name_en, name_ar \| null, effective_bps }]` for the flagged proposals only). A worker `orders` consumer bells every active membership covering the branch whose role is in the kind's effective alert rule (by default `owner` only; DA-Q11 makes the roles editable and puts the bell under the master switch), **the approver not excluded**, through the worker identity scoped-role reader (the ADR-0037 shape). An **owner who is herself the approving performer** gets the bell too (DA-Q10 = batch 43, card PP-26.1, the recommendation): every approval on one's own work leaves a trace in the owners' bells with no exception, even for a single-owner salon, as the price-edit bell does (ED-Q10: the editor is not excluded). DA-Q11 (later, 2026-10-21) puts this bell under the team-alerts master switch and its own editable rule, so DA-Q10's "no exception" holds for the default rule (owners, the approving owner included); when the business turns the switch off or edits the kind's recipients, the bell follows the rule like every team alert. Bell content: branch, service(s), the largest percent, the approver's label; never a customer name or a phone. D-5 (requester ≠ approver) is unchanged | refusing (the recommendation, not chosen); a bell to every branch manager (the answer names the owner); deriving the fact later from the snapshot (a relink would rewrite history, and the bell needs it at decision time) |
| D-20 | **Edit path (DA-Q5, against the recommendation).** An editor (35d: `edit:service-line-prices:branch`, editor membership per 35d D-9) whose edit result is above her own limit (35d FR-005) may request an approval for that exact edit. The proposal has `kind = 'EDIT'` (recording proposals are `kind = 'RECORD'`), names the line (`line_id`) and the revision it edits (`base_revision` = the edit's `expected_revision`), and stores the line's price, discount and net at that revision (`base_price`, `base_discount`, `base_net`) so the approver sees what changes. Its terms `DiscountEditTermsV1` = the D-2 fields of the line as it would be **after** the edit (the line's **stored** `list_price`, never re-read from the catalog, as 35d FR-004 computes the edit's effective bps, so the approver's limit check in FR-013 sees the same bps the edit writes; the line's saved performers; requester = the editor) plus `kind`, `line_id`, `base_revision`; the edit reason is not in the terms (it moves no money). Approval, limit (FR-013), the DA-Q3 flag and bell, reject and validity (FR-010) are those of recording. Consumption runs inside the 35d edit transaction: the `PATCH` carries `discount_proposal_id`; the proposal moves `APPROVED → CONSUMED` with `consumed_edit_id` = the new `service_line_edits` row, which is **inserted** with `discount_proposal_id` (an insert-only table, no `UPDATE` grant); a deferred composite FK pair proves the two point at each other, as the recording backlink (§6). `service_lines.discount_proposal_id` keeps the recording's approval and is never updated. A failure refuses the edit (it is one line) with 422 `SESSION_DISCOUNT_ABOVE_LIMIT` carrying `approval_refusal` | storing the edit's approval on `service_lines` (an `UPDATE` grant on a money row, and a line approved at recording and again at an edit would hold two); terms without `base_revision` (one edit's approval would replay on a later revision, against M2) |
| D-21 | **The database, not only the use case, keeps a consumed approval on its own line (issues #478, #479; orchestrator's technical decision, 2026-10-21).** The terms hash already ties an approval to its business, branch, service and visit, so no business rule changes; but 057-2 links a consumed line to a proposal only by `(company_id, line id, proposal id)`, leaving the use case as the only guard. 057-5b adds, in its own migration, constraints that refuse a line consuming a proposal of another business or service, or of another visit when the proposal names one (`session_id` is nullable, so the session needs its own check), and a key that ties the proposal's `branch_id` to its session's branch. The exact shape (composite FKs, new unique keys, a trigger) is chosen in 057-5b's design step with the two advisors (money + DB, pospay-pipeline §3 step 2), with negative tests for each mismatch | a use-case-only guard |

## 3. Settled rules this spec builds on (cited, not asked)

- **Effective discount** = `(list_price − net) / list_price`, ceil to bps, `0` at list 0 or `net ≥ list` (D-56/M13,
  spec 050 FR-008); percent amounts half-up to the mill (SS-Q5). The terms store the ceiled bps.
- **Limits:** active owner → unlimited; personal → business default → `NOT_CONFIGURED` = 0 (spec 016, spec 018, spec
  050 FR-007). Read inside the transaction through `DiscountLimitPort`, never cached.
- **Above the limit needs approval** (spec 016 business rules: "any fraction above the limit counts as over the limit
  and needs approval"); until rows 38–41 the line is refused (SS-Q6 background, spec 050 owner-questions §6).
- **Recording** is on the admin app at the reception computer, each recorder with her own login (SS-Q3); the recorder
  is never a performer of the line (SS-Q2, SS-25). Pairing that computer as a branch device (DA-Q6, D-9) adds the
  approval screen beside it and changes nothing in recording.
- **PIN:** 4 digits, locked after 5 failures for 15 minutes (D-08, ADR-0003 §4.2); a manager's PIN never signs in
  someone else (ADR-0019 Q8).

## 4. User scenarios and acceptance criteria *(mandatory)*

Named tests; integration tests against real Postgres (T2 stack, ADR-0006) unless marked unit. People as in §1; هبة is a
second branch manager who also performs services.

### Story 1 — The recorder asks for approval (row 38, P1)

- **DP-01** منى posts the صبغة draft (2000 bps, her limit 1000) with the saved visit's id. One proposal: status
  `PENDING`, `kind = 'RECORD'`, `request_id`, `terms` and `terms_hash` as D-2, `expires_at` = `requested_at` + 24 h
  (FR-010), requester user and
  membership, the requester's limit source and bps at request time, the label snapshots of D-18 (requester role and
  first names, customer first name), and one `discount_proposal_performers` row per performer with her linked user and
  her first names at request time (D-16, D-18); one audit entry; one `DiscountApprovalRequested`
  in the outbox; the idempotent 201 is stored.
- **DP-02** A fresh visit refused in full (all lines above the limit, spec 050 §8: 422, no session) → the request
  carries `session_id: null` and the visit fields (`customer_id`, `occurred_at`); the proposal can then be consumed
  only by the **create** route for that customer, branch and business date.
- **DP-03** Three lines above the limit in one request → three proposals sharing one `request_id`; one bell.
- **DP-04** (D-6) A line within منى's own limit in the request → 422 `DISCOUNT_APPROVAL_NOT_NEEDED` with its input
  index; nothing stored. An owner (unlimited) never needs approval → the same refusal.
- **DP-05** The request validates every line exactly as recording does (service in the business, price/discount shape,
  1…4 distinct eligible performers at `occurred_at`, the recorder not a performer: `SESSION_PERFORMER_SELF_FORBIDDEN`);
  any failure → the whole request refused, nothing stored.
- **DP-06** Authority: `record:service-sessions:branch` at the branch, the `orders` feature, individual admin login (not
  a device); otherwise uniform 403. A supplied `session_id` that is foreign, of another branch or outside the
  back-dating window → uniform 403 / `SESSION_TIME_TOO_OLD` as the append route.
- **DP-07** منى reads her request (`GET …/discount-proposals?request_id=`, guarded by `record:service-sessions:branch`)
  and sees each line's status (`PENDING`/`APPROVED`/`REJECTED`/`EXPIRED`/`CONSUMED`), the decider's label and `via`
  once decided, the reject reason if any. Another recorder's request id returns an empty list (the read filters on
  `requested_by` = the caller inside its tenant transaction; no existence oracle).

### Story 2 — Approve by PIN on the paired reception computer (row 39, P1)

- **DP-08** (DA-Q8 = PP-15.3) The reception computer at السالمية, paired as the branch's device (DA-Q6), lists the
  branch's live `PENDING` proposals: service name, list, price, discount, net, percent, requester first name, customer
  first name, time left. No phone, no other branch.
- **DP-08b** (D-9) منى is logged into the admin app on the same computer: her recording requests carry only her admin
  session and are attributed to her with her own limit; the device credential on that computer authorises none of
  them, and her admin session authorises no device route (both refused, uniform 403).
- **DP-09** ليلى selects the request, enters phone + PIN. PIN verified (identity facility, outside the transaction);
  then one transaction: lock the proposals `FOR UPDATE` ascending → still `PENDING`, not expired (fresh instant) →
  ليلى's memberships covering the device's branch grant `approve:discounts:branch`, no DENY, `orders` on → her limit
  (2000) ≥ 2000 bps → she is not the requester → `APPROVED`, `decided_by` = ليلى's user and membership,
  `decided_via = PIN`, `decided_device_id`, `approved_limit_source/bps`, `approver_is_performer = false` (she is not
  سارة), `expires_at` unchanged (`requested_at` + 24 h, FR-010); one audit entry per proposal; no
  event.
- **DP-09b** (D-11) ليلى holds two memberships covering السالمية that both grant the approve permission (business
  manager with 2000, branch manager with 1500) and sends no `approver_membership_id` → after a **successful** PIN
  check, 422 `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` with both ids and labels; the screen asks her to pick and resends
  with the PIN it kept in memory for that one retry only. The chosen membership's limit applies, never the higher.
- **DP-10** Wrong PIN → 401 `PIN_INVALID`, nothing changes; the fifth failure → 423 `PIN_LOCKED` for 15 minutes; five
  comparisons in flight → 429 `TOO_MANY_REQUESTS` (the facility's existing outcomes). A phone with no approved binding,
  or a bound user with no PIN, is compared against the placeholder hash and counted on its own per-phone counter
  (`pinCounterKey`), so it answers `PIN_INVALID` with the same timing as a wrong PIN.
- **DP-10b** (D-15) Ten failures across different phones from one device within 15 minutes → that device's PIN
  approval answers 423 `PIN_LOCKED` for 15 minutes, for every phone; another paired device and remote approval still
  work; the lock is audited.
- **DP-11** A proposal of another branch, a device of another branch, an unpaired or revoked device → uniform 403.
- **DP-12** The PIN holder has the permission only at another branch → uniform 403 (path B filters to the device's
  branch).

### Story 3 — Approve or reject remotely (row 40, P1)

- **DP-13** The owner, logged into the admin app at home, opens the branch's pending list (`GET …/discount-proposals/pending`, `approve:discounts:branch`)
  and approves the 3000 bps صبغة: same transaction as DP-09 with `via = REMOTE`, no device.
- **DP-14** ليلى rejects with «الخصم كبير» → `REJECTED`, `decided_by`/`decided_via`/`decided_at` and the reason stored
  (D-17); منى sees the reason and who decided. A second
  approve or reject of a decided proposal → 409 `DISCOUNT_PROPOSAL_NOT_PENDING`.
- **DP-14b** (FR-010, DA-Q4b = Abu Salem) منى requests at 17:00; ليلى approves remotely the next day at 16:00 → `APPROVED`
  with `expires_at` **unchanged** at 17:00 that day (`requested_at` + 24 h). Two alternative branches from that `APPROVED`
  state: (a) منى saves at 16:30 → the line is saved and the proposal moves `APPROVED → CONSUMED` (terminal; it never reads
  `EXPIRED` afterwards); (b) منى tries at 18:00 instead → the proposal reads `EXPIRED` (the approval gave no fresh window),
  the save is refused with `approval_refusal = EXPIRED`, and she must request again. A request still
  `PENDING` at 17:00 the next day (`requested_at` + 24 h) is listed as `EXPIRED` and dropped from the pending lists;
  approving or rejecting it → 409 `DISCOUNT_PROPOSAL_NOT_PENDING`. `expires_at` is never `NULL` and never changes after
  the request (approve, reject and consume all leave it as the request wrote it).
- **DP-15** Two approvers race on one proposal (PIN and remote): the row lock serialises them; the second gets 409
  `DISCOUNT_PROPOSAL_NOT_PENDING`.
- **DP-16** A batch approve of three proposals where one is already decided or beyond the approver's limit → the
  whole batch is refused with that proposal's code and id; nothing changes (D-3).

### Story 4 — Who may approve how much (DA-Q1…DA-Q3, P1)

- **DP-17** (DA-Q2) ليلى (2000) on a 3000 bps proposal → 403 `DISCOUNT_APPROVER_LIMIT_TOO_LOW` with `limit_bps` and
  the proposal's bps; a membership with `NOT_CONFIGURED` approves nothing; the owner approves any.
- **DP-18** (D-5) The requester tries to approve her own request (she holds the permission) → 403
  `DISCOUNT_APPROVER_IS_REQUESTER`, even as owner.
- **DP-19** (DA-Q3, D-19) هبة is a performer in the terms and approves → `APPROVED` with `approver_is_performer =
  true` (request-time snapshot ∪ current link, D-16) and the flag in the `.approved` audit entry; the transaction
  appends one `DiscountApprovedByPerformer`; with the default alert rule (roles `owner`, master switch on, D-19) every active owner gets one bell naming the branch, the service, the
  percent and هبة's label (no customer name, no phone). A batch where she performs only some lines → one event listing
  only those proposals; a batch where she performs none → no event. An owner who performs the line and approves it is
  approved and flagged too, and she gets the bell herself like every other owner (DA-Q10, DP-19c).
- **DP-19b** (D-16) سارة, a performer in the terms, was linked to user U at request time; her link is removed (or moved
  to another user) before approval; U approves → flagged from the snapshot, and the owner bell rings. A user linked to
  سارة **after** the request is flagged through the current link.
- **DP-19c** (DA-Q3 bell delivery, 057-3b) The `DiscountApprovedByPerformer` consumer bells, once per event, each active
  membership covering the branch whose role is in the kind's effective alert rule, the approver included (ledger row,
  replay-safe, groups ≤ 100). With the default rule (`owner` only) a non-owner manager gets nothing; with a manager role
  added to the rule she gets it; with the master switch off nobody does (DA-Q11); an owner of another company never; zero owners → a ledger row with count 0, no error. (DA-Q10) The
  salon has two owners, أم فهد and سلمى; أم فهد performed the line and approved it → both أم فهد and سلمى get the bell;
  a single-owner salon whose owner approved her own work → she gets it.

### Story 5 — The line consumes the approval (row 41, P1)

- **DP-20** منى appends صبغة with `discount_proposal_id` and identical terms: the line is inserted with
  `discount_proposal_id`, the proposal moves `APPROVED → CONSUMED` (`consumed_line_id`, `consumed_at`) by a
  compare-and-set `UPDATE … WHERE status = 'APPROVED' AND expires_at > now AND terms_hash = $h`; one audit entry; the
  line's events are unchanged in shape (the line is an ordinary revision-1 line).
- **DP-21** Two concurrent submissions with the same approval: one line is saved and consumes it; the other line comes
  back refused with `approval_refusal = CONSUMED` (M2 "one wins").
- **DP-22** Changed discount, price, service, customer, performers, branch or date → the line returns refused with
  `TERMS_MISMATCH`; the proposal stays `APPROVED` until it lapses.
- **DP-23** `PENDING`, `REJECTED` → `NOT_APPROVED`; past `expires_at` → `EXPIRED`; unknown, foreign, other branch or
  another requester → `NOT_FOUND` (D-13). Each is the SS-Q6 partial path: the other lines save.
- **DP-24** An idempotent replay of a create that consumed returns the original 201 with no second consumption; a new
  key re-sending the same line → `CONSUMED`.
- **DP-25** (D-6) The line is within the recorder's own limit when written (her limit was raised meanwhile) → saved on
  her own limit, the proposal not consumed.

### Story 6 — Bell (DA-Q7 = PP-15.2, P2)

- **DP-26** One bell per request (`request_id`) to **every active user who is an eligible approver at the branch**,
  exactly the rule of D-11 plus DENY and owner protection: one of her active memberships covers the branch and itself
  grants `approve:discounts:branch` (its role default, or its own ALLOW override whose scope covers the branch; an
  override on a membership that does not cover the branch does not count); any DENY covering the branch on any of her
  active memberships excludes her, an active owner's DENY is ignored; active window only; managers or not, the
  requester **excluded**; zero recipients → a ledger row with count 0, no error.
  Bell content: branch, service name(s), the largest percent, number of lines; no customer name, no phone.
- **DP-26b** A cashier granted the permission by name gets the bell; a branch manager with a DENY on it at that branch
  does not; a holder at another branch does not.

### Story 7 — An edit asks for approval (DA-Q5 = batch 34, against the recommendation, P2)

- **DP-27** ليلى (limit 2000) edits صبغة (revision 2) to discount 7.500 (3000 bps) → refused `SESSION_DISCOUNT_ABOVE_LIMIT`
  (35d FR-005). She requests approval for that edit (FR-025): one proposal with `kind = 'EDIT'`, `line_id`,
  `base_revision = 2`, `base_price/discount/net` = the line at revision 2, the `DiscountEditTermsV1` of D-20, requester
  ليلى and her editor membership; the DP-26 bell (she is excluded); validity per FR-010.
- **DP-28** The owner approves it (remote or PIN: the same routes and checks, FR-011…FR-014). ليلى resends the `PATCH`
  with `expected_revision = 2`, the same price and discount, a reason and `discount_proposal_id` → in one transaction
  the line moves to revision 3, the `service_line_edits` row is inserted with `discount_proposal_id`, the proposal moves
  `APPROVED → CONSUMED` with `consumed_edit_id` = that row; the line's own `discount_proposal_id` is unchanged; one
  `ServiceLineChanged`, the 35d bell, one `discount_proposal.consumed` audit entry.
- **DP-29** The line moved to revision 3 meanwhile (another edit, a cancel or a performer change) → 409
  `SESSION_LINE_REVISION_STALE` as 35d; a resend at revision 3 with that proposal → 422 `SESSION_DISCOUNT_ABOVE_LIMIT`
  with `approval_refusal = TERMS_MISMATCH` (the revision is in the terms). A changed price or discount →
  `TERMS_MISMATCH`. A `RECORD` proposal on a `PATCH`, or an `EDIT` proposal on a create/append line → `NOT_FOUND`. Two
  concurrent `PATCH`es with one approval → the revision CAS lets one win; the other is `SESSION_LINE_REVISION_STALE`.
- **DP-30** The edit request runs 35d's checks before storing anything: edit permission and editor membership (35d
  D-9), the editor not a performer (`SESSION_PERFORMER_SELF_FORBIDDEN`, ED-Q4), the line not cancelled, inside the
  edit window, a real change (`SESSION_EDIT_NO_CHANGE`), stale `expected_revision` (409), and above the editor's own
  limit (`DISCOUNT_APPROVAL_NOT_NEEDED` otherwise, D-6). Approver ≠ editor (D-5); a performer approver is flagged with
  the owner bell (DA-Q3).

### Edge cases

- The catalog price changes between request and consumption → `TERMS_MISMATCH` for a `RECORD` proposal (the fresh list
  price is in the terms); an `EDIT` proposal is unaffected, since an edit uses the line's stored `list_price` (D-20).
- The requester's membership ends or her record permission is revoked → her consumption fails the recording's own
  authority check (403 for the whole request, as today); the proposal lapses.
- The approver's permission or limit changes after approval → the approval stands (it was valid when given; audit
  shows the limit used); the line still checks only the hash.
- A visit at 23:55 approved at 00:05 local → the occurred business date in the terms stays the request's; a create
  after midnight with an omitted `occurred_at` computes a new date → `TERMS_MISMATCH`; the screen therefore resends the
  normalized `occurred_at` returned by the request (FR-007) and by the requester read (FR-008).
- An approval used hours after the request (DA-Q4: 24 hours) still passes every recording check at consumption: a
  visit that left the back-dating window meanwhile → `SESSION_TIME_TOO_OLD` (spec 050), and the proposal lapses unused.
- Opted-out customers, late visits, PARTIAL visits: none changes the right to ask or approve.

## 5. Requirements

- **FR-001** `POST /v1/businesses/:businessId/branches/:branchId/discount-proposals` creates one request of 1…20 lines.
- **FR-002** Body (strict Zod): `{ customer_id, session_id?: uuid, occurred_at?: datetime, lines: [{ service_id, price,
  discount: {kind:'AMOUNT',amount}|{kind:'PERCENT',bps}, performers: [{ employee_id, share_bps? }] }] (1…20),
  requester_membership_id?: uuid }` — the spec 050 line shape, so the screen sends the refused draft unchanged. With
  `session_id` the visit fields come from the saved session (`customer_id` must match) and `occurred_at` is refused.
- **FR-003** Each line is prepared by the **recording** domain functions (spec 050 §9: `lineNet`,
  `discountFromPercent`, `effectiveDiscountBps`, `validateShares`) against a fresh catalog snapshot (a `RECORD` request; an
  `EDIT` request uses the line's stored `list_price`, D-20), and must be above
  the requester's effective limit read through `DiscountLimitPort` (D-6).
- **FR-004** Authority (DP-06) through the existing `SessionRecordAccessPort` (`lock()` then `read()`), rechecked
  inside the transaction before an idempotent replay returns.
- **FR-005** Transaction: idempotency claim → access lock → (with `session_id`) the visit advisory lock → catalog,
  performer and customer reads (the existing `CatalogReaderPort`, `PerformerCheckPort` and `CustomerLookupPort`, which
  already return the names D-18 snapshots) and the requester's names (`EditorNamePort`) and role (the request's `SessionRecordAccessPort.read()`, which today returns
  only `membership_ids`, gains each membership's `SessionEditorRole`, the shape 35d's `SessionEditAccessPort` returns) → limit read → insert
  the proposals → audit → outbox `DiscountApprovalRequested` → store the 201.
- **FR-006** Idempotency-Key required, COMPANY scope, operation `request-discount-approval`; fingerprint with the shared
  helper over `{method, route, query, body, params:{businessId, branchId, companyId, actorUserId}}`.
- **FR-007** Response 201: `{ request_id, occurred_at, proposals: [{ id, input_index, status, expires_at,
  effective_bps, terms_hash }] }`; no approver data yet. `occurred_at` is the **normalized** visit instant the terms were
  built from (the injected now when the request omitted it), so a later create for a fresh visit resends exactly that
  instant and keeps the same business date (edge case «23:55 / 00:05»).
- **FR-008** Read for the requester: `GET …/discount-proposals?request_id=` under
  `@Require('record:service-sessions:branch', { branch: 'branchId' })`, filtered to `requested_by` = the caller inside
  its tenant transaction (own proposals only, DP-07); items `{ id, request_id, input_index, status, session_id,
  occurred_at, service_id, service name ar/en, list_price, price, discount, net, effective_bps, expires_at, terms_hash,
  decided_label_ar/en?, decided_via?, decided_at?, reject_reason?, consumed_line_id? }` — `occurred_at` is the
  normalized instant of FR-007. `request_id` is required on this route. The approver's list has **its own path**, `GET …/discount-proposals/pending?cursor&limit`,
  under its own `@Require('approve:discounts:branch', { branch: 'branchId' })` (never the requester read with a
  status filter), ordered `(requested_at DESC, id DESC)` with an opaque keyset cursor that carries both values (the next page is
  `(requested_at, id) < (cursor.requested_at, cursor.id)`, so requests of one instant are neither repeated nor skipped), items `{ id, request_id, session_id, occurred_at, service_id, service name
  ar/en, list_price, price, discount, net, effective_bps, performers [{ employee_id, first name ar/en }], requester
  label ar/en, customer first name, requested_at, expires_at, terms_hash }` — everything the approver must see to
  decide and the `terms_hash` FR-017 sends back; never a phone. Every label comes from the D-18 snapshots on
  `discount_proposals` and `discount_proposal_performers` (requester label by `editorLabel`), so neither list joins a
  table outside `orders` and none cuts a name (D-18: the first names are stored already cut). Both are `queries/` files (read-only, no `domain/` or
  `use-cases/` import) with result-shape and `EXPLAIN` tests. Status `EXPIRED` is computed in the SQL from `expires_at`
  and the injected now (D-7).
- **FR-009** Pure domain (`orders/domain`, Arabic JSDoc, no DB): `buildDiscountTerms`, `discountTermsHash` (canonical,
  versioned), `needsApproval`, `proposalState(status, expiresAt, now)`, `canApprove(approverLimit, terms)`,
  `approverIsPerformer` (DA-Q3: a flag, never a refusal), `proposalExpiry` (DA-Q4, FR-010), `consumptionRefusal(proposal, lineTerms, actor, now)`, `firstName(name)` (D-18); exhaustive unit tests incl. ceil bps,
  half-up percent, list 0, owner unlimited, `NOT_CONFIGURED`.
- **FR-010** (DA-Q4, DA-Q4b = batch 42, Abu Salem 2026-10-22, binding) An approval lives **24 hours from the request, for
  everything**: the named constant `DISCOUNT_APPROVAL_VALIDITY` in `orders/domain` (not a setting), applied by the pure
  `proposalExpiry(from)` = `from + DISCOUNT_APPROVAL_VALIDITY`. The request writes `expires_at` =
  `proposalExpiry(requested_at)` and **nothing ever changes it**: the approver has until then to decide, the requester
  until then to save, and a `PENDING` or `APPROVED` row past it reads as `EXPIRED` (D-7) and can be neither approved,
  rejected nor consumed (FR-011 and FR-019 recheck at the fresh instant). An approval does **not** start a fresh window
  (Waleed's earlier «fresh 24 hours after the approval» was replaced by Abu Salem's pick); a reject keeps the value the
  request wrote. `expires_at` is never `NULL`; the transition trigger refuses any change to it (§6). Merged code that
  resets it on approval (migration 0162's trigger and `UPDATE` grant, the 057-1 contracts text, ADR-0051): issue #494.
- **FR-011** Approve and reject act on 1…20 proposals of **one** branch in one transaction: lock the rows `FOR UPDATE`
  in ascending id order → recheck status and expiry at the fresh instant → approver authority (FR-012) → **approve only:** limit
  (FR-013) → requester rule (D-5) → performer flag (FR-014) → CAS `UPDATE … WHERE status = 'PENDING'` → audit →
  (an approve with any flagged proposal) one `DiscountApprovedByPerformer` (D-19). (DA-Q9 = PP-20.3: a rejection runs
  FR-012 only, since it moves no money; no limit check, no requester or own-service check, no flag.) All-or-nothing (D-3). The
  approver's limit is read **after** the row locks; the line writers read the recorder's limit **before** locking
  proposals; neither path takes an `orders` lock after a proposal lock, so no cycle.
- **FR-012** (DA-Q1) Authority = `approve:discounts:branch` at the proposal's branch, DENY wins, `orders` feature on,
  through a new consumer-owned `DiscountApprovalAccessPort` (identity) with `lock()` then `read(at)` like
  `SessionEditAccessPort`. Remote: the user's memberships (D-11). PIN: the PIN holder's memberships covering the
  device's branch (D-10).
- **FR-013** (DA-Q2) The selected approver membership's effective limit (`DiscountLimitPort.read`): `OWNER` → any;
  `NOT_CONFIGURED` → 0; otherwise `terms.effective_bps ≤ limit_bps` (inclusive). Stored as `approved_limit_source` /
  `approved_limit_bps`.
- **FR-014** (DA-Q3, D-19) On approval, `approver_is_performer` = the approver's user is linked to a performer in
  `terms.performer_ids`, by the request-time snapshot in `discount_proposal_performers` (D-16) or by the performer's
  current link, read `FOR SHARE` through the existing performer port under the proposal locks. It never refuses: it is
  stored, audited and, when true, rings the owner bell (D-19). D-5 still refuses the requester's user.
- **FR-015** (DA-Q6 = PP-15.1, row 39) Device routes, `@Authenticated()` device-only (PP-7.1: the write declares where
  its permission check lives), served to any active paired device of the branch, the paired reception computer
  included (D-9): `GET /v1/devices/me/discount-proposals` (the device branch's live `PENDING` list, DP-08) and
  `POST /v1/devices/me/discount-proposals/approve` and `/reject`, body `{ proposal_ids (1…20), phone, pin,
  terms_hashes (same order), approver_membership_id?, reason? }`. The device-wide cap of D-15 is checked first; then
  the PIN is verified by a new consumer-owned `DiscountPinApproverPort` (identity), which returns the holder's user id
  or `refused` / `locked` / `busy`; then the approver membership is selected (D-11) and FR-011 runs. `terms_hashes`
  must equal the stored ones (the approver approves what the screen showed) → otherwise 409
  `DISCOUNT_PROPOSAL_CHANGED`.
- **FR-016** (DA-Q8 = PP-15.3) The device list projects only: proposal id, `request_id`, service name ar/en, list, price,
  discount, net, effective bps, requester first name, customer first name, `requested_at`, `expires_at`, `terms_hash`,
  all from the D-18 snapshots as stored (the requester's first name falls back to the role label when the snapshot has no
  name), plus FR-027's `kind` and, for `EDIT`, `base_*`. It is paged like FR-008: `?cursor&limit`, ordered
  `(requested_at DESC, id DESC)` with an opaque keyset cursor over both values, `{ items, next_cursor }`; the device's
  cursor carries no business, since the device route names none (as built in 057-1, PR #465).
- **FR-017** (row 40) Admin routes under `@Require('approve:discounts:branch', { branch: 'branchId' })` and
  `@RequiresFeature('orders')`: `POST …/discount-proposals/approve` and `/reject`, body `{ proposal_ids (1…20),
  terms_hashes, approver_membership_id?, reason? }`, `Idempotency-Key` required (operation `decide-discount-proposals`).
  Route branch ≠ proposal branch → uniform 403.
- **FR-018** Approve and reject responses: `{ proposals: [{ id, status, expires_at }] }`; never the PIN, never the
  phone.
- **FR-019** (row 41) The spec 050 create and append line input gains optional `discount_proposal_id`. For a line above
  the recorder's limit **with** it: after the recorder's limit read and the visit lock, lock the named proposals
  `FOR UPDATE` in ascending id order, recompute the line's terms (FR-009, D-4 for a `RECORD` proposal) and run the CAS of DP-20; success → the line
  is accepted with `discount_proposal_id`; failure → the line joins `rejected_lines` with `approval_refusal` ∈
  `NOT_FOUND | NOT_APPROVED | EXPIRED | CONSUMED | TERMS_MISMATCH` (D-13). Without it: today's refusal, unchanged.
- **FR-020** The same proposal id twice in one request → the second line refused `CONSUMED` (the first consumes).
- **FR-021** The rejected-line contract gains optional `approval_refusal` and `discount_proposal_id` (additive); the
  accepted-line snapshot gains optional `discount_proposal_id`. The approver is shown only through the proposal reads
  (FR-008), labelled by `editorLabel` (`@pospay/i18n`, the 35d label) from the approver snapshot columns.
- **FR-022** Audit entries (CLAUDE.md §8, discounts): `discount_proposal.requested`, `.approved` (via, approver user and
  membership, device, limit used, `approver_is_performer`), `.rejected` (no reason text in the audit; the reason lives on the row),
  `.consumed` (line id). No phone, no PIN, no customer name.
- **FR-023** The PIN never enters a log, an audit entry, an event, a response or the idempotency store (the device
  routes take no Idempotency-Key: a retried PIN approve of a decided proposal answers 409, and the screen re-reads).
- **FR-024** (DA-Q7 = PP-15.2) The request transaction appends `DiscountApprovalRequested` (`request_id`, `business_id`,
  `branch_id`, `requested_by`, `line_count`, `max_effective_bps`, `services: [{ service_id, name_en, name_ar | null }]` (distinct, from the proposals' name snapshots), `occurred_at`); the consumer renders the bell's service names from the event alone and reads no catalog; a worker `orders`
  consumer resolves the recipients of DP-26 and appends `DiscountApprovalNoticeRequested` to `notifications` in groups
  of at most 100 (§6 *Events*).
- **FR-025** (DA-Q5, D-20) `POST /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines/:lineId/discount-proposals`
  under `@Require('edit:service-line-prices:branch', { branch: 'branchId' })`, `@RequiresFeature('orders')`, individual
  admin user, `Idempotency-Key` (operation `request-discount-approval-edit`). Body = the 35d edit body without the
  reason: `{ price, discount, expected_revision, editor_membership_id? }`. It runs DP-30's checks on the line, builds
  `DiscountEditTermsV1` with the pure `buildDiscountEditTerms` (057-9), and in one transaction stores one `EDIT`
  proposal with its `base_*` values, writes the audit entry and appends `DiscountApprovalRequested` (FR-024,
  `line_count` 1); response FR-007.
- **FR-026** (D-20) The 35d `PATCH` body gains optional `discount_proposal_id`. Above the editor's limit **with** it:
  after the editor's limit read and the line lock, lock the proposal `FOR UPDATE`, recompute the edit terms from the
  request and the locked line, and CAS `APPROVED → CONSUMED` with `consumed_edit_id` = the `service_line_edits` row
  inserted in the same transaction with `discount_proposal_id`; a failure → 422 `SESSION_DISCOUNT_ABOVE_LIMIT` with
  `approval_refusal` ∈ FR-019's values (a `RECORD` proposal → `NOT_FOUND`). Within the editor's limit with it → saved
  on her own limit, the proposal not consumed (D-6). Without it: 35d unchanged. An idempotent replay returns the
  stored response with no second consumption.
- **FR-027** The approver lists (FR-008 `/pending`, FR-016 device list) and the requester reads carry `kind`, and for
  `EDIT` the `line_id`, `base_revision` and `base_price/base_discount/base_net` as stored, so the approver sees what
  changes. The editor reads her `EDIT` proposals on `GET …/service-sessions/:sessionId/lines/:lineId/discount-proposals?request_id=`
  under `@Require('edit:service-line-prices:branch', { branch: 'branchId' })`, filtered to `requested_by` = the caller
  as FR-008.

## 6. Slice design

### Business rules

- **BR-01** A discount above the recorder's limit is saved only with an approval whose terms match the line exactly and
  that is consumed in the line's own transaction; nothing else lets it through.
- **BR-02** Nobody approves her own request. (DA-Q3) An approver may approve a discount on a line she performs; the
  approval is flagged and everyone in the bell's alert-rule roles (by default every active owner) is told every time,
  the approving owner included (DA-Q10), unless the team-alerts master switch is off (DA-Q11).
- **BR-03** (DA-Q2) An approver approves only what her own limit would let her record.
- **BR-04** An approval authorises one line once; an unused approval lapses and authorises nothing.
- **BR-05** Orders owns the proposal and its life; identity proves the approver; settings gives the limits. No module
  writes another's table.

### Schema changes

| Table | Change | Notes |
|---|---|---|
| `discount_proposals` (new) | `company_id`, `id` (UUID v7), `business_id`, `branch_id`, `request_id uuid`, `input_index int` (the line's 0-based position in the FR-002 `lines` array, request-scoped, so FR-008 maps each proposal back to its draft line even when two lines name the same service), `session_id uuid NULL`, `occurred_at timestamptz` (the normalized visit instant: the saved session's when `session_id` is set, otherwise the request's `occurred_at` or the injected now when it was omitted), `customer_id`, `service_id`, `service_name_en text`, `service_name_ar text NULL` (the catalog names read with the FR-003 snapshot at request time, so the bell and the lists never read the catalog again; not part of the terms hash), `terms jsonb`, `terms_hash char(64)`, `effective_bps int`, `requested_by` (user, `NOT NULL`), `requested_by_membership_id` (`NOT NULL`), `requester_limit_source`, `requester_limit_bps NULL`, the requester snapshot of D-18 in the shape of the `service_line_edits` editor snapshot (35d-3b): `requester_name_ar NULL`, `requester_name_en NULL`, `requester_role`, `requester_role_is_system`, `requester_role_name_ar NULL`, `requester_role_name_en` (the selected membership's `SessionEditorRole`, FR-005), `requester_first_name_en NULL`, `requester_first_name_ar NULL` (D-18: `firstName` of the name snapshots, set iff the matching name is set), `customer_first_name text` (D-18: `firstName` of the customer's name; the full name is never stored), `requested_at`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`CONSUMED`), `expires_at NOT NULL` (`requested_at` + 24 h, written at the request and never changed afterwards, FR-010; DA-Q4b), the decision fields of D-17: `decided_by NULL`, `decided_by_membership_id NULL`, `decided_via` (`PIN`/`REMOTE`) `NULL`, `decided_device_id NULL`, the decider role and name snapshot columns in the shape of `service_line_edits` (35d-3b) — `decider_name_ar`, `decider_name_en`, `decider_role`, `decider_role_is_system`, `decider_role_name_ar`, `decider_role_name_en` — all `NULL` while `PENDING`, `decided_at NULL`; `approved_limit_source NULL`, `approved_limit_bps NULL` (approval only), `reject_reason NULL` (reject only), `consumed_line_id NULL`, `consumed_at NULL`; the DA-Q3/DA-Q5 columns (D-19, D-20): `kind text NOT NULL` (`RECORD`/`EDIT`), `line_id uuid NULL`, `base_revision int NULL`, `base_price numeric(14,3) NULL`, `base_discount numeric(14,3) NULL`, `base_net numeric(14,3) NULL` (`EDIT` only: the edited line and its stored price, discount and net at `base_revision`), `approver_is_performer boolean NULL` (approval only, D-19), `consumed_edit_id uuid NULL` (an `EDIT`'s consuming `service_line_edits` row) | PK `(company_id, id)`; `UNIQUE (company_id, business_id, id)` (target of the `discount_proposal_performers` proposal FK); `UNIQUE (company_id, id, consumed_line_id)` (target of the line's FK); partial `UNIQUE (company_id, consumed_line_id) WHERE consumed_line_id IS NOT NULL`; `UNIQUE (company_id, id, consumed_edit_id)` (target of the edit row's FK, 057-9); partial `UNIQUE (company_id, consumed_edit_id) WHERE consumed_edit_id IS NOT NULL`; deferred FK `dp_consumed_edit_fk` `(company_id, line_id, consumed_edit_id)` → `service_line_edits (company_id, line_id, id)` (its key `service_line_edits_line_id_key`, built by migration 0163 and attached by 0164) `DEFERRABLE INITIALLY DEFERRED`, so an `EDIT` can only be consumed by an edit of its own line (landed in 057-2, PR #469; the edit row's backlink stays 057-9's); `UNIQUE (company_id, request_id, input_index)`; `CHECK`s: `input_index BETWEEN 0 AND 19` (the bound of `service_lines_identity`), status/field coherence per status (`decided_by`, `decided_by_membership_id`, `decided_via`, `decided_at` and the decider **role** snapshot (`decider_role`, `decider_role_is_system`, `decider_role_name_en`) all set iff status ≠ `PENDING`; the decider **name** snapshot (`decider_name_en`, `decider_name_ar`, `decider_role_name_ar`) stays nullable on a decided row under the 35d name-coherence `CHECK`s (`decider_name_ar` only with `decider_name_en`, `decider_role_name_ar` only with `decider_role_name_en`, every name ≤ 255), because an owner or an admin-only manager may have no employee name and the label then falls back to the role, and is `NULL` while `PENDING`; **channel-specific device:** `decided_device_id IS NOT NULL` iff `decided_via = 'PIN'`, so it is `NULL` for `REMOTE` and while `PENDING`; limit pair iff approved or consumed; reason only when `REJECTED`; **consumption:** `consumed_at` `NOT NULL` iff status = `CONSUMED`; when `CONSUMED`, a `RECORD` has `consumed_line_id NOT NULL` and `consumed_edit_id NULL`, an `EDIT` has `consumed_edit_id NOT NULL` and `consumed_line_id NULL`; both `NULL` in every other status; `approver_is_performer` set iff status ∈ (`APPROVED`, `CONSUMED`), like the limit pair; **per kind:** `kind = 'RECORD'` ⇒ `line_id`, `base_revision`, `base_price`, `base_discount`, `base_net` and `consumed_edit_id` all `NULL`; `kind = 'EDIT'` ⇒ `line_id`, `base_revision` (≥ 1), `base_price`, `base_discount` and `base_net` all `NOT NULL`, `session_id NOT NULL`, `input_index = 0` (an edit request is one proposal) and `consumed_line_id NULL`; the `base_*` amounts follow the `service_lines` price/discount `CHECK`s (≥ 0, `base_discount ≤ base_price`)), `effective_bps` 1…10000, limit source/bps pairs as `service_lines_limit`, reason 1…500 trimmed when present, the service name snapshots with the length and control-character `CHECK`s of `services.name_en` / `name_ar`, the requester snapshot with the 35d-3b `CHECK`s (`requester_name_ar` only with `requester_name_en`, every name ≤ 255, `requester_role ~ '^[a-z][a-z_]{0,63}$'`), `requester_first_name_en`/`_ar` each set iff `requester_name_en`/`_ar` is set and ≤ 255, `customer_first_name` 1…200, `terms_hash ~ '^[0-9a-f]{64}$'`; FKs, each with its exact column list: `(company_id, business_id, branch_id)` → `branches (company_id, business_id, id)` (`branches_company_business_id_key`); `(company_id, business_id, service_id)` → `services (company_id, business_id, id)`; `(company_id, business_id, session_id)` → `service_sessions (company_id, business_id, id)`; `(company_id, customer_id)` → `customers (company_id, id)` (customers are **company-wide**: the table has no `business_id` (migration 0034), so no business-qualified key exists to target; this is the key `service_sessions_customer_fk` uses, and with `session_id` the writer also requires `customer_id` = the session's); **actor-bound membership FKs** `(company_id, requested_by, requested_by_membership_id)` and `(company_id, decided_by, decided_by_membership_id)` → `memberships (company_id, user_id, id)` (the existing `memberships_company_id_user_id_id_key`, as `service_line_edits_membership_fk`), so a user can never be stored with another user's membership (the decider FK is checked whenever the pair is set, i.e. status ≠ `PENDING`); **branch-bound device FK** `(company_id, branch_id, decided_device_id)` → `devices (company_id, branch_id, id)` (the new `devices` key below), so a device of another branch can never be stored as the deciding device (checked whenever `decided_device_id` is set, i.e. `PIN`); **backlink FK** `(company_id, consumed_line_id, id)` → `service_lines (company_id, id, discount_proposal_id)` `DEFERRABLE INITIALLY DEFERRED`: at commit a `CONSUMED` proposal's line must carry `discount_proposal_id` = this proposal (both columns are `NOT NULL` when a `RECORD` is `CONSUMED`, so the FK is always checked then; a line left with a `NULL` `discount_proposal_id` fails it), its referencing lookup served by the partial `UNIQUE (company_id, consumed_line_id)` prefix; it is skipped for an `EDIT`, whose `consumed_line_id` is always `NULL` (`MATCH SIMPLE`); **edit-line FK** `(company_id, business_id, line_id)` → `service_lines (company_id, business_id, id)` (`service_lines_business_id_key`), checked whenever `line_id` is set (`EDIT`); **edit backlink FK** (lands in 057-9 with the column it targets) `(company_id, consumed_edit_id, id)` → `service_line_edits (company_id, id, discount_proposal_id)` `DEFERRABLE INITIALLY DEFERRED`: at commit a `CONSUMED` `EDIT` proposal's edit row must carry `discount_proposal_id` = this proposal, its referencing lookup served by the partial `UNIQUE (company_id, consumed_edit_id)` prefix (no `EDIT` can be consumed before 057-9's writer exists); `ENABLE` + `FORCE` RLS with explicit `USING`/`WITH CHECK`; grants `SELECT, INSERT` and `UPDATE (status, decided_by, decided_by_membership_id, decided_via, decided_device_id`, the decider snapshot columns, `decided_at, approved_limit_source, approved_limit_bps, approver_is_performer, reject_reason, consumed_line_id, consumed_edit_id, consumed_at)` to `pospay_app`; a `BEFORE INSERT OR UPDATE` trigger accepts an insert only as `PENDING` and allows only `PENDING→APPROVED`, `PENDING→REJECTED`, `APPROVED→CONSUMED` and refuses any change to the terms columns, `kind`, `line_id`, `base_revision`, `base_price`, `base_discount`, `base_net`, `input_index`, the service name snapshots, the D-18 label snapshots (`requester_name_*`, `requester_role*`, `requester_first_name_*`, `customer_first_name`) and the request columns (`request_id`, `requested_*`, `requester_limit_*`, `expires_at`: it never changes after the insert, FR-010, DA-Q4b); on **`APPROVED→CONSUMED` only `status`, `consumed_at` and, by kind, `consumed_line_id` (`RECORD`) or `consumed_edit_id` (`EDIT`) may change**: the whole decision snapshot (`decided_by`, `decided_by_membership_id`, `decided_via`, `decided_device_id`, the decider snapshot columns, `decided_at`, `approved_limit_source`, `approved_limit_bps`, `approver_is_performer`) must be `IS NOT DISTINCT FROM` the old row |
| `service_lines` | add `discount_proposal_id uuid NULL`; composite FK `(company_id, discount_proposal_id, id)` → `discount_proposals (company_id, id, consumed_line_id)` `DEFERRABLE INITIALLY DEFERRED` (at commit the proposal must name this line); partial `UNIQUE (company_id, discount_proposal_id)`; `UNIQUE (company_id, id, discount_proposal_id)` (the target of the proposal's backlink FK) | expand-only `ADD COLUMN`; each unique index is built `CONCURRENTLY` in its own migration (ADR-0033) and the backlink key attached with `UNIQUE USING INDEX`; the table-level `INSERT` grant covers the column; no `UPDATE` grant on it (an edit's approval is recorded on its `service_line_edits` row, D-20) |
| `devices` | add `UNIQUE (company_id, branch_id, id)` (`devices_company_branch_id_key`) | the target of the deciding-device FK; expand-only: the unique index is built `CONCURRENTLY` in its own migration and attached with `UNIQUE USING INDEX`, as `branches_company_business_id_key`; no column, grant or policy change |
| `discount_proposal_performers` (new) | `company_id`, `id`, `business_id`, `proposal_id`, `employee_id`, `linked_user_id NULL` (the performer's user link at request time, D-16), `first_name_en text`, `first_name_ar text NULL` (`firstName` of the performer's names at request time, D-18, read by the existing `PerformerCheckPort`) | PK `(company_id, id)` (CLAUDE.md §5, ADR-0007); `UNIQUE (company_id, proposal_id, employee_id)`; tenant-and-business-qualified FKs `(company_id, business_id, proposal_id)` → `discount_proposals (company_id, business_id, id)` (the parent adds that `UNIQUE`) and `(company_id, business_id, employee_id)` → `employees`, each with its own index (*Indexes* below); FK to the global user for `linked_user_id` with a partial index; `first_name_en` 1…255, `first_name_ar` ≤ 255; `ENABLE` + `FORCE` RLS with explicit tenant policies (`USING` and `WITH CHECK` `company_id = app_company_id()`, a `SELECT` and an `INSERT` policy to `pospay_app`, as `service_line_edits`); grants `SELECT, INSERT` only (insert-only); negative isolation test (cross-tenant read = 0 rows, write = error) |
| `discount_approval_notices` (new, consumer PR) | the bell ledger: `company_id`, `id`, `business_id`, `request_id`, `source_event_id`, `decided_at`, `recipient_count >= 0` | PK `(company_id, id)` (CLAUDE.md §5, ADR-0007); `UNIQUE (company_id, request_id)`; `ENABLE` + `FORCE` RLS with explicit tenant policies (`USING` and `WITH CHECK` `company_id = app_company_id()`, as `service_lines`); `SELECT, INSERT` to `pospay_app`; negative isolation test (cross-tenant read = 0 rows, write = error) in 057-3 |
| `discount_self_approval_notices` (new, 057-3b) | the owner-bell ledger of D-19: `company_id`, `id`, `business_id`, `source_event_id`, `decided_at`, `recipient_count >= 0` | PK `(company_id, id)`; `UNIQUE (company_id, source_event_id)`; `ENABLE` + `FORCE` RLS with explicit tenant policies (as `discount_approval_notices`); `SELECT, INSERT` to `pospay_app`; negative isolation test (cross-tenant read = 0 rows, write = error) in 057-3b |
| `service_line_edits` (057-9) | add `discount_proposal_id uuid NULL`; composite FK `(company_id, discount_proposal_id, id)` → `discount_proposals (company_id, id, consumed_edit_id)` `DEFERRABLE INITIALLY DEFERRED` (at commit the proposal must name this edit); partial `UNIQUE (company_id, discount_proposal_id)`; `UNIQUE (company_id, id, discount_proposal_id)` (the target of the proposal's `consumed_edit_id` backlink) | expand-only `ADD COLUMN`; each unique index built `CONCURRENTLY` in its own migration (ADR-0033); the partial `UNIQUE (company_id, discount_proposal_id)` index stays a standalone index (Postgres cannot attach a partial index as a constraint) and only the non-partial `(company_id, id, discount_proposal_id)` index, the FK target, is attached with `UNIQUE USING INDEX`, as on `service_lines`; insert-only table: the existing `INSERT` grant covers the column, no `UPDATE` grant |

The DA-Q3/DA-Q5 columns, their `CHECK`s, uniques and the edit-line FK are part of the `discount_proposals` row above and
land in 057-2, so the table is born with both kinds; only the edit backlink FK lands in 057-9.

**Indexes** (the migration that adds a query adds its index): `(company_id, branch_id, status, expires_at)` for the
device pending list; the partial `(company_id, branch_id, requested_at DESC, id DESC) WHERE status = 'PENDING'` for the
admin `/pending` list's order and keyset cursor; the `UNIQUE (company_id, request_id, input_index)` serves the requester's read (ordered by `input_index`); `(company_id, requested_by,
requested_at DESC)`; **every composite FK gets an index whose leading columns are exactly the FK's columns**
(CLAUDE.md §5): on `discount_proposals` `(company_id, business_id, branch_id)`, `(company_id, business_id,
session_id)` (partial, not null), `(company_id, customer_id)`, `(company_id, business_id, service_id)`, `(company_id,
requested_by, requested_by_membership_id)`, `(company_id, decided_by, decided_by_membership_id)` (partial, not null),
`(company_id, branch_id, decided_device_id)` (partial, not null), `(company_id, business_id, line_id)` (partial, not null) — each exactly the column list of its FK above; on `discount_proposal_performers`
`(company_id, business_id, proposal_id)` for the proposal FK and `(company_id, business_id, employee_id)` for the
employee FK, plus the partial `(linked_user_id) WHERE linked_user_id IS NOT NULL` for the global-user FK; the
`UNIQUE (company_id, proposal_id, employee_id)` does not serve either FK because `business_id` is not in its prefix.
Every new tenant table ships its **negative isolation test**
(cross-tenant read = 0 rows, write = error) and is added to the grants allowlist and `privileges.spec.ts`.

### API contracts (Zod in `packages/contracts/src/orders/discount-approval.ts`)

| Route | Guard | Body → response |
|---|---|---|
| `POST /v1/businesses/:businessId/branches/:branchId/discount-proposals` | `@Require('record:service-sessions:branch')`, `orders` feature, admin user | FR-002 → 201 FR-007 |
| `GET …/discount-proposals?request_id=` (`request_id` required) | `@Require('record:service-sessions:branch')` + `requested_by` = caller | → `{ items }` (FR-008 requester read) |
| `GET …/discount-proposals/pending?cursor&limit` | `@Require('approve:discounts:branch')`, `orders` feature, admin user | → `{ items, next_cursor }` (FR-008 approver list) |
| `POST …/discount-proposals/approve` · `/reject` | `@Require('approve:discounts:branch')`, `orders` feature, admin user, `Idempotency-Key` | FR-017 → 200 FR-018 |
| `GET /v1/devices/me/discount-proposals` | `@Authenticated()`, device only | → FR-016 list |
| `POST /v1/devices/me/discount-proposals/approve` · `/reject` | `@Authenticated()`, device only (any paired device of the branch, the reception computer included), declared write | FR-015 → 200 FR-018 |
| `POST …/service-sessions` and `…/service-sessions/:sessionId/lines` (spec 050) | unchanged | line input + `discount_proposal_id?`; FR-021 response fields |
| `POST …/service-sessions/:sessionId/lines/:lineId/discount-proposals` (DA-Q5) | `@Require('edit:service-line-prices:branch')`, `orders` feature, admin user, `Idempotency-Key` | FR-025 → 201 FR-007 |
| `GET …/service-sessions/:sessionId/lines/:lineId/discount-proposals?request_id=` | `@Require('edit:service-line-prices:branch')` + `requested_by` = caller | → `{ items }` (FR-027) |
| `PATCH …/service-sessions/:sessionId/lines/:lineId` (spec 35d) | unchanged | edit body + `discount_proposal_id?` (FR-026) |

Money in contracts is canonical three-decimal KWD strings; `bigint` mills inside; never `number`.

### Permissions

- `approve:discounts:branch` (new; DA-Q1 answered: owner, general manager, business manager, branch manager by default;
  grantable to any human role; evaluated for a device **only** through the PIN holder's memberships, never the `Device`
  role). Independent of `manage:discounts:company` (which governs setting limits, spec 016) and of the record
  permission.
- The request and the requester's own read use the existing `record:service-sessions:branch`; the read is further
  filtered to the caller's own requests. An edit's request and read (DA-Q5) use the existing
  `edit:service-line-prices:branch` the same way.

### Events, module map and the bell (consumer before writer)

- **Published (new, `orders/events/published.ts`, Arabic one-line doc):** `DiscountApprovalRequested` — emitted once
  per stored request, in its transaction; `DiscountApprovedByPerformer` (DA-Q3, D-19) — emitted once per approve
  transaction that has at least one proposal whose approver performs the line. **SPEC §3 amendment and the new ADR**
  (§7, 057-1).
- **Consumed:** worker `orders` consumer `orders.discount-approval-notice-v1` claims the ledger row, resolves the DP-26
  recipients through a **new** worker identity reader `discountApproverRecipients(branch)` (identity owns permission
  resolution: active memberships covering the branch whose role defaults or ALLOW overrides grant
  `approve:discounts:branch`, minus any covering DENY; PP-15.2, so **not** the ADR-0037 manager rule), drops the
  requester, and appends `DiscountApprovalNoticeRequested` to `notifications` (existing IN_APP storage, admin bell). The request writer
  (057-4b) emits `DiscountApprovalRequested` with `aggregate_type = 'discount_approval_request'` and `aggregate_id` =
  `request_id`, in the same transaction as the proposals (the consumer checks `line_count` and `max_effective_bps`
  against them; ADR-0051 §7). A second
  worker `orders` consumer `orders.discount-self-approval-notice-v1` (057-3b) claims a `discount_self_approval_notices`
  row per event, reads the master switch and the kind's effective alert rule through `AlertRulesPort` (DA-Q11; nothing is
  sent when either is off), resolves the rule's roles covering the branch through the worker identity scoped-role reader
  (default `owner`, the approving owner included: DA-Q10, D-19) and appends `DiscountSelfApprovalNoticeRequested` in groups
  of at most 100.
- **Ports (module-map §3 rows, no new import arrow — `orders → identity, settings` exists, map line 43):**
  `DiscountApprovalAccessPort` (identity: approve permission, DENY, feature, approver memberships, locked),
  `DiscountPinApproverPort` (identity: PIN verify by phone through the existing facility, outcome only),
  `DiscountLimitPort` (settings, reused for the approver), worker `DiscountApprovalNoticeRecipients` (identity,
  tenancy), worker `DiscountApprovalNoticePlace` (tenancy), worker `DiscountSelfApprovalNoticeRecipients` (identity, the rule's roles; default owners), worker `AlertRulesPort`
  (settings, ADR-0010 addendum A-0, built in 62-3) and
  `DiscountSelfApprovalNoticePlace` (tenancy).
- **Bell content (proposed copy; fixed in 057-1):** «طلب موافقة على خصم» · branch · service · «حتى 20%» · number of
  lines; template key `discount_approval_requested`, ar and en. For DA-Q3: the approver's label (the stored
  decider snapshot through `editorLabel`: her name, else the stored role's name, never a fixed «المدير») · «وافق على
  خصم على شغله» / "approved a discount on their own work" · branch · service(s) · «20%»; role-neutral, because DA-Q1
  lets any role hold the approve permission; template key `discount_self_approved`, ar and en. Never a
  customer name or phone.

### Error codes (`message_ar` / `message_en`; added to `src/shared/errors.ts`, never inlined)

- `DISCOUNT_APPROVAL_NOT_NEEDED` 422 — «الخصم ده جوّه حدّك، سجّليه على طول من غير موافقة.» / "This discount is within
  your limit; record it without approval." details `input_indexes`.
- `DISCOUNT_PROPOSAL_NOT_PENDING` 409 — «الطلب ده اتردّ عليه أو خلص وقته.» / "This request was already decided or has
  expired."
- `DISCOUNT_PROPOSAL_CHANGED` 409 — «الطلب اتغيّر من ساعة ما فتحته، افتحه تاني.» / "The request changed since you
  opened it; reopen it."
- `DISCOUNT_APPROVER_LIMIT_TOO_LOW` 403 — «الخصم أكبر من حدّك، محتاج موافقة حد حدّه أعلى.» / "This discount is above
  your limit; it needs an approver with a higher limit." details `limit_bps`, `effective_bps`.
- `DISCOUNT_APPROVER_IS_REQUESTER` 403 — «مينفعش توافق على طلب إنت اللي طلبته.» / "You cannot approve your own
  request."
- `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` 422 — details `approver_membership_ids`.
- `DISCOUNT_REJECT_REASON_INVALID` 422 — «سبب الرفض لحد 500 حرف.» / "The reject reason is up to 500 characters."
- `approval_refusal` values on a rejected line are codes inside `SESSION_DISCOUNT_ABOVE_LIMIT` details, with ar/en
  labels: `NOT_FOUND` «مفيش موافقة صالحة», `NOT_APPROVED` «لسه متوافقش عليه», `EXPIRED` «الموافقة خلص وقتها»,
  `CONSUMED` «الموافقة اتستخدمت», `TERMS_MISMATCH` «البيانات اتغيّرت عن اللي اتوافق عليه».
- Reused: `PIN_INVALID` (401), `PIN_LOCKED` (423), `TOO_MANY_REQUESTS` (429), `SESSION_DISCOUNT_ABOVE_LIMIT`,
  `SESSION_PERFORMER_SELF_FORBIDDEN`, `SESSION_PERFORMER_NOT_ELIGIBLE`, `SESSION_TIME_TOO_OLD`,
  `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN`, `FEATURE_DISABLED`.

## 7. Delivery: the sub-PR split (owner rule 2026-10-12: at most three subtasks per PR)

Consumer before writer: the bell consumer lands before the request writer, and the consumption (row 41) lands before
anything can approve, so no approval can exist that a line cannot consume. Sizes are hand-written lines incl. tests.

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **057-1** | Contracts, template, map, ADR; no behaviour | 1. Zod contracts and OpenAPI for every route of §6, the additive fields on the spec 050 line input/rejected/accepted shapes, `DiscountApprovalRequested`, `DiscountApprovalNoticeRequested`, `DiscountApprovedByPerformer` and `DiscountSelfApprovalNoticeRequested`, the 35d `PATCH` field and the edit-request contracts (D-20). 2. Templates `discount_approval_requested` and `discount_self_approved` ar/en, admin bell render, registration in `NOTIFICATION_SOURCE_EVENTS` and the worker's known types. 3. Module-map rows + generated YAML + **the new ADR** (D-9: the reception computer paired as a branch device and how it coexists with SS-Q3's individual logins; the PIN as an approval proof on a paired device; the D-08 + D-15 lockout; the two events) + SPEC §3 amendment (two events) and SPEC §4 amendment (`expires_at` 24 h, DA-Q4) | this spec merged (DA-Q3, DA-Q6, DA-Q7 answered) | 320–440 |
| **057-2** | Permission and storage | 1. `approve:discounts:branch` + default roles (DA-Q1). 2. `discount_proposals` (incl. the DA-Q3/DA-Q5 columns `kind`, `line_id`, `base_revision`, `base_price`, `base_discount`, `base_net`, `approver_is_performer`, `consumed_edit_id`, their per-kind and consumption `CHECK`s, the edit-line FK and `dp_consumed_edit_fk` with its target key `service_line_edits_line_id_key`; the edit backlink FK is 057-9's) and `discount_proposal_performers` with `CHECK`s, the D-18 snapshot columns, transition trigger, `ENABLE` + `FORCE` RLS with explicit tenant policies on both, grants, indexes, negative tests, and the `devices (company_id, branch_id, id)` key. 3. `service_lines.discount_proposal_id` + the deferred composite FK + allowlist/inventory updates | 057-1 (DA-Q1 answered) | 380–520 |
| **057-3** | The bell works for any `DiscountApprovalRequested` | 1. `discount_approval_notices` migration, `ENABLE` + `FORCE` RLS with tenant policies, grants, negative isolation test. 2. Worker identity reader `discountApproverRecipients` (PP-15.2) + worker `orders` use case, place adapter, consumer registration. 3. Delivery tests (once, isolation, non-manager holder in, DENY out, other branch out, requester excluded, groups ≤ 100, zero recipients) | 057-1, 057-2 (DA-Q11 answered: always on, outside the alert rules) | 380–520 |
| **057-3b** | The owner bell works for any `DiscountApprovedByPerformer` (DA-Q3) | 1. `discount_self_approval_notices` migration, `ENABLE` + `FORCE` RLS with tenant policies, grants, negative isolation test. 2. Worker recipient read (scoped-role reader with the roles of the kind's effective rule, default `owner`) + worker `orders` use case, place adapter, consumer registration. 3. Delivery tests DP-19c (once; with the default rule owners only, the approving owner included (DA-Q10); after the rule's recipients are edited, exactly the edited roles; master switch off sends nothing; another company out, zero recipients, groups ≤ 100) | 057-1, 057-2, 62-1, 62-3 (it builds the worker `orders` read of `AlertRulesPort`), **A-0** (the ADR-0010 addendum declaring worker `orders` → `AlertRulesPort`, spec 060 D-B14) (DA-Q11: reads the master switch and its own kind's rule through `AlertRulesPort`, registers the kind in the 62-1 catalog with the owner as default recipient and `IN_APP`, and appears on the 62-4 screen, issue #485) | 300–420 |
| **057-4a** | Pure rules | 1. `orders/domain` functions of FR-009 with Arabic JSDoc. 2. Error codes ar/en + `approval_refusal` labels. 3. Exhaustive unit tests | 057-1 | 260–360 |
| **057-4b** | Row 38: request writer and reads | 1. Proposal repository + ports/adapters, writing the D-18 label snapshots. 2. `RequestDiscountApprovalUseCase` (FR-005), HTTP, idempotency. 3. Requester read and the separate `/pending` approver list (`queries/` over `orders` tables only, `EXPLAIN`), tests DP-01…DP-07 | 057-4a, 057-3 | 420–560 |
| **057-5** | Row 41: consumption in create/append | 1. Proposal lock + CAS inside the spec 050 writers (FR-019/FR-020). 2. Contract fields FR-021. 3. Tests DP-20…DP-25 incl. the race and replay | 057-4b, 057-5b (the database bindings land before any consumption) | 300–440 |
| **057-5b** | D-21 consumption bindings | 1. Migration: the consumption link binds business, service and (when set) the visit, and the proposal's branch binds to its session's branch (#478, #479). 2. Allowlist and inventory updates. 3. A negative test per mismatch | 057-2 (before 057-5, while no proposal is consumed) | 150–250 |
| **057-6** | Row 40: remote approve/reject | 1. `DiscountApprovalAccessPort` (identity) + adapter. 2. `DecideDiscountProposalsUseCase` (FR-011…FR-014, the DA-Q3 flag and `DiscountApprovedByPerformer`) + admin routes. 3. Tests DP-13…DP-19b | 057-5, 057-3b | 380–520 |
| **057-7** | Row 39: PIN on the paired device | 1. `DiscountPinApproverPort` over identity's PIN facility (no new hashing) + the device-wide cap of D-15. 2. Device list + approve/reject routes with membership selection, PP-7.1 declaration. 3. Tests DP-08…DP-12 (incl. DP-08b, DP-09b, DP-10b), PIN privacy (FR-023) | 057-6 | 340–460 |
| **057-8a** | Reception and admin screens | 1. «اطلب موافقة» on refused lines + polling status + resend with the id (35c screen). 2. Admin pending list with approve/reject. 3. ar/en keys and component tests asserting what the user sees | 057-6 | 300–420 |
| **057-8b** | Approval screen on the paired reception computer | 1. Pairing the reception computer through the existing POS pairing screen (desktop layout) + the pending list. 2. Phone + PIN approve/reject with the membership pick of DP-09b. 3. ar/en keys and component tests asserting what the user sees, incl. the lock message | 057-7, 057-8a | 260–380 |
| **057-9** | Edit path (DA-Q5): an edit requests and consumes an approval | 1. `service_line_edits.discount_proposal_id`, the deferred FK pair with the proposal's `consumed_edit_id` (indexes `CONCURRENTLY`) and the pure `buildDiscountEditTerms` with Arabic JSDoc and unit tests. 2. Edit request route and editor read (FR-025, FR-027) and the `PATCH` consumption inside the 35d writer (FR-026). 3. Tests DP-27…DP-30 incl. stale revision, mismatch, race and replay | 057-5, 057-6 | 380–520 |
| **057-9b** | Edit screen | 1. «اطلب موافقة» on a refused edit in the 35d edit dialog + polling + resend with the id. 2. The `EDIT` rows (before → after) in the admin pending list and the device list. 3. ar/en keys and component tests asserting what the user sees | 057-9, 057-8a, 057-8b | 200–300 |

**Design advisors** review 057-2 before it starts (a new tenant table with an `UPDATE` grant and a deferred FK into a
money table). **File overlap:** 057-5 touches the spec 050 writers and contracts; it runs alone against any other
open PR on those files; 057-9 touches the 35d edit writer and runs alone the same way.

## 8. Success criteria

- **SC-001** A receptionist gets a discount above her limit approved and saved in under two minutes when the manager is
  at the branch: the manager types her phone and PIN on the paired reception computer without logging into the admin
  app there.
- **SC-002** 0 lines are saved above the recorder's limit without a consumed approval whose terms hash equals the
  line's; every such line names its proposal, and every consumed proposal names its line. Likewise (DA-Q5) 0 edits are
  saved above the editor's limit without a consumed `EDIT` approval of that revision, and every such edit row names its
  proposal.
- **SC-003** 0 approvals by the requester or by an approver whose limit is below the discount (DA-Q2); every approval
  by a performer of the line (DA-Q3) is flagged and rings the owners' bell exactly once.
- **SC-004** One approval saves at most one line, even under concurrent submissions and retries.
- **SC-005** No PIN or phone appears in any log, audit entry, event, bell or response, and no customer name either, except
  the customer **first** name projected to an approver by the FR-016 device list and the FR-008 branch list
  (`approve:discounts:branch`).

## 9. Assumptions

- The money answers DA-Q1…DA-Q5 are Waleed's (cards, 2026-10-21) and are published as batch 34; Abu Salem's pick
  replaces Waleed's where it differs (CLAUDE.md §1 5b). Each is confined to the FR it names, so a different pick changes
  one rule, not the design. The follow-up DA-Q4b (batch 42, PP-25.2) was Waleed's «a fresh 24 hours from the approval to
  save»; **Abu Salem picked «24 hours from the request for everything» on 2026-10-22 and that binds** (FR-010; his DA-Q4
  15-minute pick conflicts with it, so the pending DA-Q12 asks him to confirm; Waleed's chat line of 2026-10-22 agrees with DA-Q4b). DA-Q10 (batch 43, PP-26.1: the owner
  bell reaches every active owner, the approving owner included) is Waleed's card of 2026-10-21, no difference.
- 057-1 and 057-2 are merged with the old DA-Q4b rule (the `expires_at` reset on approval in the `discount_proposals`
  trigger and `UPDATE` grant, the contracts text and ADR-0051); issue #494 brings them in line with FR-010 and §6.
- Any active paired device of the branch can serve the approval routes (D-9); only the reception computer is deployed
  for it. If Waleed wants approval limited to that one computer, a device role/flag is added in 057-7.
- The device-wide cap of D-15 (10 failures / 15 minutes) is a technical number answering Waleed's request for a
  lockout; the ADR may tune it.
- A PIN approver needs **two** things this spec does not create: an **approved global phone binding** (a
  platform operation, `approvePhoneBinding`, ADR-0019; there is no tenant endpoint for it today) and a PIN set by a
  manager (`POST /v1/staff-pins/reset`, `manage:memberships:company`). Owners and admin-only managers sign in with
  email + TOTP and may have neither; until both exist for them they can approve **remotely** (row 40) only. Adding a
  tenant-side binding or enrollment flow is out of scope and would need its own decision.
- Shares are outside the terms (D-2): a share change between approval and saving keeps the approval valid; a
  performer change voids it.
- Bell wording, the device list columns and the 20-line request size follow existing patterns; changing them needs no
  migration.
- Phase 1 screens poll (SPEC §2 Out: realtime); the requester learns of a decision by polling her request.
- Package sale lines adopt this consumption when rows 42/46 land; this spec does not change them.
