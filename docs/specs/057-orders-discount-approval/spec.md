# Spec 057 — Discount approval: request, approve by PIN or remotely, consume (Phase 1 rows 38–41)

> **Status:** Draft · 2026-10-21 · docs-only PR. Eight owner questions are open (DA-Q1…DA-Q8) in
> [owner-questions.ar.md](owner-questions.ar.md): five charges/money questions for the decisions page and three
> permission/technical questions for Waleed. Until they are answered, every rule they govern is written on the
> recommended option and marked `TODO(spec)`; **no sub-PR that depends on an open question starts** (§7).
> **Rows:** 38 `request-discount-approval` (proposal with terms hash) · 39 `approve-discount` by PIN on the device ·
> 40 `approve-discount` remotely · 41 above-limit discounts consume the approval in the line's transaction (SPEC M2).
> **Extends:** [spec 050](../050-orders-record-service-session/spec.md) (the create and append routes, SS-Q6 partial
> acceptance, FR-007/FR-008 limit read and effective bps) · [spec 016](../016-identity-discount-limit/spec.md) (the
> per-person limit) · [spec 018](../018-settings-business-discount-default/spec.md) (the business default) ·
> [ADR-0003](../../adr/0003-auth-rls-boundary.md) §4 path B and §4.2 (device + PIN, lockout D-08) ·
> [ADR-0019](../../adr/0019-staff-otp-login.md) (the user-held PIN).
> **Relates to:** [spec 35d](../050-orders-record-service-session/spec-35d.md) (an edit keeps the editor's own limit;
> DA-Q5 decides whether an edit may use an approval) · [spec 055](../055-orders-change-line-performers/spec.md) (shape,
> bell family, self rule).
> **Depends on:** row 35 (35a create/append, merged), rows 7/7b/7c (permissions, per-person and business limits,
> merged), 35b-2 (the worker `orders` bell pattern, merged).
> **Needs, before code:** a new ADR (PIN as an approval credential on a paired device, and the request event; §6) and a
> SPEC §3 amendment for the new event (plan §4: "any module arrow or event not in SPEC §3" stops for a decision).

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
   منى; its `terms_hash` is the SHA-256 of those terms. Status `PENDING`, valid 15 minutes (SPEC §4). The branch
   managers get a bell (DA-Q7).
3. ليلى walks to the branch tablet, picks the request, types her phone and PIN. Her limit (2000) covers 2000 bps, she
   is not منى and not سارة: the proposal becomes `APPROVED`, `via = PIN`, with a fresh 15-minute validity (DA-Q4).
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
| How long an approval lives | **settled, not asked:** 15 minutes (SPEC §4 `expires_at (15 min)`); **what the 15 minutes count from** is DA-Q4 | FR-010, D-7 |
| One approval ↔ one line | **settled, not asked:** SPEC §4 `consumed_by_line?` is singular; one proposal is consumed by exactly one line | D-3, FR-019 |
| Terms or price change after approval | **settled, not asked:** M2 "exactly matching terms … changed terms, replay and cross-branch use fail": a new proposal is needed | D-4, FR-020 |
| Consumption | **settled, not asked:** M2 compare-and-set in the line's own transaction; two concurrent uses of one approval: one wins | FR-019, DP-20 |
| Who may approve (DA-Q1) | ⭐ new permission `approve:discounts:branch`, default owner, general manager, business manager, branch manager — `TODO(spec)` | FR-012 |
| How much (DA-Q2) | ⭐ the approver's own effective limit must cover the line's effective bps — `TODO(spec)` | FR-013 |
| Approver on her own line (DA-Q3) | ⭐ refused, like ED-Q4 / PF-Q2, owner included — `TODO(spec)` | FR-014 |
| The 15-minute clock (DA-Q4) | ⭐ 15 min to decide from the request; on approval a fresh 15 min to use — `TODO(spec)` | FR-010 |
| Approval on an edit of a saved line (DA-Q5) | ⭐ not in Phase 1: 35d keeps the editor's own limit — `TODO(spec)` | §2 *Not in* |
| Where the PIN is typed (DA-Q6) | ⭐ on the branch's paired POS device, never on the admin reception computer — `TODO(spec)` | FR-015, D-9 |
| Bell for a new request (DA-Q7) | ⭐ in-app bell to the four scoped manager roles of the branch — `TODO(spec)` | FR-024 |
| What the device shows before a PIN (DA-Q8) | ⭐ service, amounts, requester and customer **first** names, age of the request; never a phone — `TODO(spec)` | FR-016 |

