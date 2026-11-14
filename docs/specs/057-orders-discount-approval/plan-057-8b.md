# Plan 057-8b — approval screen on the paired reception computer

Spec: `spec.md` §7 row 057-8b (Story 2, DP-08…DP-12; D-9, D-10, D-11, D-15; FR-015, FR-016, FR-018, FR-023).
Backend, contracts and OpenAPI are on main (057-7, #1002): `GET /v1/devices/me/discount-proposals`,
`POST /v1/devices/me/discount-proposals/approve|reject`, all present in `apps/pos/src/shared/api/schema.d.ts`.
No backend gap found; this PR adds no API, contract or migration code.

## Manager decisions (2026-11-15, technical)

1. **Plan approved:** a plain async decide call (no `useMutation`, so phone and PIN never reach the query cache),
   outcome mapping by envelope code, a separate i18n catalog.
2. **Split.** **057-8b-1** (this PR, ~540): the list, approve/reject, and the wrong-PIN, lock, busy and 409 messages.
   **057-8b-2** (after 8b-1 merges, fresh branch from main): the DP-09b membership pick. Interim behaviour: an approver
   with two eligible memberships sees the server's localized `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` refusal on the
   device and can approve remotely from the admin app.
3. **Lock message limit (D-15):** one message covers both locks, because the server answers the same 423
   `PIN_LOCKED` for the per-holder lock and the device-wide cap. No backend change.
4. **`shared/api/call.ts`:** additive `details` only, shipped in 8b-1; every POS test is run locally before the push.

## Readings and pinned behaviour

- **Pairing (item 1).** The reception computer opens the POS PWA in its browser. The existing flow (`DeviceScreen` →
  `PairingScreen` → manager approval → `ReceptionBody`) already renders at desktop width (`BrandedPanel` centred,
  `max-w-lg`). The pairing flow is **unchanged**. "Desktop layout" applies to the new approval section: it spans the
  full width of `ReceptionBody`'s `lg:grid-cols-2` grid (`lg:col-span-2`), with the cards in a responsive grid.
- **Who sees the list.** Every active paired device of the branch, before any PIN (D-9, DA-Q8 = PP-15.3). The list uses
  the device credential only (`apiClient()`, `Authorization: Device …`, `credentials: 'omit'`), never an admin or staff
  cookie (DP-08b).
- **List (DP-08, FR-016).** `useInfiniteQuery` over the device route, parsed with `deviceDiscountProposalList`;
  refetch every 30 s (Phase 1 polls), «more» button on `next_cursor`. Card: service name (ar → en fallback), list,
  price, discount, net (money strings as served, no arithmetic), percent from `effective_bps` (display formatter), the
  requester's and customer's first names, time left from `expires_at` (hours + minutes formatter; the existing
  `formatRemainingMinutes` is minutes-only with session wording). Never a phone. `EDIT` rows show the common fields
  only (before → after is 057-9b).
- **List rejection.** Only the list route's `UNAUTHENTICATED` / `FORBIDDEN` calls the device `retry` (as
  `AttendanceHome` does). Decide outcomes never re-probe the device.
- **Decide (DP-09, D-12).** One proposal per decision: `proposal_ids: [id]`, `terms_hashes: [terms_hash]`. Form =
  phone + PIN (react-hook-form + `zodResolver(staffPinInput)` from contracts) and an optional reject reason (≤ 500,
  server-validated; `DISCOUNT_REJECT_REASON_INVALID` shows the server message). No Idempotency-Key (the route takes
  none; a retry of a decided proposal answers 409).
- **PIN in memory only (ADR-0019, FR-023).** The decide call is a plain async call with local state (the
  `use-pin-form.ts` pattern), **not** `useMutation`, so phone and PIN never sit in the mutation cache. The PIN field is
  reset after every attempt. For DP-09b the submitted `{ phone, pin }` is held in a ref for **one** retry only and
  cleared on settle, cancel, unmount and change of the selected proposal. Nothing is written to IndexedDB, storage or
  the query cache.
- **Membership pick (DP-09b, D-11).** On 422 `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` the screen reads
  `details.approver_memberships` (hand-written guard, as admin does) and shows a select. The device has no user
  session, so a label is `roleName(code, name_ar ?? name_en)` + a scope-type label (company / business / branch); an
  unreadable entry falls back to «عضوية {n}». Choosing resends once with `approver_membership_id` and the held PIN.
- **Outcome mapping by envelope code, not status:** `PIN_INVALID` → wrong-PIN message; `PIN_LOCKED` → the lock
  message; `TOO_MANY_REQUESTS` → busy message; `DISCOUNT_PROPOSAL_NOT_PENDING` / `DISCOUNT_PROPOSAL_CHANGED` → server
  message + list refetch; `DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` with readable details → pick; anything else (incl.
  `DISCOUNT_APPROVER_LIMIT_TOO_LOW`, `DISCOUNT_APPROVER_IS_REQUESTER`, `FORBIDDEN`) → the server's localized
  message. Success → «اتوافق» / «اترفض» + list refetch.
