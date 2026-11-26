# Row 61 — «تنبيه التقييم المنخفض والمتوسطات»: implementation plan (61-1, 61-2, 61-3)

> **Status: PLAN ONLY (PP-204).** No production code, test, migration, ADR, module-map or spec edit is made by this
> document. Base: `origin/main` on 2026-11-20 (journal tail `0233`). Row 61 is **not merged**: the only merged work is
> the A-1 documentation PR #895 (`plan-61-1.md`, `61-1-planning-evidence.md`, ADR-0010 A-1 addendum, module-map rows).
>
> **Relation to `plan-61-1.md`.** That file and its evidence stay intact as history. This plan **keeps** its §3
> (transport B: a typed `details` parameter, two template keys), §3.5 (field trace), §3.8 (recipient partition) and §7.2
> (T is a hard code floor). It **proposes to supersede** its §4 (U3), §5 (U2), §6 (API ports and readers) and the
> P1/A1/T/K/E candidate split with the split in §4 below, together with spec 060 **D-B9**'s clause «append
> `LowRatingReceived` … and the alert is on — all in one transaction» and FR-B13's emitter wording. The proposal in §2 is an architectural change and is
> **not self-approved**: the manager decisions of record (evidence §E0.1, §E13) keep the emitter blocked until a
> reviewable plan «تعالج الحمل ضمن العقد أو تعرض تغييرًا معماريًا محددًا». §2 is that specific change; §3 lists what the
> manager must accept before any sub-PR after 61-1b starts.

## 1. What row 61 delivers (spec 060 Story B4)

| Spec | Behaviour |
|---|---|
| RT-22, FR-B13 | A 1- or 2-star rating with the `LOW_RATING` rule on emits `LowRatingReceived`; 3+ stars or the rule off emits nothing. Recipients and channel come from the rule (default RT-Q8: on, in-app, the four managers in the visit branch's scope) |
| RT-23, RT-Q9 | The notice shows stars, branch, date, performers' first names, the customer's name and last 3 phone digits; the comment only in-app and only for comment readers (BR-B4); never the token |
| RT-24, FR-B14 | Staff summary `GET /v1/staff/me/rating-summary`: average and count for the current calendar month (RT-Q6a), shown from the first rating (PP-18.15) |
| RT-25, FR-B15 | Admin ratings list and per-employee averages behind the new permission `read:ratings:branch` (RT-Q7), comments for every holder (RT-Q7b); grant refused for a non-manager membership |
| 61-3, D-A7 | `rating_average` stops being a postponed staff column and the «شغلي» card shows the summary |

Source facts this plan relies on (verified on the base):

- `submit-rating.usecase.ts:65` holds the `TODO(spec)` for 61-1; `consumeAndRate` returns only a boolean; the rating
  transaction runs under `RATING_TRANSACTION_TIMEOUT_MS = 1_000` on an unauthenticated public route.
- `LOW_RATING` exists only in comments. The kind list lives in three places (`packages/domain/src/alert-rules.ts`,
  `packages/contracts/src/settings/alert-rules.ts`, `packages/db/schema/settings.ts` `ALERT_KINDS_SQL`) and in the DB
  CHECK `alert_rules_kind` (created 0165, widened by 0219). Adding a kind **needs a migration**.
- `read:ratings:branch` exists nowhere in code. Precedent for a new permission: #510 (migration 0167, catalog, role
  defaults, `system-role-policy.ts`, i18n permission names).
- The worker notifications handler already lists `LowRatingReceived` in `NOTIFICATION_SOURCE_EVENTS`, i.e. it expects
  that event to carry a `notificationRequest` payload.
