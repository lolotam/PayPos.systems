# Plan 057-8a — reception request/poll/resend and admin pending list

Spec: `spec.md` §7 row 057-8a (Stories 1, 3, 5; FR-002, FR-007, FR-008, FR-017, FR-018, FR-019, FR-021).
Backend, contracts and OpenAPI are on main (057-1, 057-4b, 057-5, 057-6): `POST/GET …/discount-proposals`,
`GET …/discount-proposals/pending`, `POST …/discount-proposals/approve|reject`, all in `apps/admin/src/shared/api/schema.d.ts`.
No backend gap found; this PR adds no API, contract or migration code.

## Manager decisions (2026-11-13, technical)

1. **Split.** Part A ships as **057-8a-1** (one PR, size ~436). Part B ships as **057-8a-2** in the same session after
   057-8a-1 merges.
2. **Membership pick for remote approval** (D-11, `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED`) is in scope, in 057-8a-2.
   Without it an approver with two eligible memberships cannot approve from the admin app.
3. **Known limitation:** the `request_id` lives in memory only and is lost on reload; no storage is added (see
   *Reload* below).

## Part A — 057-8a-1: reception (35c screen, `apps/admin/src/orders`)

Behaviour pinned:

- **One request per click** for all lines refused with `SESSION_DISCOUNT_ABOVE_LIMIT` (DP-03: one `request_id`, one bell).
  Only refused lines are sent; a within-limit line would refuse the whole request (DP-04).
- **Lines** come from the current form values of those rows through the existing `sessionCommandLines` (exported, not
  copied), so the request and the later resend carry the same terms.
- **Header:** saved visit (`result.sessionId`) → `customer_id` + `session_id`, no `occurred_at`; fresh visit →
  `customer_id` + `occurred_at` when the draft has one. `requester_membership_id` = `drafts.recorder_membership_id`.
  `Idempotency-Key` held while the body is unchanged (same pattern as `use-edit-service-line.ts`).
- **Fresh visit:** the response's normalized `occurred_at` is written into the form's `occurred_at` (edge case 23:55/00:05).
- **Draft field:** `SessionDraftLine.discount_proposal` = `{ id } | null`, mapped by `input_index` → local row id.
  The id is always sent while present; the server decides (`FR-019`/`FR-021`: `TERMS_MISMATCH`, `EXPIRED`, …). There is
  no client fingerprint. `recoverAttempt` copies `discount_proposal_id` back from a journaled attempt.
- **Polling:** one `GET …/discount-proposals?request_id=` status query per tracked request; every 5 s while there is no
  data or a `PENDING` item, and every 30 s while an `APPROVED` item exists. Policy lives in
  `model/discount-approval-state.ts`. Each row shows its status; `APPROVED` → decider label + via and the id is attached
  to the draft; `REJECTED` → decider + reason; `EXPIRED` → re-request allowed.
- **Resend** is the existing save/append submit, pressed by the user. No second write path.
- **Refused again** with `approval_refusal` → the card shows the existing `discountApprovalRefusals` label and the
  request button again.
- **Reload (known limitation, manager decision 3):** the `request_id` is held in memory only. A reload already drops the refused drafts (the journal keeps no
  draft lines), so persisting the id would point at nothing; the recorder re-enters the line and requests again.

Files:

| File | Change | Lines |
|---|---|---|
| `model/session-drafts.ts` | `discount_proposal` field + default | +4 |
| `model/use-session-recording.ts` | export `sessionCommandLines`, always emit `discount_proposal_id` when the draft carries a proposal; the server decides `TERMS_MISMATCH` / `EXPIRED` / `CONSUMED` (D-2, D-4) | +6 |
| `model/session-recording-result.ts` | `recoverAttempt` restores the id | +2 |
| `model/discount-approval-request.ts` (new) | build body and map proposals → rows; the client always sends a carried proposal id and the server decides `TERMS_MISMATCH` / `EXPIRED` / `CONSUMED` (D-2, D-4) | ~60 |
| `api/use-request-discount-approval.ts` (new) | POST mutation, held key, parse `requestDiscountApprovalResponse` | ~40 |
| `api/use-discount-approval-status.ts` (new) | GET by `request_id`, 5 s interval while `PENDING`, parse | ~30 |
| `ui/session-discount-approval.tsx` (new) | request button + per-line status | ~80 |
| `ui/session-rejected-lines.tsx` | `approval_refusal` label + mount the section | +8 |