- **Lock message (D-15) — stated limitation.** The backend answers the same 423 `PIN_LOCKED` for the per-holder lock
  and the device-wide cap, so the screen shows one message covering both (PIN approval paused for 15 minutes after
  many wrong attempts; approve from the admin app meanwhile). Distinct wording would need a backend change, out of
  scope for this PR.
- **Online-only (ADR-0019).** Offline → the form is disabled with an offline line; no queue, no auto-retry.
- **Shared change.** `shared/api/call.ts` `ErrorEnvelope` gains an additive `details?: unknown` (set only when the body
  has it); existing `toEqual` asserts stay valid.

## Files (`apps/pos/src/discount-approval/{api,model,ui}`, new business area, CLAUDE.architecture.md §11.1)

| File | Change | Lines |
|---|---|---|
| `shared/api/call.ts` | carry `details` in the envelope | +4 |
| `discount-approval/api/device-discount-calls.ts` (new) | list read + approve/reject call (`apiClient()` + `call`) | ~30 |
| `discount-approval/api/use-device-discount-proposals.ts` (new) | infinite query, 30 s refetch, parse, list-rejection → `retry` | ~35 |
| `discount-approval/api/use-pin-decision.ts` (new) | plain async decide, held PIN for one membership retry, outcome state, refetch | ~50 |
| `discount-approval/model/pin-decision-outcome.ts` (new) | `Failure` → outcome by code; read membership details | ~45 |
| `discount-approval/model/proposal-display.ts` (new) | percent text, time-left parts, membership label | ~30 |
| `discount-approval/ui/device-discount-approvals.tsx` (new) | section: title, list, empty, error + retry, more | ~55 |
| `discount-approval/ui/device-proposal-card.tsx` (new) | fields + «اختيار» | ~40 |
| `discount-approval/ui/pin-decision-form.tsx` (new) | phone, PIN, reason, approve/reject, outcome lines, offline | ~60 |
| `discount-approval/ui/approver-membership-select.tsx` (new) | DP-09b pick | ~30 |
| `app/reception-body.tsx` | mount the section (`lg:col-span-2`) | +3 |

## i18n (`packages/i18n/src/device-discount-approval-catalog.ts`, new section `deviceDiscountApproval`, registered in `catalog.ts`)

About 36 keys ar + en (title, lead, empty, loadError, retry, more, field labels ×9, timeLeft, choose, phone, pin,
reason, approve, reject, cancel, deciding, approvedDone, rejectedDone, pinInvalid, locked, busy, offline,
membershipTitle, membershipN, scope labels ×3): ~80 lines + ~6 registration lines. `en.ts` / `ar.ts` are not touched
(397–400 lines against max-lines 400).

## Tests (assert what the user sees, CLAUDE.md §9 / PP-7.2)

| Spec | Covers | Lines |
|---|---|---|
| `discount-approval/ui/device-discount-approvals.spec.tsx` | card fields and no phone; empty; load error + retry; more; approve → «اتوافق» + refetch; reject with reason; wrong PIN; lock message on 423; busy; 409 message + refetch; DP-09b pick → resend carries `approver_membership_id` and the same PIN, PIN field cleared; offline disables the form | ~170 |
| `discount-approval/model/pin-decision-outcome.spec.ts` | mapping per code, malformed details → message | ~45 |
| `discount-approval/model/proposal-display.spec.ts` | percent, time left, membership labels incl. custom role and fallback | ~30 |
| `shared/api/call.spec.ts` | `details` carried when present | +12 |
| `app/reception-body.spec.tsx` | the approvals section is mounted | +10 |

## Sizes (hand-written, incl. tests)

| Category | Lines |
|---|---|
| Production | ~380 |
| i18n | ~86 |
| Tests | ~265 |
| **Total** | **~730** |

The spec's row estimate is 260–380; the plan is about 1.9× its upper bound (057-8a was 2.3× and was split).
Split (manager decision 2):

- **057-8b-1** — list on the reception computer + phone/PIN approve and reject + wrong-PIN / lock / busy / 409
  messages (everything except the pick): ~540.
- **057-8b-2** — DP-09b membership pick (outcome reader, select, one-retry PIN hold) + its tests: ~190.

Until 057-8b-2 lands, an approver with two eligible memberships gets the server's localized
`DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED` message on the device and can still approve remotely from the admin app.

## Overlap

Open PR #1034 (057-8a-1c) touches only `apps/admin/src/orders/model`; this plan touches none of it. No open 057-8a-2
PR exists, so the new i18n file has no conflict.

## Gates

Typecheck, lint (max-lines 300/400, 60-line functions), `pnpm lint:docs`, `pnpm module-map:check`, the pos component
tests above; heavy suites in CI (PP-113). `clean-code-guard` on production code, `test-guard` on tests.

## Implementers (PP-186)

Production + i18n: Kimi CLI (k3.1-pro) → Grok (grok-4.7-build-fast) → MiniMax-M3.1-Flash (opencode). Tests: Agy
(gemini-3.8-flash-high), Kimi if Agy has no capacity (PP-175.2). Every run fenced (`.env*` stashed out, HEAD / stash
list / status snapshots, no git, no network).