**Not in 057:** an approval used by a 35d edit (DA-Q5 ⭐ keeps it out); a discount on a **package** sale line (rows
42/46: SPEC §4 checks a package's discount once on its sale line, and that writer adopts this consumption when it
lands); counter-offers (an approver approves or rejects the exact terms, M2); a requester "cancel" action (an unused
proposal simply lapses); offline approval on the POS (ADR-0003 §4: an offline action without an operator credential
is quarantined; P2-T9); WhatsApp or email for the request (tenant outbound stays closed, ADR-0013); payments, printing.

### Decisions record (technical; none is an owner question)

| ID | Decision | Alternative rejected |
|---|---|---|
| D-1 | **Ownership.** `orders` owns `discount_proposals` (SPEC §3: orders owns "discount proposals"), because the proposal is consumed in the line's transaction and no module writes another's table. `identity` supplies what SPEC §2 lists under it ("discount approval (PIN on device or remote request)"): verifying the approver's PIN and resolving the approver's authority, through consumer-owned ports in `orders/ports` (the ADR-0041 pattern). `settings` supplies the approver's limit through the existing `DiscountLimitPort` | the proposal in identity (the line writer would then write identity's table, or consume through a second transaction, which breaks M2) |
| D-2 | **Terms** (`DiscountTermsV1`) = `{ v: 1, company_id, business_id, branch_id, customer_id, session_id \| null, occurred_business_date, service_id, list_price, price, discount, net, effective_bps, performer_ids (sorted, distinct), requested_by, requested_by_membership_id }`, money as canonical three-decimal strings. `terms_hash` = SHA-256 (hex) of the canonical JSON (sorted keys, the shared fingerprint helper of spec 050 §8). Shares are **not** in the terms (they do not change the discount); the performer set is, so the self rule of DA-Q3 is decided on what the approver saw | hashing amounts only (an approval for one customer or service would then pay for another, against M2); including shares (a share fix would void an approval for no money reason) |
| D-3 | One proposal per line. A request may carry **1…20 lines** of one draft visit (the spec 050 limit); they share a `request_id` (one bell, one list row) but each line is its own proposal with its own hash, approval and consumption. A batch approve is all-or-nothing and checks every proposal on its own | one proposal for a visit total (D-56 and 7b check per line, never per order) |
| D-4 | Exact match only. At consumption the line's terms are recomputed from the line being written (fresh catalog list price, the same domain functions) and hashed; any difference refuses. No tolerance, no "smaller discount is fine" | a tolerance band (M2 says "exactly matching") |
| D-5 | **Requester ≠ approver**, always, whatever the role (the same user can never ask and approve). The proposal is consumed only by the **requester's own user** on the same membership (both are inside the hash) | anyone at the branch may consume (replay by another person; M2 refuses replay) |
| D-6 | A request is refused unless **every** line is above the requester's own effective limit at request time (`DISCOUNT_APPROVAL_NOT_NEEDED`, with the input indexes). A line inside the limit with a proposal id at consumption is saved on the recorder's own limit and the proposal is **not** consumed (it lapses) | consuming an unneeded approval (it would record an approval that authorised nothing) |
| D-7 | `EXPIRED` is **derived**, never written: a `PENDING` or `APPROVED` row whose `expires_at ≤ now` (injected clock, the fresh instant after every lock wait) reads and behaves as `EXPIRED`. No sweeper job | a status-writing job (one more writer to race the approver and the consumer) |
| D-8 | Approval does not change the line row's limit columns: `limit_source` / `limit_bps_applied` stay the **recorder's** own (what she really had); the line gains a nullable `discount_proposal_id` and a deferred composite FK proves the proposal points back at it (§6) | a new `limit_source = 'APPROVAL'` (rewrites the `service_lines_limit` CHECK on a live table and hides the recorder's real limit) |
| D-9 | (DA-Q6 ⭐) **PIN on the paired branch device**, ADR-0003 §4 path B: the device is already approved and bound to one branch; the PIN identifies the approver for **this one action**, opens no session and never opens `app.`. The PIN is verified by identity's existing facility (hash in `packages/auth`, Redis reservation and lockout: 5 failures → 15 min, D-08; an unknown holder is compared against the placeholder hash) **outside** the database transaction; the approval transaction then rechecks authority under locks | typing the manager's PIN into the receptionist's admin session (a PIN outside a paired device: any logged-in user could probe any manager's PIN and lock it; needs its own ADR) |
| D-10 | The approver is identified on the device by **phone + PIN**, the shape of the existing staff PIN sign-in (`staffPinInput`, ADR-0019 user-held PIN). The approver's authority is that user's memberships **filtered to scopes covering the device's branch** (ADR-0003 path B); DENY wins | picking a name from a list (it would list every manager on a shared tablet) |
| D-11 | Remote approval (row 40) is an ordinary admin user session with `approve:discounts:branch` on the proposal's branch; the approver membership is chosen like 35a's recorder (optional `approver_membership_id`; one eligible picked automatically; several → `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED`; never the highest limit) | the principal-wide limit (a membership without the grant would lend its higher limit, 35d D-9) |
| D-12 | Reject is allowed by the same authority on both channels, with an optional reason (≤ 500 characters, trimmed) shown to the requester; a rejected proposal is final | requiring a reason (slows a manager at the till; nothing moves money on a reject) |
| D-13 | A consumption failure inside a create/append is an **above-limit** refusal of that line under SS-Q6 (the line returns for editing with `approval_refusal`), never a whole-request 403, so the other lines still save (SS-26). A proposal id that is unknown, foreign, of another branch or of another requester returns the same `NOT_FOUND` refusal (no oracle) | rolling back the whole visit for one stale approval (contradicts SS-Q6) |
| D-14 | Orders emits one new event, `DiscountApprovalRequested`, only for the bell (DA-Q7). Approvals, rejects and consumption emit **no** event: commissions read the line's `net` from the existing line events, and nothing else consumes an approval | events for every transition (no consumer) |

