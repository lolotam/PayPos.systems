# 45-ui plan — extend dialog and the detail's extension history

Slice: spec 058 §5 row 45 part 3 (FR-071 extension section; FR-040…FR-044 consumed from the admin), PK-Q1 (free: no
money field), PK-Q16 (permission `extend:packages:branch`, two-year cap), PK-Q17 (reception and `read:service-sessions`
holders see the same history), CP-01. Base: branch `feat/p1-058-45-extend-package` (#975, head `82fa47be8`), which
already contains 43-3 (#956) and so the redemption section of the detail query. Migration: none (the history index
`package_extensions_history_idx (company_id, business_id, entitlement_id, extended_at)` is created by migration 0221).

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | The detail query (`apps/api/src/modules/orders/queries/package-entitlement-detail.query.ts`) gains an `extensions` array, one more correlated subselect in the same statement (one snapshot, 43-3's pattern), ordered `extended_at DESC, id` and reading only `package_extensions` for the entitlement. Item: `{ id, previous_expires_on, new_expires_on, extended_at }`. Contract `customerPackageExtension` and `extensions` on `customerPackageDetail` (same `responseObject` strictness). It runs through the existing FR-071 route, so the guard stays the 42-4r `RequireAny`. |
| D2 | **The reason is not in the read.** FR-044 keeps the reason in the extension row only, and the spec does not say the history shows it (CP-01 lists "extensions" without a reason). Showing it to reception is a who-sees-what question: `TODO(spec)`, recorded PENDING in `owner-questions.ar.md` (non-blocking: omission is the safe default and adding a field later is additive). `extended_by` and the membership are omitted for the same reason (a name needs a join the spec does not describe). |
| D3 | Admin dialog `ExtendPackageDialog`: react-hook-form + the contract `extendPackageInput`; fields `new_expires_on` (date input, min = current expiry + 1 day), `reason` (textarea). `expected_expires_on` is snapshotted in form state when the dialog opens (a background refetch never changes it) and changes only through the stale path of D5; it is not editable. The minimum date is calendar-string arithmetic in `model/` (no local-timezone `Date`). No money field (PK-Q1). Client validation mirrors the contract plus a non-empty trimmed reason; the server stays the authority (the 2-year cap and the branch-local today are not recomputed in the browser). |
| D4 | `Idempotency-Key`: one key per attempt (reuse the pattern of `apps/admin/src/settings/staff-app-columns/ui/use-save-attempt-key.ts`). The key is kept while the outcome is unknown: a network error, a 5xx, 401, 408, 429 and 409 `IDEMPOTENCY_KEY_IN_PROGRESS`; it is dropped on success and on a rule refusal (400, 403, 404, 409 `PACKAGE_EXPIRY_STALE`, 422 including `IDEMPOTENCY_KEY_REUSED`, which a changed body would never reach). A changed body mints a new key. The reason is sent trimmed (space, tab, CR, LF), counted in code points. |
| D5 | Errors map to ar/en messages by code: `PACKAGE_EXPIRY_STALE` (409: refetch the detail, take its `expires_on` as the new expected date, mint a new key, reset the minimum, re-validate the chosen date, keep the dialog open; if the refetch fails, block submit), `PACKAGE_EXTENSION_NOT_LATER`, `PACKAGE_EXTENSION_TOO_LONG`, `PACKAGE_EXTENSION_REASON_INVALID`/`VALIDATION_FAILED`, `FORBIDDEN` (403: message and submit disabled), `FEATURE_DISABLED`, `PACKAGE_NOT_FOUND`, a generic fallback. On success the detail and list queries are invalidated and the history shows the new row. |
| D6 | **Who sees the button.** No capability read exists for `extend:packages:branch` and the customer packages screen (42-4 part 1) is not built, so the only detail host is `PackageRedemptionHistory` inside reception's picker. The history section (read-only) is rendered there for everyone. The extend button is rendered only when the host passes `canExtend` (default `false`); this slice passes nothing, so the dialog is exported and tested but not reachable from reception's picker. The 42-4 screen decides `canExtend` once it has a capability source. Open question for the manager (see report). |
| D7 | No server change: #975's route, use case, contract and permission are used as they are. The generated admin client (`schema.d.ts`) already has the POST path from #975; it is regenerated only for the new `extensions` field. |

## 2. Layers in CLAUDE.md §1 order

| Layer | File(s) | Lane | Est. lines |
| --- | --- | --- | --- |
| Contract | `packages/contracts/src/orders/customer-packages.ts` (`customerPackageExtension`, `extensions` field, schema list), openapi name registry, regenerated `openapi.json` and the three `schema.d.ts` (generated, not counted) | Kimi | ~25 |
| Query | `package-entitlement-detail.query.ts`: `extensionProjection()` and the `'extensions'` key | Kimi | ~25 |
| i18n | ar/en keys for the section, dialog, errors (a new `catalog-package-extension.ts` next to `catalog-package-types.ts`, wired the same way) | Kimi | ~60 |
| Admin hook | `apps/admin/src/orders/api/use-extend-package.ts` (POST with `Idempotency-Key`, invalidates detail and list) | Kimi | ~70 |
| Admin model | `apps/admin/src/orders/model/extend-package-values.ts` (form values, resolver, body builder, error-to-message map) | Kimi | ~60 |
| Admin UI | `ui/extend-package-dialog.tsx`, `ui/extend-package-form.tsx`, `ui/package-extension-history.tsx`; `package-redemption-history.tsx` renders the history section and the optional button | Kimi | ~190 |
| Tests | query shape + isolation + EXPLAIN (~130), contract spec + schema-name registry (~40), hook spec (~130), values spec (~80), history spec (~70), dialog specs (two files, ~250), redemption-history spec additions (~40) | Agy | ~740 |
| Docs | this plan, the debate file, `owner-questions.ar.md` entry (PENDING), brief receipts | me | n/a |

Production estimate ~430 lines (excluding generated files); tests ~740 (re-estimated on 2026-11-12 before any test was written, after the debate added the stale-CAS, key-keeping, double-submit and tie-break cases). A delivery above twice its category
estimate (production 860, tests 1480) is refused (§14).

## 3. Tests required

* Query (private cluster, CI decides the rest): result-shape of `extensions` (empty array when none, newest first,
  keys exactly the four, no `reason`, no membership, no amount), cross-tenant isolation (another company's extension of
  an entitlement with the same id never appears), `EXPLAIN` asserting `package_extensions_history_idx` is used for the
  subselect (existing `EXPLAIN` helper of this file), the 43-3 redemption section unchanged.
* Contract spec: the item parses, an extra key (`reason`) is rejected by the strict response object, the detail parses
  with `extensions: []`.
* Component tests assert what the user sees (CLAUDE.md §9): the history lists the dated rows newest first and the
  empty state; the dialog shows no money field; an empty or 501-code-point reason shows a message and sends nothing;
  success closes, shows the new row and the new date; 409 stale shows the stale message and the new current date in
  the form; 422 not-later and too-long show their messages; 403 shows the forbidden message; a network error then
  retry resends the same `Idempotency-Key` and a changed value mints a new one; double submit sends one request; the
  button is absent when `canExtend` is not passed.
* Hook spec: path, headers (`x-company-id`, `Idempotency-Key`), body keys exactly the three, status 201 parsed with
  `packageExtensionResponse`.

## 4. Risks and non-goals

* No server write change, no migration, no permission change, no event (TD-7), no reason in any read (D2).
* The dialog is not reachable from a production screen until 42-4's customer packages screen lands (D6): intended.
* Files shared with other sessions: none of the do-not-touch areas (50-3, 68-2b-2, 32b-cat-2). `package-redemption-history.tsx`
  and the detail query file are 43-3's; 46-3 will add its own section after this one.
