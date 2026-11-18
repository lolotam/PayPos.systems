# Plan — row 42-4 (remaining): package sale picker and sale form (FR-072, SA-12)

Spec: [spec.md](spec.md) FR-072, FR-019b, FR-010, FR-018c, SA-12, SA-11, PK-Q13, PP-170; row table §7 (42-4).
Branch `feat/p1-058-42-picker` from `origin/main` `5488b1f30` (after #1052, the status route).
PP-192 applies if the manager confirms (Q1): no migration, no new permission, no new money rule (the discount limit,
conservation and refusals are server-side and already merged in 42-3b1/42-3b2); one PR holds the read and its screen.

## What is already on `main`

- Sale: `POST …/branches/{branchId}/package-sales` (202 `{ sale_request_id }`) and `GET …/package-sales/{saleRequestId}`
  (pending / completed with entitlement / failed with a catalogue code), contract `sellPackageInput`, `packageSaleStatus`.
- `selling_stopped_at` on package types (33b), the type's `revision`, and each service's `revision` and list price.
- Customer package reads (42-4r) and hooks `use-customer-packages`, `use-customer-package-detail`.
- Admin reception pieces to reuse: `session-customer-field`, `session-performers-field` / `use-session-performers`,
  `session-recording-header` (branch and recorder context), `use-recording-context`.

## Scope

In:
1. FR-072 read: `GET /v1/businesses/{businessId}/branches/{branchId}/sellable-package-types`, guard
   `@Require('sell:packages:branch', { branch: 'branchId' })` + `@RequiresFeature('orders')`, never
   `read:package-types:business`. Catalog-owned `queries/` file, keyset cursor on `id`, `selling_stopped_at IS NULL`
   only, each type with `id`, `revision`, names, `price`, `validity_days` and components `{ service_id,
   service_revision, name_en, name_ar, sessions, list_price }` (the quote the sale sends back, FR-010/FR-018c).
2. Zod contracts, OpenAPI path, generated admin/pos/menu `schema.d.ts`.
3. Admin hooks: sellable types (infinite or paged), sell package (generates the `Idempotency-Key`), sale status poll.
4. The reception sale screen: customer, package type (shows price, validity, components), price paid (prefilled with the
   list price, editable; no discount computed in the UI, the server's `discount` is shown after completion), payment method CASH or CARD, seller employee; submit shows the request as
   pending, polls the status until completed (summary of the entitlement) or failed (the bilingual message and details);
   ar/en keys; component tests that assert what the user sees (CLAUDE.md §9).

Out: the customer packages list screen (42-4 item 1; hooks exist, no screen yet; a later row, decided 2026-11-14);
the `sold_at` field (the form omits it and the server default, now, applies; a backdated sale needs an owner question
before any UI exposes it, decided 2026-11-14);
the POS sale; any history section; any migration (assumption below); refund, extension, redemption.

## Money rules for the UI (PP-192 conditions)

No arithmetic in the UI. Any total, discount or remaining amount shown comes from the server response or from
`packages/domain`; the amount input converts to mills with the existing shared helpers (`normalizeKwdInput` from
`@pospay/i18n`, `parseMoney` and `moneyToString` from `@pospay/domain`), never floats.

## Decisions

- **D1 path and ownership.** The route sits under the branch prefix like the sale, so one `{ branch: 'branchId' }`
  target serves the guard (a branch or business outside the caller's grant is refused 403 first, as in 42-3b2b). The
  `queries/` file and controller live in `catalog` (it owns `package_types`); the guard stays the generic access guard;
  no new module-map arrow (the catalog already reads `package_types`, `package_type_components` and `services`).
- **D2 no migration.** Same policy as 42-4r: the read filters `(company_id, business_id)` and orders by the primary key
  `(company_id, id)` with a cursor; the EXPLAIN test follows the repo pattern for catalog readers. If it needs another
  index, the session stops and goes to the manager, never a migration added on its own.
- **D3 shape.** `list_price` and `price` are strings (mills), as in the type detail; component order is `position`.
- **D4 polling (UI).** One status read every 1 s while pending, stop at 60 s with a «still processing» state and a retry
  button that only re-reads, never re-sends the sale; the `Idempotency-Key` is generated once per submit attempt and kept
  for a retry of the same form state (PP-170).
- **D5 screen.** New route `/orders/package-sales/new` under the dashboard orders group, thin `app/` re-export, feature
  folder `apps/admin/src/orders/` (CLAUDE.md §7), reused customer and seller fields, no new component library.

## Sizes (hand-written, no generated files)

| Category | Files | Lines |
|---|---|---|
| contracts (Zod + OpenAPI path) | `catalog/sellable-package-type.ts`, `catalog-openapi.ts`, index export | ~95 |
| api read (query + controller + module wiring) | `sellable-package-types.query.ts`, `sellable-package-types.controller.ts`, module | ~120 |
| admin hooks | `use-sellable-package-types.ts`, `use-sell-package.ts`, `use-package-sale-status.ts` | ~170 |
| admin UI (form, fields, result, route) | `package-sale-form.tsx` + 3 field/result parts, route page | ~400 |
| i18n ar/en | `packages/i18n/src/...` | ~70 |
| **Production total** | | **~855** |
| tests | contract spec ~50, query shape + EXPLAIN ~110, HTTP/SA-12 ~140, hooks ~120, form component ~200 | ~620 |
| generated | `openapi.json`, three `schema.d.ts` | not counted |

Within PP-192's 600-900 band; the brief stays under 400 lines (one brief for api + contracts, one for admin hooks + UI,
one for tests).

## Lanes and fences (PP-186, same as 42-3b2b)

Kimi k3.1-pro CLI for production (api + contracts brief, then admin brief); Agy `gemini-3.8-flash-high` for tests, both
written with edit-only fences (no shell, no git, no .env, no stash). I review every diff, run the gates and both guard
skills fully (test-guard, clean-code-guard), run the specs on a private lane, regenerate OpenAPI and the three
`schema.d.ts`, push once after the panel and CI results, and request no review.

## Tests

- Contract: page, item, strictness, string money, component quote fields.
- Query (real Postgres): result shape, stopped type absent, another business's type absent, cursor continuity, EXPLAIN
  index assertion.
- HTTP: SA-12 (default cashier and branch manager lack `read:package-types:business` and still load the picker), SA-11
  (no `sell:packages:branch`, device, orders feature off: 403 / `FEATURE_DISABLED`), another branch or business outside the
  grant: 403.
- Admin (CLAUDE.md §9, visible outcomes): form shows pending then the completed summary; failed shows the message and
  details; the 60 s «still processing» state; a stopped type is not offered; the completed summary shows the server's
  `price_paid`, `discount` and `expires_on`; the sale is not re-sent on a status retry.

## Decisions recorded 2026-11-14

Q1: PP-192 applies, one PR. Q2: the customer packages list screen goes to a later row. Q3: no `sold_at` field now.

## Owner scope decision — round-1 repair, 2026-11-17

Source: `r1-repair-owner-authority.md` in the continuation packet, recording Waleed's direct answer in manager thread `dfb4c927-5b17-4231-b0c8-34274c1edb05`.

Question verbatim:
«42 picker: إصلاح أسعار المكونات نجح، لكن بقيت عوائق مؤكدة في صلاحيات اختيار الزبونة والبائعة وعضوية التسجيل. الإنتاج الآن 888/900، والمتبقي 12 سطرًا فقط. أعددت نطاق إصلاح محدد: نفس المهمة، سقف إنتاج1350 وdocs160، وإضافة17مسارًا محددًا؛ التقدير النهائي1208–1328 وليس إثباتfit. هل تعتمد التوسعة لإصلاح الملاحظات المتبقية، أم تفضّل تسليم prerequisite منفصل قبل استكمال picker؟ بوابات المراجعة والاختبارات والجولات باقية، وPR1069 مستقل.»

Options presented:
1. «اعتمد التوسعة المحددة إلى1350 (الموصى به)»
2. «جهّز prerequisite منفصل أولًا»

Recommendation: option 1, retaining this task and repairing the confirmed findings inside the bounded extension.

Owner answer verbatim: «اعتمد التوسعة المحددة إلى1350 (الموصى به)».

Effect: production 1350 ALL and documentation 160 ALL; the existing 35 paths plus only the 17 listed in `r1-repair-scope-proposal.md`. Tests and generated files retain separate accounting and full coverage. R1-02 stays fixed; the other eight confirmed findings are repaired without a task/review-counter reset. The parent applies, regenerates, mechanically recounts and verifies the candidate before R2 delta-only review.

## Post-preparation reconciliation — 2026-11-18

The authorized continuation rebases the same repair candidate onto merged prerequisite main `c2748c76a7f2c973f989c471e20a02773f0e228f` (PR #1072). The production ceiling is 1550 ALL after that preparation; documentation remains 160 ALL and the exact 52-path scope is unchanged. The new orders provider/query factory files and the live performer delegates are preserved. The candidate changes only the authorized composition root to register the package-sale context handler, and reapplies scoped customer entry onto the prepared admin selection implementation. The parent still owns generated OpenAPI/clients, real suites, R2 review and exact-head CI.

## Generated module map approval (2026-11-18)

Question: "Do you approve adding `docs/module-map.yaml` as the sole 53rd path?"
Recommendation: "I recommend approval so the checked-in map matches its source."
Owner answer: "yes". The added path contains the four generated read declarations.

## Seller refresh repair scope

Waleed approved raising the production ceiling from 1550 to 1623 for the seller refresh repair only.
Owner answer: ?????? ???? ????? ??? 1623?.

## Customer entry authority

Owner answer: "موافق", approving the proposed 1743-line production ceiling for the customer-entry repair.
The context returns the narrowest route allowed by the existing customer authorizer, or null.