## Part B — 057-8a-2: admin pending list (`apps/admin/src/orders` + `app/`)

Behaviour pinned:

- `GET …/pending` with keyset cursor («more» button), refetch every 30 s (Phase 1 polls, no realtime).
- Card per proposal: service, list/price/discount/net (`formatKwd`), percent (`sessionBpsText`), performers' first
  names, requester label, customer first name, time left from `expires_at`. Never a phone. `EDIT` rows render the
  common fields only (before → after is 057-9b).
- Approve / reject one proposal: `terms_hashes` in id order, `Idempotency-Key`; reject has an optional reason
  (react-hook-form + Zod, ≤ 500). On 409 `DISCOUNT_PROPOSAL_NOT_PENDING` / `DISCOUNT_PROPOSAL_CHANGED` → message +
  refetch. Other codes (`DISCOUNT_APPROVER_LIMIT_TOO_LOW`, `DISCOUNT_APPROVER_IS_REQUESTER`) → `envelopeMessage`.
- **Membership pick (D-11):** on 422 `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` show a select of
  `details.approver_memberships` labelled with `membershipChoiceLabel` from the caller's memberships, then resend.
- **Nav:** item shown when the `/pending` read for the selected branch succeeds (the `AlertRulesNavItem` probe
  pattern); no branch selected → no item. Who sees it is the permission `approve:discounts:branch` (DA-Q1), not a new
  rule.

Files:

| File | Change | Lines |
|---|---|---|
| `api/use-pending-discount-proposals.ts` (new) | infinite query, parse page | ~40 |
| `api/use-decide-discount-proposals.ts` (new) | approve/reject mutation, held key, invalidate | ~45 |
| `pages/discount-approvals-page.tsx` (new) | list, empty, error, more | ~50 |
| `ui/pending-discount-proposal-card.tsx` (new) | fields + actions | ~55 |
| `ui/reject-discount-proposal-form.tsx` (new) | reason form | ~40 |
| `ui/discount-approver-membership-select.tsx` (new) | D-11 pick | ~30 |
| `app/(dashboard)/orders/discount-approvals/page.tsx`, `_frame/discount-approvals-route.tsx`, `_frame/discount-approvals-nav-item.tsx`, `dashboard-navigation.tsx` | route + nav | ~52 |

## i18n (`packages/i18n/src/discount-approval-catalog.ts`, new; registered in `ar.ts` / `en.ts`)

About 34 keys (reception 14, admin 20), ar + en: ~80 lines. Error codes and refusal labels already exist
(`discount-approval-errors.ts`, 057-4a).

## Tests (assert what the user sees, CLAUDE.md §9 / PP-7.2)

| Spec | Covers | Lines |
|---|---|---|
| `model/discount-approval-request.spec.ts` | body for saved/fresh visit, refused lines only, mapping, always carried proposal id with server-side `TERMS_MISMATCH` / `EXPIRED` / `CONSUMED` decisions (D-2, D-4) | ~60 |
| `ui/session-discount-approval.spec.tsx` | request → «في انتظار الموافقة» → approved label → resend body carries the id; rejected reason; expired re-request; refusal label | ~110 |
| `pages/discount-approvals-page.spec.tsx` | card fields (no phone), approve, reject with reason, 409 message + refetch, membership pick, more | ~130 |
| `_frame/discount-approvals-nav-item.spec.tsx` | shown on success, hidden on 403 / no branch | ~30 |

## Sizes (hand-written, incl. tests)

| Category | Part A | Part B | Total |
|---|---|---|---|
| Production | ~230 | ~312 | ~542 |
| i18n | ~36 | ~45 | ~81 |
| Tests | ~170 | ~160 | ~330 |
| **Total** | **~436** | **~517** | **~953** |

The spec's row estimate is 300–420; the plan is about 2.3× that. Recommended: split into **057-8a-1** (Part A) and
**057-8a-2** (Part B). They share only the catalog registration lines in `ar.ts` / `en.ts`, so they can run in
parallel; neither depends on the other at runtime.

## Gates

Typecheck, lint (max-lines 300/400, 60-line functions), `pnpm lint:docs`, `pnpm module-map:check`, the admin
component tests above; heavy suites in CI (PP-113). `clean-code-guard` on production code, `test-guard` on tests.