- The 62-3 bells are composed in the **worker**: a consumer of a domain event reads the rule (`settings.alertRule`),
  the recipients (`identity.branchManagerRecipients`), claims a ledger row (`late_service_session_notices`) and
  appends the notice request. The 057-3b-1 PR (#937) shipped «ledger + alert kind» as one database PR.
- The module-map import table is shared by API and worker: `customers: [tenancy, settings, staff, identity]`. Worker
  `customers` already reads `staff.readEmployeeDisplayNames`, `tenancy.businessNames` and
  `tenancy.branchScheduleHours`.
- No «شغلي» screen exists in `apps/pos`; 57-2b and 57-4 are not merged. `rating_average` is stripped by
  `POSTPONED_COLUMNS` in `apps/api/src/modules/settings/domain/staff-columns.ts`.

## 2. Proposed architectural change: the notice is composed in the worker

### 2.1 The change

1. **API (public rating transaction).** When the consumed rating has `stars <= 2`, the same transaction appends ONE
   small internal event `LowRatingSubmitted` (customers API ⇒ worker customers):
   `{ schema_version: 1, rating_id, request_id, business_id, branch_id, stars }`, aggregate `rating` / `rating_id`.
   Nothing else is added to that transaction: no rule read, no identity, staff or tenancy read, no names, no comment.
2. **Worker `customers`.** A new outbox consumer handles `LowRatingSubmitted` with the use case
   `request-low-rating-notice`, in one tenant transaction, the same shape as
   `orders/use-cases/request-late-service-session-notice`:
   verify the event against the stored rating → company open → rule → recipients → place → claim the ledger →
   comment readers (only for a non-null comment) → names → compose → append `LowRatingReceived`
   (customers ⇒ notifications, a `notificationRequest` payload in groups of at most 100 recipients, ADR-0037 §5).
3. `LowRatingReceived` keeps its ADR-0010 meaning and name; only its emitter moves from the API module to the worker
   module of `customers`.

### 2.2 Why (the two open blockers of `plan-61-1.md`)

| Blocker | In-transaction design (plan-61-1) | This proposal |
|---|---|---|
| **U2** load in the 1000 ms public transaction | P + 15 statements and a payload that grows with P·R, triggered by an anonymous request | The public transaction gains **one fixed-size outbox insert** (about 300 bytes). Its cost no longer depends on performers or recipients |
| **U4** emission-time authorization | Decision instant, clock and writer coordination unselected inside the rating transaction | The decision instant is the worker's `decidedAt = clock.now()`, read once in the consumer transaction, exactly as the 62-3 bells decide their recipients |
| **U3** validation boundary | A parse closure injected from the customers composition root | Not needed: the worker outbox adapter parses the payload with the contracts schema, as `late-service-session-notice.repository.ts` does |

**What is still not bounded (stated, not hidden).** Performers (P) and role holders (R) have no source cap, and the
`LowRatingReceived` payload still repeats the details per recipient, so the worker transaction grows with P·R. It runs
under the worker delivery limit (`DELIVERY_TIMEOUT_MS = 60_000`), not the public 1000 ms one. A delivery that exceeds
it rolls back, is retried by the dispatcher and is finally parked, where an operator sees it. The customer's rating is
already committed and is never rolled back by the notice. No cap, truncation, chunking of names or timeout change is
proposed.

### 2.3 What the change costs

- **BR-B4 «checked at emission»** now means: checked when the worker emits `LowRatingReceived`, normally seconds after
  the rating. A permission revoked between the rating and the delivery is honoured (stricter); one granted in between
  is honoured too. The check is one statement snapshot; a revoke that commits after it does not retract a stored
  notice. This is the same property every stored notice has today. **Needs manager acceptance (§3).**
- **BR-B5 / RT-22 «the alert off emits nothing»** is judged at delivery time, not at the rating instant.
- **Two outbox hops** (rating → worker customers → notifications) before the bell. SC-004 allows 2 minutes; the
  orders bells already take two hops. The staging verification of 61-1i measures it once and records the number.
- **A ledger is required.** Inbox uniqueness is `(company_id, source_event_id, recipient_user_id, template_key)` and
  each redelivery would mint new notice event ids, so a redelivery after a permission change could give one manager both
  `low_rating` and `low_rating_with_comment`. The table `low_rating_notices`, unique on `(company_id, rating_id)`,
  makes the decision once (§5, 61-1d).
- **A-1 is partly withdrawn.** The API ports `RatingAlertRecipientsPort`, `PerformerNamePort` (API) and
  `LowRatingNoticePlacePort`, the API reader `readRatingCommentReaders`, API `staff.readEmployeeDisplayNames` and the
  five `# Planned E:` lines were declared but never built. 61-1a replaces them with worker rows. The import arrow
  `customers → identity` stays: the worker reader and 61-2's API readers use it.

### 2.4 New ports, reads and events (all need the ADR addendum of 61-1a)

No new **import arrow**: `customers → tenancy, settings, staff, identity` is already declared. New port rows, `reads`
lines and one event row, **flagged as requiring an ADR-0010 addendum (A-2)**:

| Kind | Declaration |
|---|---|
| Event | `LowRatingSubmitted`: API `customers` ⇒ worker `customers` (new row in module-map §4 and ADR-0010's event table) |
| Event | `LowRatingReceived`: emitter is worker `customers` (row text changes; consumer unchanged) |
| Port, worker customers → worker settings | `AlertRulePort.rule` → `settings.alertRule` |
| Port, worker customers → worker identity | `LowRatingRecipientsPort.managers` → `identity.branchManagerRecipients`; `.commentReaders` → new `identity.ratingCommentReaders` |
| Port, worker customers → worker tenancy | `LowRatingPlacePort.forBranch` → `tenancy.branchPlace`; `.companyOpen` → `tenancy.companyOpen` |
| Port, worker customers → worker staff | existing `PerformerNamePort` → `staff.readEmployeeDisplayNames` (already declared) |
| Port, API customers → API identity (61-2) | `OwnRatingsAccessPort` → new `identity.readOwnRatingsAccess`; `RatingsReadAccessPort` → new `identity.readRatingsReadAccess` |
| Port, API customers → API staff (61-2a) | `OwnEmployeePort` → existing `staff.readOwnEmployee` |
| Port, API customers → API tenancy (61-2) | business time zone and workspace tree through existing `activeBusinessTimeZone`, `describeWorkspaces` |

## 3. Decisions

### 3.1 Needs the manager's acceptance (technical; not for the decisions page)

| # | Decision proposed | Blocks |
|---|---|---|
| M1 | §2: compose the notice in the worker; supersede plan-61-1 §4–§6, spec D-B9's «append `LowRatingReceived` in the rating transaction when the alert is on», FR-B13's emitter wording and the A-1 API ports | 61-1a and everything after 61-1c |
| M2 | BR-B4, BR-B5 and D-B15 («a rule change applies to events emitted after it commits») are evaluated at the worker's decision instant (§2.3) | 61-1g, 61-1h |
| M3 | P1 ships as guard (61-1b) then seed (61-1c); proof of «guard deployed» is the staging deploy receipt with the API image SHA, since staging runs one `api` container replaced as a whole | 61-1c |
| M4 | Two migrations (61-1c, 61-1d) may be generated when their turn in the migration lane comes (PP-124, PP-130) | 61-1c, 61-1d |

**Decisions (2026-11-20 14:35 Kuwait, PP-207):** M1 accepted by Waleed («في الـ worker (المقترح)», PP-207.2). M2 accepted by Waleed («لحظة قرار الـ worker (المقترح)», PP-207.3). M3 and M4 accepted by the manager (PP-124, PP-130; PP-207.4). RT-Q17 answered by Waleed: the note is shown as written (PP-207.1, batch 98).

### 3.2 Technical choices made here (recorded, reversible in review)

| # | Choice | Reason |
|---|---|---|
| T1 | Transport B of plan-61-1 §3.3 and its two template keys `low_rating`, `low_rating_with_comment` (revision 1) | Already selected by the manager as design |
| T2 | The API emits `LowRatingSubmitted` on `stars <= 2` only, by a pure predicate `isLowRating(stars)` in `customers/domain` | One rule, unit-tested; 3+ stars cost nothing |
| T3 | Notice rows are stored with locale `ar`; the admin renders in the viewer's locale | Same as every staff bell |
| T4 | The grant refusal is a new error `PERMISSION_ROLE_NOT_ELIGIBLE` → **422** (ar/en messages) | Spec FR-B15 asks for a named 422; the existing `PERMISSION_ROLE_FORBIDDEN` maps to 403 and means something else |
| T5 | `rating-summary` answers a discriminated body `{ visibility: 'HIDDEN' }` or `{ visibility: 'VISIBLE', average, count }`, like the own-tips route of 57-2a | The route can ship before 61-3 lifts the column and never leaks whether ratings exist |
| T6 | `average` is a string with one decimal (`"4.5"`), rounded half up **in SQL**; `null` with `count: 0` | D-B12 fixes «rounded half up to one decimal»; `queries/` may not import `domain/`; no float crosses the wire |
| T10 | The staff window of D-B12 («the current calendar month in the business timezone») is applied to `rating_attributions.submitted_at` | D-B12 computes the average from `rating_attributions`, whose only timestamp is `submitted_at`, indexed `(company_id, employee_id, submitted_at)` by 60-1 for this read. Not an owner question |
| T7 | Admin averages are a separate route `GET /v1/businesses/:businessId/ratings/averages` with the filters `branch_id`, `from`, `to`, `employee_id` or `month`; `cursor` and `limit` belong to the paginated ratings list only | One use case per PR; the list's keyset page and the aggregate have different plans |
| T8 | The two admin routes and the staff route are `@Authenticated()` reads that check access inside their own single transaction | The decision depends on the caller's role and scope (CLAUDE.md §6); one transaction per request (connection budget) |
| T9 | 61-3 stays one PR and waits for 57-4 | Offering `rating_average` in the columns screen before any screen shows it would be a switch that changes nothing |

### 3.3 Owner question — PENDING (recorded in `owner-questions.ar.md`, item 33)

| Id | Question | Recommendation | Stops |
|---|---|---|---|
| **RT-Q17** | A customer's comment that contains a phone number: do managers see it as written? (plan-61-1 §3.6, S-12 vs RT-Q9) | Show the comment as written, to comment readers only | The comment mapping of **61-1h** (`TODO(spec)`), and the comment column of 61-2b |

It is a feature question (who sees what) and it sits on 59b-3's critical path through 61-1h. This session publishes
nothing and contacts no owner; the manager routes it. Under CLAUDE.md §1 5b, 61-1h may start on Waleed's pick alone;
Abu Salem's later pick binds if it differs.

## 4. Sub-PR split

Sizes are **production + test lines** the implementer writes; generated output (OpenAPI, client `schema.d.ts`,
migration snapshot and journal, `module-map.yaml`) is extra and is counted in each brief. Every sub-PR runs the local
gates of CLAUDE.md §1 step 3 and is reported «implementation complete, pending `ci-gate`».

| # | Sub-PR | Depends on | Migration | Est. lines |
|---|---|---|---|---|
| **61-1a** | Docs: ADR-0010 addendum A-2, module-map rows, spec FR-B13 / 61-x rows | M1 | no | 140–200 (docs) |
| **61-1b** | Identity: grant guard for `read:ratings:branch` + error code (P1-G) | — | no | 160–230 |
| **61-1c** | DB: permission `read:ratings:branch` in catalog, defaults, seed (P1-S) | 61-1b **deployed** (M3), M4 | **yes** | 220–300 |
| **61-1d** | DB + domain: `LOW_RATING` kind and the `low_rating_notices` ledger | M4 (stacked on 61-1c, PP-130) | **yes** | 320–400 |
| **61-1e** | Wire: the two in-app templates end to end (contracts, notifications package, worker store, API inbox) | spec edit of 61-1a | no | 340–420 |
| **61-1f** | Admin: render the two notices + i18n | 61-1e | no | 180–260 |
| **61-1g** | Worker identity: `ratingCommentReaders` | 61-1c | no | 220–300 |
| **61-1h** | Worker customers: `request-low-rating-notice` consumer | 61-1a, 61-1d, 61-1e, 61-1g; **RT-Q17** | no | 380–450 |
| **61-1i** | API customers: append `LowRatingSubmitted`; list the kind in the alert-rules screen | 61-1h and 61-1f **deployed** | no | 220–300 |
| **61-2a** | Staff rating summary API | — (`read:ratings:own` already exists) | no | 300–380 |
| **61-2b** | Admin ratings list API | 61-1c; RT-Q17 for the comment column | by `EXPLAIN` (see §6) | 340–420 |
| **61-2c** | Admin per-employee averages API | 61-2b | no | 220–300 |
| **61-2d** | Admin ratings screen | 61-2b, 61-2c | no | 320–400 |
| **61-3** | `rating_average` column + «شغلي» card | 61-2a, **57-4** (not merged), 57c-2 | no | 160–240 |

**Critical path for 59b-3's activation gate («61-1 deployed»):**
61-1a ∥ 61-1b → 61-1c → 61-1d ∥ 61-1e ∥ 61-1g → 61-1f ∥ 61-1h → 61-1i. Rows 61-2 and 61-3 are off that path.

**Rollout order that must hold:** 61-1e on every API and worker node before any `low_rating*` row can exist (a pre-61-1e
API fails the whole inbox page on an unknown variant; plan-61-1 §7.2). 61-1h before 61-1i (consumer before producer).

**Rollback floors.** API and worker: not below 61-1e once a notice row exists. Worker: not below **61-1h** once
61-1i is live. `apps/worker/src/outbox/deliver.ts` never acknowledges an event type the worker does not know: it
fails the delivery with backoff and finally parks the event. So a worker below 61-1h does not lose a
`LowRatingSubmitted` silently, but its bell is late or parked until a 61-1h worker takes it, which breaks SC-004 and
the reason for 59b-3's gate.

## 5. Row 61-1 — the low-rating notice

### 61-1a — Docs: A-2 addendum (docs only)

- `docs/adr/0010-phase-1-ports-and-events.md`: «Addendum 2026-11 — A-2 low-rating notice composed in the worker». It
  states §2.1–§2.4, withdraws the API ports of A-1 (never built), keeps `customers → identity`, and records M2.
- `docs/module-map.md`: §3 replace the three «API customers» rows of A-1 with the worker rows of §2.4; §4 add
  `LowRatingSubmitted`, update `LowRatingReceived`'s emitter; machine block: delete the five `# Planned E:` comments,
  add `# Planned` comments for the worker reads (each becomes a real `reads` line with its adapter, in 61-1h / 61-2).
  Regenerate `docs/module-map.yaml` with `pnpm module-map:generate`; never edit it by hand.
- `spec.md`: D-B9 (the rating transaction appends `LowRatingSubmitted` on stars ≤ 2; the rule is read by the worker),
  FR-B13 (emitter = worker customers; the two template keys), the sub-PR table rows 61-1…61-3 replaced by §4's table,
  the events table, BR-B4's «checked at emission» gloss, and the three wording changes that follow from §3.2, so no
  later sub-PR edits the spec out of order: FR-B15's grant refusal names `PERMISSION_ROLE_NOT_ELIGIBLE` and is built
  in 61-1b (T4), FR-B14's body is the `visibility` union (T5), FR-B15's averages are their own route (T7).
- Tests: none. Gates: `pnpm module-map:check`, `pnpm lint:docs`. **Stop line:** no source file changes.

### 61-1b — Identity: grant guard (P1-G)

- **Behaviour (FR-B15 grant rule).** Saving an `ALLOW` override of `read:ratings:branch` is refused with
  `PERMISSION_ROLE_NOT_ELIGIBLE` (422) unless the target membership's **current** role is the system role owner,
  general manager, business manager or branch manager; a custom role is refused too. Nothing is written: no override
  row, no audit row, no cache invalidation. `DENY` and `REVOKE` are **not** refused (ending a wrong grant must stay
  possible).
- **Inert on merge.** The code is a constant in `identity/domain`; it is deliberately **not** added to `PERMISSIONS`,
  `ROLE_DEFAULTS` or `system-role-policy.ts` here, so the catalog check still refuses the unknown code first and
  running the seed activates nothing (plan-61-1 §7.2).
- **Files** (`apps/api/src/modules/identity`): `domain/ratings-read-eligibility.ts` (pure:
  `ratingsReadGrantFailure(code, effect, targetRole)` and `RATINGS_READ_ROLES`, Arabic JSDoc) ~45;
  `domain/permission-edit.ts` (call it from `permissionEditFailure`, add the failure to its union) ~15;
  `apps/api/src/shared/errors.ts` (code → 422, ar/en messages through the existing envelope) ~10;
  `packages/contracts` error-code enum + OpenAPI ~10; `packages/i18n` error catalog ar/en ~6.
  The edit context already carries what the rule needs: `PermissionEditContext.membership.systemRoleCode` (`null`
  for a custom role) and the injected `context.catalog`.
- **Tests:** domain unit only, with the code placed in the test's `context.catalog`: every system role ×
  ALLOW/DENY/REVOKE, a custom role (`systemRoleCode: null`), other codes untouched ~110. The Postgres integration
  test needs the real catalog row and lands in 61-1c.
- Permissions: none new. i18n: the one error message. **Stop line:** no catalog, defaults, seed or migration.

### 61-1c — DB: the permission (P1-S)

- **Behaviour (RT-Q7).** `read:ratings:branch` «قراءة التقييمات»: default `ALLOW` for owner, general manager, business
  manager and branch manager at their membership scope; never holdable by a device; delegatable only by the rule of
  61-1b.
- **Migration** (one, additive, mirrors `0167_…_alert-rules-permission.sql`): insert the permission, then
  `role_permissions` for the four global system roles; idempotent (`ON CONFLICT DO NOTHING`). Number assigned at
  generation from live `main`; `pnpm db:generate` for snapshot and journal. No table, so no RLS change.
- **Files:** `packages/db/src/access-catalog.ts` ~2; `role-defaults.ts` ~2; `system-role-policy.ts` (device-forbidden
  list + delegatable list) ~6; the migration ~25; `packages/i18n/src/permission-codes-catalog.ts` and
  `permission-name.ts` ar/en ~8; admin/pos generated clients if the code enum is exported.
- **Tests:** catalog/default parity spec (existing pattern) ~30; migration test: the four roles hold it, cashier and
  reception do not, a second run changes nothing ~60; integration: with the real catalog, a grant to a cashier
  membership → 422 and nothing written, to a branch manager → saved ~70.
- **Rollback note.** No reader of this permission exists before 61-1g/61-2, and every reader re-checks the current
  role, so code below 61-1c is harmless while the rows stay. No SQL reverse is planned.
- **Stop line:** no route, no reader, no screen.

### 61-1d — DB + domain: the kind and the ledger

- **Behaviour.** `LOW_RATING` becomes a storable alert kind with the default of RT-Q8 (`managersInApp`: on, the four
  scoped manager roles, `IN_APP`, branch override allowed). It is **not** added to the admin's `LISTED_ALERT_KINDS`
  (that is 61-1i), so no switch is shown that changes nothing (RT-26, SC-005).
- **Schema / migration** (one, mirrors 0219 and `late_service_session_notices`):
  - drop and re-add CHECK `alert_rules_kind` with `LOW_RATING` (same statement shape as 0219:36–38);
  - new tenant table `low_rating_notices`: `company_id uuid NOT NULL`, `id uuid`, `business_id`, `branch_id`,
    `rating_id`, `source_event_id uuid`, `decided_at timestamptz`, `recipient_count integer CHECK (>= 0)`;
    PK `(company_id, id)`; UNIQUE `(company_id, rating_id)`; FK `(company_id, rating_id)` → `ratings (company_id, id)`
    (the unique index covers the FK); RLS ENABLE + FORCE, policy `company_id = app_company_id()`; grants to
    `pospay_app`: `SELECT, INSERT` only (a decision is never edited or deleted).
- **Files:** `packages/domain/src/alert-rules.ts` (kind + definition, fix the line-2 comment) ~12;
  `packages/contracts/src/settings/alert-rules.ts` ~2 + OpenAPI; `packages/db/schema/settings.ts` `ALERT_KINDS_SQL`
  ~2; `packages/db/schema/ratings.ts` (table, Arabic one-liners on non-obvious columns) ~40; migration SQL ~45.
- **Tests:** domain unit for the default and `effectiveAlertRule` of the new kind ~40; settings integration: a
  `LOW_RATING` rule and a branch override save and read back ~50; **RLS negative** for `low_rating_notices`
  (cross-tenant read = 0 rows, insert with a foreign `company_id` = error, re-home refused, no UPDATE/DELETE grant)
  ~90; unique-claim test (second insert for the same rating conflicts) ~30; kind-list parity between domain,
  contracts and SQL ~20. Update the existing unknown-kind case in `packages/db/src/__tests__/rls-alert-rules.spec.ts`
  (it inserts `LOW_RATING` and expects `alert_rules_kind` to refuse it) to use a kind that stays unsupported.
- **Stop line:** no emitter, no listing, no i18n label for the kind.

### 61-1e — Wire: the two in-app templates

Implements plan-61-1 §3.2–§3.3 (alternative B) unchanged, except that no API-side strict request schema or parse
closure is needed.

- **Behaviour.** A notification request may carry `template_key` `low_rating` or `low_rating_with_comment`
  (revision 1) whose `safe_parameters` is exactly one `{ name: 'details', type: 'details', value }` with the strict
  details object of plan-61-1 §3.2 (`stars` 1|2, branch names, `business_date`, `performers[]`, `customer_name`,
  `phone_last3`, and `comment` only in the second key). The worker stores it, the API inbox returns it. Unknown keys in
  `details` are rejected. The 14 legacy variants and `SafeParameter` are untouched.
- **Files:** `packages/contracts/src/low-rating-notifications.ts` (details schemas, the two request variants, the two
  response variants; follows `staff-alert-notifications.ts`) ~95; `in-app-notifications.ts` (add to both unions) ~10;
  `packages/notifications/src/templates/low-rating.ts` (two definitions, `validLowRatingTemplate`, ar/en copy) ~80;
  worker `notifications/domain` parameter union + `on-notification-request.handler.ts` `storeRecipient` branch by key
  ~45; API `notifications` response typing ~10; OpenAPI + admin/pos generated clients.
- **Tests:** contracts unit (strict shape, comment required/forbidden per key, name code-point limits, digit-run
  names, 1000-code-point comment) ~90; worker/notifications parity test (the package validator and the contract accept
  and reject the same samples) ~50; worker handler integration: a `LowRatingReceived` request stores one row per
  recipient, an invalid details object → `NOTIFICATION_REQUEST_INVALID` ~60; API inbox query: a stored row of each key
  parses in the page, result shape + existing `EXPLAIN` assertion still green ~40.
- i18n: template copy only (inside the notifications package). Permissions: none.
- **Stop line:** no emitter; no admin rendering.

### 61-1f — Admin: render the notices

- **Behaviour (RT-23).** The bell list shows, in the viewer's locale with Arabic-to-English fallback per name: stars,
  branch, date, performers' first names (all of them, no team label), the customer's name or the generic label when
  null, «آخر ٣ أرقام» of the phone, and the comment block only for `low_rating_with_comment`. Text is rendered as
  text, never as HTML or a link (RT-21).
- **Files:** `apps/admin/src/notifications/model/render-notification.ts` (two branches; narrow the scalar helpers
  explicitly, no cast) ~50; a small `model/low-rating-notice.ts` if the renderer would pass 300 lines ~40;
  `packages/i18n/src/in-app-catalog.ts` `inApp.lowRating.*` ar/en ~24.
- **Tests (visible outcome, CLAUDE.md §9):** the rendered row shows stars, branch, both performers and the masked
  phone; the comment is visible for the with-comment key and absent for the other; null customer name shows the
  generic label; an unknown newer revision is skipped as today ~110.
- RTL: logical properties only. **Stop line:** no ratings screen, no nav item.

### 61-1g — Worker identity: `ratingCommentReaders`

- **Behaviour (BR-B4, RT-Q7b).** `ratingCommentReaders(tx, companyId, businessId, branchId, userIds, at)` returns the
  sorted, unique subset of `userIds` who, at `at`: (a) hold an active membership whose **current** role is one of the
  four manager roles with a scope covering the branch, and (b) have an effective `ALLOW` of `read:ratings:branch` at
  that branch, where a covering `DENY` from **any** of their active memberships wins, the canonical owner ignores
  `DENY` but is not given an `ALLOW` out of nothing (API `evaluateAccess` / `protectOwnerAccess` semantics). Empty
  input → `[]` with no query. One set-based statement; no per-user loop.
- **Files** (`apps/worker/src/modules/identity`): `persistence/rating-comment-readers.ts` (statement + reader; reuse
  `canonicalOwnerSql`, `systemRoleGrantAllowedSql`, `systemRoleOverrideAllowedSql` as `business-permission-holders.ts`
  does) ~95; `domain/rating-comment-access.ts` (pure decision, Arabic JSDoc) ~45; `index.ts` export ~4.
- **Tests:** domain unit (ALLOW by role, DENY override, sibling non-manager DENY, owner, custom role with a historic
  ALLOW, non-manager role) ~90; integration on Postgres: other company and other branch scope excluded, expired
  membership and expired override, role changed after a grant, same-transaction read ~110.
- **Stop line:** no consumer of the reader yet; API identity untouched.

### 61-1h — Worker customers: `request-low-rating-notice`

- **Behaviour.** On `LowRatingSubmitted`:
  1. the stored rating must match the event's company, request, business, branch and stars; a mismatch throws
     (`LOW_RATING_EVENT_INVALID`, retried then parked), and `stars > 2` returns silently;
  2. company not open → return; the **rule snapshot** = one statement reading the `LOW_RATING` rule for the branch
     and the master switch `alerts_enabled`; off, or no `IN_APP` channel in that snapshot → a recorded
     zero-recipient decision, no notice (RT-22, BR-B5). A rule or master-switch change committed after the snapshot
     does not flip that decision;
  3. `decidedAt = clock.now()` — it timestamps the recorded `low_rating_notices` row and governs the identity reads
     (membership and permission-override expiry); candidates = managers of the rule's roles in the branch scope,
     deduplicated and sorted;
  4. claim `low_rating_notices` for the rating; a lost claim returns (redelivery, RT-16-style idempotency);
  5. no candidates or missing branch → the claim stands with `recipient_count = 0`, no notice;
  6. comment `null` → every candidate gets `low_rating` and `commentReaders` is not called; otherwise readers get
     `low_rating_with_comment` and the rest get `low_rating` (disjoint by construction, plan-61-1 §3.8);
  7. names and details per plan-61-1 §3.5: performers ordered by `employee_id`, first word of the stored name, the
     ar → en → generic-label fallback as `null`; customer full name; `phone_last3` with the same semantics as API
     `maskPhone`; `business_date` from the request;
  8. each non-empty partition from step 6 (`low_rating_with_comment` and `low_rating`) → groups of at most 100 within
     that partition → one `LowRatingReceived` per group, appended in the same transaction. A group never mixes the two
     templates.
- **RT-Q17 (answered, PP-207.1):** the comment is shown as written. `noticeComment` is the only place that answer
  changes; if Abu Salem picks differently on the page, only that function changes in a follow-up.
- **Files** (`apps/worker/src/modules/customers`): `domain/low-rating-notice.ts` (pure: partition, groups, details
  composer, first-name rule reusing `display-name.ts` / `performer-label.ts`; Arabic JSDoc) ~110;
  `ports/low-rating-notice.ports.ts` (rule, recipients, place, repository, outbox; one-line Arabic doc per method)
  ~60; `persistence/low-rating-notice.repository.ts` (match, claim, read rating + request + customer + performers)
  ~90; `persistence/low-rating-recipients.adapter.ts`, `low-rating-place.adapter.ts`, `alert-rule.adapter.ts` ~45;
  `use-cases/request-low-rating-notice/request-low-rating-notice.ts` ~70;
  `events/handlers/on-low-rating-submitted.handler.ts` ~30; `events/published.ts` (re-export, one-line Arabic «when
  emitted») ~6; `customers.module.ts` wiring ~20; `packages/contracts/src/customers/low-rating-submitted.ts` ~18;
  module-map `reads` lines for the new adapters.
- **Tests:** domain unit, no database: stars gate, partition with and without a comment, 101 recipients → two groups,
  name fallbacks, repeated names kept, phone of 2 and 3 digits ~150; integration: RT-22 (2 stars → one event; rule off
  → none; 3 stars → none), RT-23 (fields, no token, phone masked), the DENY-holder gets the notice without the comment
  and the holder gets it, redelivery makes no second notice, cross-tenant event rejected, rollback leaves no ledger
  row ~190.
- **Stop line:** the API does not emit yet; the kind is not listed.

### 61-1i — API customers: emit and list

- **Behaviour.** `consumeAndRate` returns `{ ratingId, businessId, branchId } | null`; when `isLowRating(stars)` the
  use case calls `scope.appendLowRatingSubmitted(...)` in the same transaction (RT-16: one rating, one consumption, one
  event; rollback leaves none). The `TODO(spec)` at `submit-rating.usecase.ts:65` is removed. The alert-rules screen
  lists `LOW_RATING` with its label.
- **Files:** `customers/domain/rating-submission.ts` (`isLowRating`, Arabic JSDoc) ~12;
  `ports/rating-submission.port.ts` ~14; `persistence/drizzle-rating-submission-transactions.ts`
  (`appendOutboxEvent`, parsed with the contract) ~30; `use-cases/submit-rating/submit-rating.usecase.ts` ~10 (no
  `sql`, no arithmetic); `events/published.ts` (new file, Arabic one-liner) ~8;
  `apps/admin/src/settings/alert-rules/model/listed-alert-kinds.ts` ~3; `packages/i18n/src/alert-rules-catalog.ts`
  `alertRules.kind_LOW_RATING` ar/en ~4.
- **Tests:** domain unit for `isLowRating` ~15; use-case spec with fakes (1, 2 → append; 3, 4, 5 → none; unavailable
  token → none) ~50; integration: outbox row present with the exact payload, absent on rollback and on a concurrent
  second submit ~80; admin UI test: the `LOW_RATING` row and its switch are visible ~40.
- **Stop line:** nothing about averages; 59b-3's activation is a separate reviewed change.

## 6. Row 61-2 — averages and the admin read

### 61-2a — Staff rating summary API

- **Behaviour (FR-A05, FR-B14, D-B12, RT-24, S-9, S-11).** `GET /v1/staff/me/rating-summary` on the personal staff session:
  the caller's own employee, `read:ratings:own`, and the `rating_average` staff column. Column not allowed (always the
  case until 61-3) → `{ visibility: 'HIDDEN' }`. Otherwise `{ visibility: 'VISIBLE', average, count }` over
  `rating_attributions` of that employee whose `submitted_at` falls in the current calendar month of the business
  timezone (D-B12, T10); `count = 0` → `average: null`, which the client shows as «لسه مفيش تقييمات». Never a comment, a
  customer, a star list or another employee's number.
- **Month window (D-B12, T10).** The read narrows the rows first by an indexed UTC candidate window
  `[local_start - 1 day, local_start + 1 month + 1 day)` and then keeps only the rows whose business-local month is
  exactly `date_trunc('month', submitted_at AT TIME ZONE tz) = local_start`; the window is an upper bound for the index
  and the local match is the exact one, so a daylight-saving fallback across midnight cannot split one month into two.
- **Files:** identity `persistence/own-ratings-access.ts` + index export (mirrors `own-service-sessions-access.ts`)
  ~45; customers `queries/own-rating-summary.query.ts` (one-line Arabic «which screen») ~40;
  `queries/own-rating-context.ts` (employee, access, column, month window; the shape of orders'
  `own-work-context.ts`) ~65; `http/own-rating-summary.controller.ts` ~45; wire the existing `StaffColumnsPort`
  adapter in `customers.module.ts` ~15; `packages/contracts/src/customers/own-rating-summary.ts` ~20 + OpenAPI.
- **Tests:** query result shape + `EXPLAIN ANALYZE` on `rating_attributions_employee_idx` ~70; HTTP integration:
  hidden while the column is postponed; with the column injected as allowed: two ratings → average and count, none →
  `null`/0, ratings of last month excluded, another employee's ratings excluded, no `read:ratings:own` → 403,
  cross-tenant → nothing; a contract test that the schema has no comment field ~140.
- **Stop line:** no POS change; the column gate is not lifted.

### 61-2b — Admin ratings list API

- **Behaviour (FR-B15, RT-25).** `GET /v1/businesses/:businessId/ratings?branch_id&from&to&employee_id&cursor` →
  keyset page, newest first, of `{ id, stars, submitted_at, business_date, branch, performers[], comment }`. Access:
  the caller's **current** role must be one of the four manager roles and `read:ratings:branch` must be effective;
  the rows are limited to the branches inside the caller's scope (a branch manager sees her branch only). No access →
  403. Every holder sees comments (RT-Q7b); the comment follows RT-Q17's answer.
- **Files:** identity `persistence/ratings-read-access.ts` (`readRatingsReadAccess` → allowed branch ids or all
  branches of the business) + pure decision in `domain/` + index export ~90; customers
  `queries/ratings-list.query.ts` (projects straight into the DTO, no mapper) ~80;
  `http/ratings.controller.ts` ~55; contracts `customers/ratings-list.ts` ~35 + OpenAPI; ADR-0011 addendum that
  withdraws §8 (RT-Q7b) ~20 docs.
- **Index.** Candidates already exist: `ratings_branch_idx (company_id, business_id, branch_id, submitted_at)` and
  `rating_attributions_employee_idx`. The implementer runs `EXPLAIN ANALYZE` for the four filter combinations; **if**
  the business-wide newest-first page or the keyset tiebreak needs `(company_id, business_id, submitted_at, id)`, the
  index is added `CONCURRENTLY` in this PR's own migration and the manager is told before generation. Planned: none.
- **Tests:** identity decision unit ~60; query shape + `EXPLAIN` per filter combination ~90; HTTP integration: branch
  manager in scope gets stars, date, branch, performers and comment; out-of-scope branch filtered; a role changed to
  cashier after a grant → 403; no permission → 403; cross-tenant → empty; pagination stable ~130.
- **Stop line:** no averages, no screen.

### 61-2c — Admin per-employee averages API

- **Behaviour.** `GET /v1/businesses/:businessId/ratings/averages?branch_id&from&to&employee_id&month` → per employee
  `{ employee_id, name_ar, name_en, average, count }` over the filtered range, same access rule and scope as 61-2b
  (shared access reader). Default range when `from`/`to`/`month` are absent: the current calendar month in the
  business timezone, by `submitted_at` (D-B12, T10). `cursor` and `limit` belong to the paginated ratings list of
  61-2b only; the averages route takes neither. An explicit range needs **both** `from` and `to` and spans at most
  **366 days**; a wider range or a one-sided (open-ended) range is refused with `422 RATING_RANGE_TOO_WIDE`
  (PP-278, owner decision 2026-11-26), enforced in the read so a malformed or inverted range stays
  `400 VALIDATION_FAILED`. The `month` window, the default current month and the cursor-paginated ratings list
  (open-ended and long ranges) keep working unchanged.
- **Files:** `queries/rating-averages.query.ts` ~70; route in `ratings.controller.ts` ~30; contracts ~25 + OpenAPI.
  Employee names through the existing API staff public reader on the same transaction (add a `reads` line if a new
  symbol is used).
- **Tests:** shape + `EXPLAIN` ~70, with the `EXPLAIN ANALYZE` assertion covering the **366-day maximum range**
  (index scan on company and time, rows bounded by the window, execution under 200 ms); integration: RT-24 (both
  snapshotted performers get the rating; the mean is of attributed ratings), scope filter, 403 paths, the 366-day
  range accepted and the wider or one-sided range refused with `RATING_RANGE_TOO_WIDE` ~100.
- **Stop line:** no screen.

### 61-2d — Admin ratings screen

- **Behaviour.** `apps/admin/src/ratings/{api,model,pages,ui}` and a thin route under `app/(dashboard)/ratings`:
  filters (branch, period, employee), the averages table, the ratings list with comments, empty and error states. The
  nav item appears only when the list query succeeds (the pattern of `alert-rules-nav-item.tsx`).
- **Files:** generated client hooks; page ~70; table and list components (one per file, TanStack Table, server
  pagination) ~150; model/text ~40; nav item ~25; `packages/i18n` `ratings.*` ar/en ~40.
- **Tests (visible outcome):** rows and a comment are shown; the empty state text; the nav item is absent on 403; the
  period filter changes the request and the visible rows ~120.
- Design system: the Lovable base style (`packages/ui` only). RTL logical properties. **Stop line:** no export.

## 7. Row 61-3 — `rating_average` on «شغلي» (blocked on 57-4)

- **Behaviour (D-A7, FR-A08, RT-24, RT-25).** `POSTPONED_COLUMNS` loses `rating_average`: `effectiveStaffColumns`
  returns it, `invalidStaffColumns` accepts it in a saved set, the MY-Q3 default includes it, and the admin columns
  screen offers its checkbox. The «شغلي» card calls the generated `rating-summary` hook and shows the average with the
  count, «لسه مفيش تقييمات» for zero, and nothing at all when the column is hidden.
- **Files:** `apps/api/src/modules/settings/domain/staff-columns.ts` + its tests ~30;
  `apps/admin/src/settings/staff-app-columns/model/offered-staff-columns.ts` ~4 + i18n label;
  `apps/pos/src/<work screen of 57-4>/ui/rating-summary-card.tsx` + hook ~70; `packages/i18n` ar/en ~10.
- **Tests:** settings unit and integration (accepted, returned through every adapter) ~60; admin UI (checkbox visible)
  ~30; POS UI (average and count visible; zero text; no card when hidden) ~70.
- **Blocked:** 57-4 («شغلي» screen) and 57-2b are not merged. The manager re-plans this row's file paths once 57-4 is.

## 8. Open items handed to the manager

1. Done: M1 and M2 accepted by Waleed, M3 and M4 by the manager (PP-207, §3.1).
2. Done: RT-Q17 answered by Waleed (PP-207.1, batch 98). Abu Salem's pick on the page is still pending; if it differs,
   only `noticeComment` in 61-1h and the comment column in 61-2b change.
3. Migrations: **yes, two** (61-1c permission seed; 61-1d kind CHECK + ledger table), plus a possible index migration
   in 61-2b decided by `EXPLAIN`. They follow the migration lane, stacked per PP-130, with a fresh staging snapshot
   before `migrate` (PP-129).
4. 59b-3 stays blocked until 61-1i is deployed and verified on staging, together with 60-1 and 60-2.
5. Not verified by this plan (the implementer checks first): the dispatcher's polling cadence against SC-004's 2
   minutes; whether a shared phone-masking helper exists outside API `customers/domain/phone.ts`; where the worker
   registers a new customers consumer and its `knownEventTypes` entry; the exact line budget of each file.