## 3. Settled rules this spec builds on (cited, not asked)

- **Effective discount** = `(list_price − net) / list_price`, ceil to bps, `0` at list 0 or `net ≥ list` (D-56/M13,
  spec 050 FR-008); percent amounts half-up to the mill (SS-Q5). The terms store the ceiled bps.
- **Limits:** active owner → unlimited; personal → business default → `NOT_CONFIGURED` = 0 (spec 016, spec 018, spec
  050 FR-007). Read inside the transaction through `DiscountLimitPort`, never cached.
- **Above the limit needs approval** (spec 016 business rules: "any fraction above the limit counts as over the limit
  and needs approval"); until rows 38–41 the line is refused (SS-Q6 background, spec 050 owner-questions §6).
- **Recording** is on the admin app at the reception computer, each recorder with her own login (SS-Q3); the recorder
  is never a performer of the line (SS-Q2, SS-25).
- **PIN:** 4 digits, locked after 5 failures for 15 minutes (D-08, ADR-0003 §4.2); a manager's PIN never signs in
  someone else (ADR-0019 Q8).

## 4. User scenarios and acceptance criteria *(mandatory)*

Named tests; integration tests against real Postgres (T2 stack, ADR-0006) unless marked unit. People as in §1; هبة is a
second branch manager who also performs services.

### Story 1 — The recorder asks for approval (row 38, P1)

- **DP-01** منى posts the صبغة draft (2000 bps, her limit 1000) with the saved visit's id. One proposal: status
  `PENDING`, `request_id`, `terms` and `terms_hash` as D-2, `expires_at = requested_at + 15 min`, requester user and
  membership, the requester's limit source and bps at request time; one audit entry; one `DiscountApprovalRequested`
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
- **DP-07** منى reads her request (`GET …/discount-proposals?request_id=`) and sees each line's status
  (`PENDING`/`APPROVED`/`REJECTED`/`EXPIRED`/`CONSUMED`), the approver's label and `via` once decided, the reject
  reason if any. She cannot read another recorder's proposals.

### Story 2 — Approve by PIN on the branch device (row 39, P1)

- **DP-08** (DA-Q8 ⭐) The paired device at السالمية lists the branch's live `PENDING` proposals: service name, list,
  price, discount, net, percent, requester first name, customer first name, minutes left. No phone, no other branch.
- **DP-09** ليلى selects the request, enters phone + PIN. PIN verified (identity facility, outside the transaction);
  then one transaction: lock the proposals `FOR UPDATE` ascending → still `PENDING`, not expired (fresh instant) →
  ليلى's memberships covering the device's branch grant `approve:discounts:branch`, no DENY, `orders` on → her limit
  (2000) ≥ 2000 bps → she is not the requester, not a performer → `APPROVED`, `approved_by` = ليلى's user and
  membership, `via = PIN`, `approved_device_id`, `approved_limit_source/bps`, `expires_at = approved_at + 15 min`
  (DA-Q4 ⭐); one audit entry per proposal.
- **DP-10** Wrong PIN → 401 `PIN_INVALID`, nothing changes; the fifth failure → 423 `PIN_LOCKED` for 15 minutes; five
  comparisons in flight → 429 `TOO_MANY_REQUESTS` (the facility's existing outcomes). An unknown phone behaves like a
  wrong PIN (same code and timing).
- **DP-11** A proposal of another branch, a device of another branch, an unpaired or revoked device → uniform 403.
- **DP-12** The PIN holder has the permission only at another branch → uniform 403 (path B filters to the device's
  branch).

### Story 3 — Approve or reject remotely (row 40, P1)

- **DP-13** The owner, logged into the admin app at home, opens the branch's pending list (`approve:discounts:branch`)
  and approves the 3000 bps صبغة: same transaction as DP-09 with `via = REMOTE`, no device.
- **DP-14** ليلى rejects with «الخصم كبير» → `REJECTED`, `rejected_by`, reason stored; منى sees the reason. A second
  approve or reject of a decided proposal → 409 `DISCOUNT_PROPOSAL_NOT_PENDING`.
- **DP-15** Two approvers race on one proposal (PIN and remote): the row lock serialises them; the second gets 409
  `DISCOUNT_PROPOSAL_NOT_PENDING`.
- **DP-16** A batch approve of three proposals where one is already decided or beyond the approver's limit → the
  whole batch is refused with that proposal's code and id; nothing changes (D-3).

### Story 4 — Who may approve how much (DA-Q1…DA-Q3, P1)

- **DP-17** (DA-Q2 ⭐) ليلى (2000) on a 3000 bps proposal → 403 `DISCOUNT_APPROVER_LIMIT_TOO_LOW` with `limit_bps` and
  the proposal's bps; a membership with `NOT_CONFIGURED` approves nothing; the owner approves any.
- **DP-18** (D-5) The requester tries to approve her own request (she holds the permission) → 403
  `DISCOUNT_APPROVER_IS_REQUESTER`, even as owner.
- **DP-19** (DA-Q3 ⭐) هبة is a performer in the terms → 403 `DISCOUNT_APPROVER_IS_PERFORMER` (snapshot ∪ current link,
  the 35d self rule), even as owner.

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

### Story 6 — Bell (DA-Q7, P2)

- **DP-26** One bell per request (`request_id`) to the four scoped manager roles of the branch (the recipient rule of
  the 35b, 35d, 054 and 055 bells), the requester **excluded** (she asked); zero recipients → a ledger row with count
  0, no error. Bell content: branch, service name(s), the largest percent, number of lines; no customer name, no phone.

### Edge cases

- The catalog price changes between request and consumption → `TERMS_MISMATCH` (the fresh list price is in the terms).
- The requester's membership ends or her record permission is revoked → her consumption fails the recording's own
  authority check (403 for the whole request, as today); the proposal lapses.
- The approver's permission or limit changes after approval → the approval stands (it was valid when given; audit
  shows the limit used); the line still checks only the hash.
- A visit at 23:55 approved at 00:05 local → the occurred business date in the terms stays the request's; a create
  after midnight with an omitted `occurred_at` computes a new date → `TERMS_MISMATCH` (send the original
  `occurred_at`).
- Opted-out customers, late visits, PARTIAL visits: none changes the right to ask or approve.

## 5. Requirements

- **FR-001** `POST /v1/businesses/:businessId/branches/:branchId/discount-proposals` creates one request of 1…20 lines.
- **FR-002** Body (strict Zod): `{ customer_id, session_id?: uuid, occurred_at?: datetime, lines: [{ service_id, price,
  discount: {kind:'AMOUNT',amount}|{kind:'PERCENT',bps}, performers: [{ employee_id, share_bps? }] }] (1…20),
  requester_membership_id?: uuid }` — the spec 050 line shape, so the screen sends the refused draft unchanged. With
  `session_id` the visit fields come from the saved session (`customer_id` must match) and `occurred_at` is refused.
- **FR-003** Each line is prepared by the **recording** domain functions (spec 050 §9: `lineNet`,
  `discountFromPercent`, `effectiveDiscountBps`, `validateShares`) against a fresh catalog snapshot, and must be above
  the requester's effective limit read through `DiscountLimitPort` (D-6).
- **FR-004** Authority (DP-06) through the existing `SessionRecordAccessPort` (`lock()` then `read()`), rechecked
  inside the transaction before an idempotent replay returns.
- **FR-005** Transaction: idempotency claim → access lock → (with `session_id`) the visit advisory lock → catalog and
  performer reads → limit read → insert the proposals → audit → outbox `DiscountApprovalRequested` → store the 201.
- **FR-006** Idempotency-Key required, COMPANY scope, operation `request-discount-approval`; fingerprint with the shared
  helper over `{method, route, query, body, params:{businessId, branchId, companyId, actorUserId}}`.
- **FR-007** Response 201: `{ request_id, proposals: [{ id, input_index, status, expires_at, effective_bps,
  terms_hash }] }`; no approver data yet.
- **FR-008** Read for the requester: `GET …/discount-proposals?request_id=` (own proposals only) and the branch list
  `GET …/discount-proposals?status=PENDING&cursor&limit` under `approve:discounts:branch`; both are `queries/` files
  (read-only, no `domain/` or `use-cases/` import) with result-shape and `EXPLAIN` tests. Status `EXPIRED` is computed
  in the SQL from `expires_at` and the injected now (D-7).
- **FR-009** Pure domain (`orders/domain`, Arabic JSDoc, no DB): `buildDiscountTerms`, `discountTermsHash` (canonical,
  versioned), `needsApproval`, `proposalState(status, expiresAt, now)`, `canApprove(approverLimit, terms)`,
  `approverSelfRule`, `consumptionRefusal(proposal, lineTerms, actor, now)`; exhaustive unit tests incl. ceil bps,
  half-up percent, list 0, owner unlimited, `NOT_CONFIGURED`.
- **FR-010** (DA-Q4 ⭐, `TODO(spec)`) `expires_at` = request + 15 min while `PENDING`; on approval it is reset to
  approval + 15 min. The 15 is a named constant in `orders/domain`, not a setting.
- **FR-011** Approve and reject act on 1…20 proposals of **one** branch in one transaction: lock the rows `FOR UPDATE`
  in ascending id order → recheck status and expiry at the fresh instant → approver authority (FR-012) → limit
  (FR-013) → self rules (FR-014, D-5) → CAS `UPDATE … WHERE status = 'PENDING'` → audit. All-or-nothing (D-3). The
  approver's limit is read **after** the row locks; the line writers read the recorder's limit **before** locking
  proposals; neither path takes an `orders` lock after a proposal lock, so no cycle.
- **FR-012** (DA-Q1 ⭐) Authority = `approve:discounts:branch` at the proposal's branch, DENY wins, `orders` feature on,
  through a new consumer-owned `DiscountApprovalAccessPort` (identity) with `lock()` then `read(at)` like
  `SessionEditAccessPort`. Remote: the user's memberships (D-11). PIN: the PIN holder's memberships covering the
  device's branch (D-10).
- **FR-013** (DA-Q2 ⭐) The approver membership's effective limit (`DiscountLimitPort.read`): `OWNER` → any;
  `NOT_CONFIGURED` → 0; otherwise `terms.effective_bps ≤ limit_bps` (inclusive). Stored as `approved_limit_source` /
  `approved_limit_bps`.
- **FR-014** (DA-Q3 ⭐) The approver's user must not be linked to any performer in `terms.performer_ids` (snapshot of
  the line when one exists, the current link otherwise, read `FOR SHARE` through the existing performer port); D-5:
  never the requester's user.
- **FR-015** (DA-Q6 ⭐, row 39) Device routes, `@Authenticated()` device-only (PP-7.1: the write declares where its
  permission check lives): `GET /v1/devices/me/discount-proposals` (the device branch's live `PENDING` list, DP-08) and
  `POST /v1/devices/me/discount-proposals/approve` and `/reject`, body `{ proposal_ids (1…20), phone, pin,
  terms_hashes (same order), reason? }`. The PIN is verified first by a new consumer-owned `DiscountPinApproverPort`
  (identity), which returns the holder's user id or `refused` / `locked` / `busy`; then FR-011. `terms_hashes` must
  equal the stored ones (the approver approves what the tablet showed) → otherwise 409
  `DISCOUNT_PROPOSAL_CHANGED`.
- **FR-016** (DA-Q8 ⭐) The device list projects only: proposal id, `request_id`, service name ar/en, list, price,
  discount, net, effective bps, requester first name, customer first name, `requested_at`, `expires_at`, `terms_hash`.
- **FR-017** (row 40) Admin routes under `@Require('approve:discounts:branch', { branch: 'branchId' })` and
  `@RequiresFeature('orders')`: `POST …/discount-proposals/approve` and `/reject`, body `{ proposal_ids (1…20),
  terms_hashes, approver_membership_id?, reason? }`, `Idempotency-Key` required (operation `decide-discount-proposals`).
  Route branch ≠ proposal branch → uniform 403.
- **FR-018** Approve and reject responses: `{ proposals: [{ id, status, expires_at }] }`; never the PIN, never the
  phone.
- **FR-019** (row 41) The spec 050 create and append line input gains optional `discount_proposal_id`. For a line above
  the recorder's limit **with** it: after the recorder's limit read and the visit lock, lock the named proposals
  `FOR UPDATE` in ascending id order, recompute the line's terms (FR-009) and run the CAS of DP-20; success → the line
  is accepted with `discount_proposal_id`; failure → the line joins `rejected_lines` with `approval_refusal` ∈
  `NOT_FOUND | NOT_APPROVED | EXPIRED | CONSUMED | TERMS_MISMATCH` (D-13). Without it: today's refusal, unchanged.
- **FR-020** The same proposal id twice in one request → the second line refused `CONSUMED` (the first consumes).
- **FR-021** The rejected-line contract gains optional `approval_refusal` and `discount_proposal_id` (additive); the
  accepted-line snapshot gains optional `discount_proposal_id`. The approver is shown only through the proposal reads
  (FR-008), labelled by `editorLabel` (`@pospay/i18n`, the 35d label) from the approver snapshot columns.
- **FR-022** Audit entries (CLAUDE.md §8, discounts): `discount_proposal.requested`, `.approved` (via, approver user and
  membership, device, limit used), `.rejected` (no reason text in the audit; the reason lives on the row),
  `.consumed` (line id). No phone, no PIN, no customer name.
- **FR-023** The PIN never enters a log, an audit entry, an event, a response or the idempotency store (the device
  routes take no Idempotency-Key: a retried PIN approve of a decided proposal answers 409, and the screen re-reads).
- **FR-024** (DA-Q7 ⭐) The request transaction appends `DiscountApprovalRequested` (`request_id`, `business_id`,
  `branch_id`, `requested_by`, `line_count`, `max_effective_bps`, service ids, `occurred_at`); a worker `orders`
  consumer resolves the recipients and appends `DiscountApprovalNoticeRequested` to `notifications` in groups of at
  most 100 (§6 *Events*).

## 6. Slice design

### Business rules

- **BR-01** A discount above the recorder's limit is saved only with an approval whose terms match the line exactly and
  that is consumed in the line's own transaction; nothing else lets it through.
- **BR-02** Nobody approves her own request, and (DA-Q3 ⭐) nobody approves a discount on a line she performs.
- **BR-03** (DA-Q2 ⭐) An approver approves only what her own limit would let her record.
- **BR-04** An approval authorises one line once; an unused approval lapses and authorises nothing.
- **BR-05** Orders owns the proposal and its life; identity proves the approver; settings gives the limits. No module
  writes another's table.

### Schema changes

| Table | Change | Notes |
|---|---|---|
| `discount_proposals` (new) | `company_id`, `id` (UUID v7), `business_id`, `branch_id`, `request_id uuid`, `session_id uuid NULL`, `customer_id`, `service_id`, `terms jsonb`, `terms_hash char(64)`, `effective_bps int`, `requested_by` (user), `requested_by_membership_id`, `requester_limit_source`, `requester_limit_bps NULL`, `requested_at`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`CONSUMED`), `expires_at`, `approved_by NULL`, `approved_by_membership_id NULL`, `approved_via` (`PIN`/`REMOTE`) `NULL`, `approved_device_id NULL`, the approver role and name snapshot columns of `service_line_edits` (35d-3b) `NULL`, `approved_limit_source NULL`, `approved_limit_bps NULL`, `decided_at NULL`, `reject_reason NULL`, `consumed_line_id NULL`, `consumed_at NULL` | PK `(company_id, id)`; `UNIQUE (company_id, id, consumed_line_id)` (target of the line's FK); partial `UNIQUE (company_id, consumed_line_id) WHERE consumed_line_id IS NOT NULL`; `CHECK`s: status/field coherence per status, `effective_bps` 1…10000, limit source/bps pairs as `service_lines_limit`, reason 1…500 trimmed when present, `terms_hash ~ '^[0-9a-f]{64}$'`; tenant-and-business-qualified FKs to branch, customer, service, session, memberships, device; `consumed_line_id` FK to `service_lines (company_id, id)` `DEFERRABLE INITIALLY DEFERRED`; `ENABLE` + `FORCE` RLS with explicit `USING`/`WITH CHECK`; grants `SELECT, INSERT` and `UPDATE (status, expires_at, approved_by, approved_by_membership_id, approved_via, approved_device_id`, the approver snapshot columns, `approved_limit_source, approved_limit_bps, decided_at, reject_reason, consumed_line_id, consumed_at)` to `pospay_app`; a `BEFORE UPDATE` trigger allows only `PENDING→APPROVED`, `PENDING→REJECTED`, `APPROVED→CONSUMED` and refuses any change to the terms columns |
| `service_lines` | add `discount_proposal_id uuid NULL`; composite FK `(company_id, discount_proposal_id, id)` → `discount_proposals (company_id, id, consumed_line_id)` `DEFERRABLE INITIALLY DEFERRED` (at commit the proposal must name this line); partial `UNIQUE (company_id, discount_proposal_id)` | expand-only `ADD COLUMN`; the unique index is built `CONCURRENTLY` in its own migration (ADR-0033); the table-level `INSERT` grant covers the column; no `UPDATE` grant on it (DA-Q5 ⭐) |
| `discount_approval_notices` (new, consumer PR) | the bell ledger: `company_id`, `id`, `business_id`, `request_id`, `source_event_id`, `decided_at`, `recipient_count >= 0` | `UNIQUE (company_id, request_id)`; `FORCE` RLS; `SELECT, INSERT` |

**Indexes** (the migration that adds a query adds its index): `(company_id, branch_id, status, expires_at)` for the
pending lists (device and admin); `(company_id, request_id)` for the requester's read; `(company_id, requested_by,
requested_at DESC)`; FK indexes on `session_id`, `customer_id`, `service_id`, `requested_by_membership_id`,
`approved_by_membership_id`, `approved_device_id`. Every new tenant table ships its **negative isolation test**
(cross-tenant read = 0 rows, write = error) and is added to the grants allowlist and `privileges.spec.ts`.

### API contracts (Zod in `packages/contracts/src/orders/discount-approval.ts`)

| Route | Guard | Body → response |
|---|---|---|
| `POST /v1/businesses/:businessId/branches/:branchId/discount-proposals` | `@Require('record:service-sessions:branch')`, `orders` feature, admin user | FR-002 → 201 FR-007 |
| `GET …/discount-proposals?request_id=` · `?status=PENDING&cursor&limit` | requester own read · `@Require('approve:discounts:branch')` | → `{ items, next_cursor }` |
| `POST …/discount-proposals/approve` · `/reject` | `@Require('approve:discounts:branch')`, `orders` feature, admin user, `Idempotency-Key` | FR-017 → 200 FR-018 |
| `GET /v1/devices/me/discount-proposals` | `@Authenticated()`, device only | → FR-016 list |
| `POST /v1/devices/me/discount-proposals/approve` · `/reject` | `@Authenticated()`, device only, declared write | FR-015 → 200 FR-018 |
| `POST …/service-sessions` and `…/service-sessions/:sessionId/lines` (spec 050) | unchanged | line input + `discount_proposal_id?`; FR-021 response fields |

Money in contracts is canonical three-decimal KWD strings; `bigint` mills inside; never `number`.

### Permissions

- `approve:discounts:branch` (new; DA-Q1 ⭐ owner, general manager, business manager, branch manager by default;
  grantable to any human role; evaluated for a device **only** through the PIN holder's memberships, never the `Device`
  role). Independent of `manage:discounts:company` (which governs setting limits, spec 016) and of the record
  permission.
- The request uses the existing `record:service-sessions:branch`. The requester's own read needs nothing more.

### Events, module map and the bell (consumer before writer)

- **Published (new, `orders/events/published.ts`, Arabic one-line doc):** `DiscountApprovalRequested` — emitted once
  per stored request, in its transaction. **SPEC §3 amendment and the new ADR** (§7, 057-1).
- **Consumed:** worker `orders` consumer `orders.discount-approval-notice-v1` claims the ledger row, resolves recipients
  through `identity.branchManagerRecipients` (the ADR-0037 interim rule; the requester excluded) and appends
  `DiscountApprovalNoticeRequested` to `notifications` (existing IN_APP storage, admin bell). Row 62 later replaces the
  interim rule.
- **Ports (module-map §3 rows, no new import arrow — `orders → identity, settings` exists, map line 43):**
  `DiscountApprovalAccessPort` (identity: approve permission, DENY, feature, approver memberships, locked),
  `DiscountPinApproverPort` (identity: PIN verify by phone through the existing facility, outcome only),
  `DiscountLimitPort` (settings, reused for the approver), worker `DiscountApprovalNoticeRecipients` (identity,
  tenancy), worker `DiscountApprovalNoticePlace` (tenancy).
- **Bell content (proposed copy; fixed in 057-1):** «طلب موافقة على خصم» · branch · service · «حتى 20%» · number of
  lines; template key `discount_approval_requested`, ar and en. Never a customer name or phone.

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
- `DISCOUNT_APPROVER_IS_PERFORMER` 403 — «مينفعش توافق على خصم خدمة إنت منفّذها.» / "You cannot approve a discount on
  a service you perform."
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
| **057-1** | Contracts, template, map, ADR; no behaviour | 1. Zod contracts and OpenAPI for every route of §6, the additive fields on the spec 050 line input/rejected/accepted shapes, `DiscountApprovalRequested` and `DiscountApprovalNoticeRequested`. 2. Template `discount_approval_requested` ar/en, admin bell render, registration in `NOTIFICATION_SOURCE_EVENTS` and the worker's known types. 3. Module-map rows + generated YAML + the new ADR (PIN approval on a paired device; the event) + SPEC §3 amendment | this spec merged; DA-Q6, DA-Q7 | 260–380 |
| **057-2** | Permission and storage | 1. `approve:discounts:branch` + default roles (DA-Q1). 2. `discount_proposals` with `CHECK`s, transition trigger, `FORCE` RLS, grants, indexes, negative tests. 3. `service_lines.discount_proposal_id` + the deferred composite FK + allowlist/inventory updates | 057-1; DA-Q1 | 320–460 |
| **057-3** | The bell works for any `DiscountApprovalRequested` | 1. `discount_approval_notices` migration, RLS, grants. 2. Worker `orders` use case, recipient/place adapters, consumer registration. 3. Delivery tests (once, isolation, no manager, groups ≤ 100, requester excluded) | 057-1, 057-2 | 340–480 |
| **057-4a** | Pure rules | 1. `orders/domain` functions of FR-009 with Arabic JSDoc. 2. Error codes ar/en + `approval_refusal` labels. 3. Exhaustive unit tests | 057-1; DA-Q2, DA-Q3, DA-Q4 | 260–360 |
| **057-4b** | Row 38: request writer and reads | 1. Proposal repository + ports/adapters. 2. `RequestDiscountApprovalUseCase` (FR-005), HTTP, idempotency. 3. Requester and branch reads (`queries/`, `EXPLAIN`), tests DP-01…DP-07 | 057-4a, 057-3 | 420–560 |
| **057-5** | Row 41: consumption in create/append | 1. Proposal lock + CAS inside the spec 050 writers (FR-019/FR-020). 2. Contract fields FR-021. 3. Tests DP-20…DP-25 incl. the race and replay | 057-4b | 300–440 |
| **057-6** | Row 40: remote approve/reject | 1. `DiscountApprovalAccessPort` (identity) + adapter. 2. `DecideDiscountProposalsUseCase` (FR-011…FR-014) + admin routes. 3. Tests DP-13…DP-19 | 057-5 | 380–520 |
| **057-7** | Row 39: PIN on the device | 1. `DiscountPinApproverPort` over identity's PIN facility (no new hashing). 2. Device list + approve/reject routes, PP-7.1 declaration. 3. Tests DP-08…DP-12, PIN privacy (FR-023) | 057-6; DA-Q6, DA-Q8 | 300–420 |
| **057-8a** | Reception and admin screens | 1. «اطلب موافقة» on refused lines + polling status + resend with the id (35c screen). 2. Admin pending list with approve/reject. 3. ar/en keys and component tests asserting what the user sees | 057-6 | 300–420 |
| **057-8b** | POS device screen | 1. Pending list on the paired device. 2. Phone + PIN approve/reject. 3. ar/en keys and component tests | 057-7, 057-8a | 240–340 |

**Design advisors** review 057-2 before it starts (a new tenant table with an `UPDATE` grant and a deferred FK into a
money table). **File overlap:** 057-5 touches the spec 050 writers and contracts; it runs alone against any other
open PR on those files.

## 8. Success criteria

- **SC-001** A receptionist gets a discount above her limit approved and saved in under two minutes when the manager is
  at the branch, without the manager logging into the reception computer.
- **SC-002** 0 lines are saved above the recorder's limit without a consumed approval whose terms hash equals the
  line's; every such line names its proposal, and every consumed proposal names its line.
- **SC-003** 0 approvals by the requester, by an approver whose limit is below the discount (DA-Q2 ⭐), or (DA-Q3 ⭐) by
  a performer of the line.
- **SC-004** One approval saves at most one line, even under concurrent submissions and retries.
- **SC-005** No PIN, phone or customer name appears in any log, audit entry, event, bell or response beyond FR-016.

## 9. Assumptions

- All answers marked ⭐ are assumed until the owners answer; each is confined to the FR it names, so a different pick
  changes one rule, not the design (DA-Q6 is the exception: a PIN on the admin reception computer needs a different
  ADR and replaces 057-7 and 057-8b).
- The approver must already have a PIN set by a manager (`POST /v1/staff-pins/reset`, `manage:memberships:company`, ADR-0019);
  this spec adds no PIN enrollment.
- Shares are outside the terms (D-2): a share change between approval and saving keeps the approval valid; a
  performer change voids it.
- Bell wording, the device list columns and the 20-line request size follow existing patterns; changing them needs no
  migration.
- Phase 1 screens poll (SPEC §2 Out: realtime); the requester learns of a decision by polling her request.
- Package sale lines adopt this consumption when rows 42/46 land; this spec does not change them.
