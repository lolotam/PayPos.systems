# Row 61 with 57-2b and 57-4 — one PR: umbrella specification

> **Status: PLANNING ONLY (PP-204).** This file adds no requirement. It restates, per checkpoint, what spec 060
> already requires, as acceptance scenarios an implementer and a reviewer can check. On any difference, `../spec.md`
> wins, then `../plan-61.md`. Nothing here is code, a migration, a PR, a rollout, a database operation or an
> experiment.
>
> **Base:** canonical docs and code read with `git show` at `origin/main`
> `a32a6a211b383657cd65e180cd8a2c4aa3e9e666` (migration journal tail `0238`). These files sit on the local commit
> `2053a63130ac4751fede1c0d549b700535978bee`, whose tree is older than main.
>
> **Sources:** `../spec.md` Story B4 (RT-22…RT-25), FR-B13…FR-B15, BR-B4, BR-B5, D-A7, D-B9, D-B12, D-B15, SC-004;
> `../plan-61.md` (the split and T1…T10); `../plan-61-1.md` §3.2, §3.3, §3.5, §3.8, §7.2 (kept by plan-61);
> `../owner-questions.ar.md` items 33–35; `docs/owner-decisions.ar.md` PP-201, PP-207; ADR-0010 addendum A-2
> (#1138); ADR-0011; ADR-0037 §5. For 57-4: `../spec.md` Part A (D-A7, D-A13, MY-01, MY-02, MY-07, MY-08, MY-13b,
> FR-A06b, FR-A09) and its A.5 delivery table. For 57-2b: FR-A01, FR-A06, D-A2, D-A7, D-A8, D-A9, MY-01…MY-04,
> `../57-2a-brief.md`, `../57-2a-manager-authorization.ar.md`, and the #894 diagnosis kept in the 57-2 briefs archive
> (`archive-894-2f8858d4/`: `tenant-lag-report.md`, the split proposal and its plan files).

## 1. Scope

**In — one PR, 14 ordered checkpoints, canonical IDs unchanged** (owner instruction of 2026-11-22, §3):
61-2a, 61-1c, 61-1d, 61-1e, 61-1f, 61-1g, 61-1h, 61-1i, 61-2b, 61-2c, 61-2d, **57-2b**, **57-4**, 61-3.

- **61-2a** is already implemented and rebased in its own worktree (head `c362b10f3`); this PR completes it, it is
  not rewritten.
- **57-2b** (the own service-lines API) and **57-4** (the «شغلي» screen) are row 57's units. They keep their IDs
  and requirements and are built here because 61-3's card lives on that screen: 57-2b → 57-4 → 61-3.
- The checkpoints are implemented one by one in the order of plan §3, by one owner session.

**Out:**

- 61-1a (#1138) and 61-1b (#1135): merged.
- Row 62. Its merged slices stay as they are. 62-2c (commission-statement alerts on the rules) is open on main, is
  independent of ratings and is **not** scoped in. Row 61 delivers the one rating part of row 62: the `LOW_RATING`
  kind (stored by 61-1d, listed by 61-1i).
- 57-5 (estimate card wiring): stays outside; it follows this PR separately.
- 59b-3's activation (its own reviewed change after 61-1i is deployed and verified).
- WhatsApp or e-mail delivery of the low-rating notice (RT-Q9: in-app only in this phase), export of ratings.

**Reading of the owner's phrase «لتكون مهمة 62 كاملة».** Manager decision, 2026-11-22: the scope is canonical row 61
with its IDs unchanged; `LOW_RATING` is row 61's contribution to row 62; the independent 62-2c stays out; no owner
card is sent now, because the row-61 scope is explicit and can be completed.

## 2. The 14 original items of `plan-61.md` §4, the two row-57 units, and their status

| # | Slice | What it delivers | Status on the base | Covered here |
|---|---|---|---|---|
| 1 | 61-1a | Docs: ADR-0010 addendum A-2, module-map rows, spec wording | **Merged** #1138 (`4ab01c808`) | no |
| 2 | 61-1b | Identity grant guard, `PERMISSION_ROLE_NOT_ELIGIBLE` 422 | **Merged** #1135 (`336c5ea77`) and **live on staging** (manager's M3 receipt, 2026-11-22; plan §2) | no |
| 3 | 61-1c | Permission `read:ratings:branch` in catalog, defaults, seed | Not started; M3 satisfied; its migration is generated in the lane turn (plan §6) | **yes**, checkpoint 2 |
| 4 | 61-1d | `LOW_RATING` kind + `low_rating_notices` ledger | Not started | **yes** |
| 5 | 61-1e | The two in-app templates end to end | Not started | **yes** |
| 6 | 61-1f | Admin renders the two notices | Not started | **yes** |
| 7 | 61-1g | Worker identity `ratingCommentReaders` | Not started | **yes** |
| 8 | 61-1h | Worker customers `request-low-rating-notice` | Not started | **yes** |
| 9 | 61-1i | API appends `LowRatingSubmitted`; the kind is listed | Not started | **yes** |
| 10 | 61-2a | Staff rating summary API | **Implemented**, rebased, not merged (worktree head `c362b10f3`; tests under way) | **yes**, checkpoint 1 (completion) |
| 11 | 61-2b | Admin ratings list API | Not started | **yes** |
| 12 | 61-2c | Admin per-employee averages API | Not started | **yes** |
| 13 | 61-2d | Admin ratings screen | Not started | **yes** |
| 14 | 61-3 | `rating_average` column + «شغلي» card | Not started; after 57-4 in this PR | **yes**, checkpoint 14 |
| + | **57-2b** (row 57) | Own service-lines API with the #894 P1 hardening | Not built; design approved for isolated local proof (plan §5.7), acceptance pending | **yes**, checkpoint 12 |
| + | **57-4** (row 57) | «شغلي» POS screen, estimate-card shell, reception-device private view | Not built; after 57-2b in this PR | **yes**, checkpoint 13 |

## 3. Owner decisions this work stands on (confirmed from source, none re-asked)

| Id | Decision | Source | State |
|---|---|---|---|
| RT-Q6a | Average window = the current calendar month, count shown beside it, shown from the first rating | `../spec.md` B.1; batch 40; PP-18.15 | Binding (Abu Salem) |
| RT-Q7 / RT-Q7b | New permission «قراءة التقييمات», default for owner, general, business and branch manager in their scope; comments for every holder | batch 40 | Binding (Abu Salem) |
| RT-Q8 | `LOW_RATING` default: on, in-app, the four managers in the visit branch's scope | `../spec.md` B.4 | Decided |
| RT-Q9 | Notice content: stars, branch, date, performers' first names, customer name, last 3 phone digits; comment in-app only | `../spec.md` RT-23 | Decided |
| **RT-Q17** | A comment that contains a phone number is shown to comment readers **as written** | `../owner-questions.ar.md` item 33; PP-207.1; batch 98 | **Waleed answered** 2026-11-20 14:35 Kuwait: «تبان زي ما اتكتبت (المقترح)». **Abu Salem: PENDING** on the page. Work proceeds on Waleed's pick (`CLAUDE.md` §1 5b); a different pick by Abu Salem binds and changes only `noticeComment` (61-1h) and the comment column (61-2b) in a follow-up |
| M1 (PP-207.2) | The notice is composed in the worker from a small API event | item 34 | Waleed: «في الـ worker (المقترح)» |
| M2 (PP-207.3) | BR-B4, BR-B5, D-B15 are evaluated at the worker's decision instant | item 35 | Waleed: «لحظة قرار الـ worker (المقترح)» |
| M3, M4 (PP-207.4) | Permission in two stages (guard, then seed after the guard is on staging); migrations generated in their lane turn | `../plan-61.md` §3.1 | Manager (PP-124, PP-130) |
| MY-Q1 (PP-18.1) | «شغلي» opens on the personal phone and on the reception device after the PIN (D-A13) | `../spec.md` A.1 | Waleed |
| MY-Q8 (PP-18.8) | A cancelled line is shown struck through | `../spec.md` MY-07 | Waleed |
| **One PR, one owner, Medium** | Every remaining unit ships in **one PR**, built by **one** OpenCode owner to the end, tier **Medium** with Heavy review (MiniMax 3.1 delivered 61-2a/61-1c; GLM 5.3 delivered 61-1d after the 2026-11-22 quota transfer; Claude continues from 61-1e on Waleed's instruction) | Waleed, 2026-11-22: «لية هما شرايح انا عايزهم كلهم في PR واحد بشريحة واحة Minimax 3.1 open code حتي النهاية medium» and «خلي fabel يعدل الخطة ويضيفة ضمن الخطة الجديدة وال spec ويطحط في دورة المظبوط» | PP-217 and PP-218 (local manager records) |
| **61-1i release** | Keep the current issuance lock in the combined PR. Prove no active links before release and verify worker and Admin deployment and staging delivery before wider activation of 59b-3. | Waleed, 2026-11-22, chose the existing lock on the gate card | PP-219 (local manager record) |
| Order and 57-4 (history) | Implement one by one, 57-4 before 61-3 | Waleed, 2026-11-22: «add all these sub tasks to the spec and plane so will implement in order one by one so 57-4. wii be before 57-4.61-3 … add these two 57-4. and 61-3» | PP-215 (local manager record); the order still holds |
| One PR for 57-4 + 61-3 (history) | Only those two in one PR | Waleed: «all in one PR», scoped then to the two slices | PP-215; **superseded** by the row above |
| 57-4 waits for 57-2b (history) | 57-2b on its own delivery path | Manager, relayed | PP-215; **superseded**: 57-2b is now inside this PR, still before 57-4 |
| 57-2 authorization | B (57-2b) needs its query-hardening design presented and approved before any B code or experiment; P1 of #894 is fixed before the route is exposed; 200 ms; no migration, index or config; B 1,800 expected / 3,600 refused, A + B at most 5,600 changed lines | `../57-2a-manager-authorization.ar.md`, `../57-2a-brief.md` (a manager decision under Waleed's delegation) | Binding, except its «same Codex session, two PRs» which the owner's instruction replaces |
| 57-2 rulings | D1–D3 and Q1–Q6 of the 57-2 plan (`late` only with `date`; the device branch proves authority and does not narrow history; cursor = `line_id` with one uniform 400; `line_id` and `cancelled_at` are context fields) | 57-2 plan §11, kept in the 57-2 briefs archive | Binding, unchanged |
| PP-201 | The manager merges every PR, Heavy included, once the gates pass; production, server, secrets and HOLD stay Waleed's | `docs/owner-decisions.ar.md` item 121 | Waleed: «انا بديك صلاحية الدمج» |

**No unanswered product question was found for the 14 checkpoints.** PP-219 records the 61-1i release condition
(plan §4), and the manager approved the 57-2b design for local proof (plan §5). Technical choices T1…T10 of
`../plan-61.md` §3.2 stand as recorded there.

## 4. Acceptance scenarios

The salon example used below: branch «السالمية», branch manager ليلى, cashier منى, performers سارة and هند, customer
نورة whose stored phone ends in `766`. Scenario IDs are `AC-<slice>-<n>`; each maps to at least one automated test in
the checkpoint (plan §7).

### 61-2a — the staff rating summary (checkpoint 1, completion)

- **AC-2a-1** The acceptance of 61-2a's own spec (written with the implementation in its worktree) holds on the PR
  head: `{ visibility: 'HIDDEN' }` while the column is postponed; otherwise her average and count for the current
  month, `null` with 0; never a comment, a customer or another employee's number (FR-B14, RT-24, RT-25).
- **AC-2a-2** It is completed as built: no route, contract or query redesign in this PR.

### 61-1c — the permission exists and is seeded

- **AC-1c-1** Given a fresh migrated database, when the roles are read, then owner, general manager, business
  manager and branch manager hold `read:ratings:branch` by default, and cashier and reception do not.
- **AC-1c-2** Given the migration already ran, when it runs again, then no row is added or changed.
- **AC-1c-3** Given the real catalog (no test-inserted row), when ليلى's manager grants the permission to منى
  (cashier), then the answer is 422 `PERMISSION_ROLE_NOT_ELIGIBLE` and no override, audit row or cache invalidation
  is written; the same grant to a branch-manager membership is saved.
- **AC-1c-4** A device can never hold the permission (device-forbidden list).
- **AC-1c-5** The permission's name is shown in Arabic and English in the permissions screen catalog.
- **Not in this checkpoint:** any route, reader or screen that uses the permission.

### 61-1d — the alert kind and the decision ledger

- **AC-1d-1** `LOW_RATING` is accepted by the domain, the contract and the database CHECK, with the RT-Q8 default
  (on, the four manager roles, `IN_APP`, branch override allowed).
- **AC-1d-2** A business rule and a branch override of `LOW_RATING` save and read back through the existing
  alert-rules routes; the admin alert-rules screen still does **not** list the kind (no switch that changes nothing,
  RT-26, SC-005).
- **AC-1d-3** `low_rating_notices`: a second decision for the same `(company_id, rating_id)` is refused by the unique
  key.
- **AC-1d-4 (RLS negative)** Tenant B reads 0 ledger rows of tenant A; an insert carrying a foreign `company_id`
  errors; a rating of another tenant cannot be referenced; `pospay_app` has no UPDATE or DELETE on the table.
- **AC-1d-5** The kind list is identical in domain, contracts and SQL (parity test).
- **Not in this checkpoint:** an emitter, a listed switch, a label for the kind.

### 61-1e — the two notice templates travel end to end

- **AC-1e-1** A notification request with `template_key` `low_rating` or `low_rating_with_comment` (revision 1) and
  exactly one `details` parameter is stored by the worker, one inbox row per recipient, and returned by the API inbox
  page.
- **AC-1e-2** `comment` is required in `low_rating_with_comment` and forbidden in `low_rating`; an unknown key inside
  `details` is rejected; `stars` is 1 or 2 only.
- **AC-1e-3** An invalid details object ends as `NOTIFICATION_REQUEST_INVALID`; no inbox row is stored.
- **AC-1e-4** The package validator and the contract accept and reject the same samples (parity).
- **AC-1e-5** The existing template variants and the inbox query's shape and `EXPLAIN` assertion are unchanged.
- **Not in this checkpoint:** an emitter of the request; admin rendering.

### 61-1f — the manager can read the notice

- **AC-1f-1** For a `low_rating` row ليلى sees: 2 stars, «السالمية», the date, «سارة» and «هند» (every performer, no
  team label), نورة's name and the masked phone ending `766`; no comment block.
- **AC-1f-2** For `low_rating_with_comment` the comment block is visible, rendered as plain text (a pasted link or
  HTML is not clickable or interpreted, RT-21).
- **AC-1f-3** A null customer name shows the generic label; a name missing in the viewer's locale falls back from
  Arabic to English.
- **AC-1f-4** A row with an unknown newer revision is skipped as today; the list still renders.
- **Not in this checkpoint:** the ratings screen, a nav item.

### 61-1g — who may read the comment (worker)

- **AC-1g-1** A branch manager whose scope covers the branch and who holds the permission is returned.
- **AC-1g-2** A covering `DENY` from **any** of the user's active memberships removes the user (including a `DENY`
  on a sibling non-manager membership).
- **AC-1g-3** The canonical owner ignores a `DENY` but is not returned without an `ALLOW` source.
- **AC-1g-4** A user whose role changed to cashier after a grant and a custom role with a historic `ALLOW` are
  excluded. An expired membership and an expired override contribute no decision at all: a user whose only `ALLOW`
  came from an expired override or an expired membership is excluded, and a manager with a valid default `ALLOW` and
  an expired `DENY` keeps her access.
- **AC-1g-5** Users of another company or another branch scope are never returned; an empty input returns `[]`
  without a query; the result is sorted and unique; one set-based statement.
- **Not in this checkpoint:** a consumer of the reader; any API identity change.

### 61-1h — the worker decides and composes the notice

- **AC-1h-1 (RT-22)** A stored 2-star rating with the rule on yields `LowRatingReceived`, one event per non-empty
  group of at most 100 recipients per template partition; the two templates are never mixed in a group.
- **AC-1h-2 (BR-B5)** Rule off, or no `IN_APP` channel, at the decision instant: a ledger row with
  `recipient_count = 0` is recorded and no notice is emitted. No candidates, or a missing branch: the same.
- **AC-1h-3 (BR-B4)** With a comment: comment readers get `low_rating_with_comment`, every other candidate gets
  `low_rating`; a recipient with a `DENY` gets the notice without the comment. Without a comment: everyone gets
  `low_rating` and the comment-reader read is not made.
- **AC-1h-4 (RT-23)** The details carry stars, branch names, the business date, performers' first names ordered by
  employee id, the customer's name, `phone_last3` only; never the full phone, never the token.
- **AC-1h-5 (RT-Q17)** A comment «اتصلوا بيا على 99887766» reaches comment readers exactly as written.
- **AC-1h-6 (idempotency)** A redelivered event makes no second notice and no second ledger row; a failed
  transaction leaves no ledger row.
- **AC-1h-7 (integrity)** An event whose company, request, business, branch or stars do not match the stored rating
  fails as `LOW_RATING_EVENT_INVALID` (retried, then parked); an event of another tenant affects nothing; a closed
  company returns silently.
- **AC-1h-8** 101 recipients in one partition produce two events (100 + 1).
- **Not in this checkpoint:** the API does not emit yet; the kind is not listed.

### 61-1i — a low rating starts the notice

- **AC-1i-1 (RT-16, RT-22)** Submitting 1 or 2 stars commits one rating, one token consumption and one
  `LowRatingSubmitted` with exactly `{ schema_version: 1, rating_id, request_id, business_id, branch_id, stars }`.
- **AC-1i-2** 3, 4 or 5 stars, an unavailable token, a rolled-back transaction and a losing concurrent second submit
  append no event.
- **AC-1i-3** The public transaction makes no rule, identity, staff or tenancy read for the notice (one fixed-size
  outbox insert only).
- **AC-1i-4** The alert-rules screen shows the `LOW_RATING` row and its switch with an Arabic and English label.
- **AC-1i-5 (SC-004)** Inside this PR an integration test follows a 2-star submit through both outbox hops to the
  stored inbox row. PP-219 puts the **staging** measurement (the bell within 2 minutes) in the controlled 59b-3
  activation checklist, after proving the consumer and renderer are deployed and before wider activation (plan §4).
- **AC-1i-6** The worker still installs the closed rating-claims lifecycle after this PR, and the dormancy test is
  green on the PR head.
- **Not in this checkpoint:** averages; 59b-3's activation.

### 61-2b — the admin ratings list

- **AC-2b-1 (RT-25)** ليلى (branch manager, permission effective) gets a newest-first keyset page of stars,
  submitted time, business date, branch, performers and comment for «السالمية» only.
- **AC-2b-2** A rating of a branch outside her scope is never returned, with or without a `branch_id` filter.
- **AC-2b-3** No effective permission → 403. A role changed to cashier after a grant → 403. Another tenant's business
  → nothing of that tenant.
- **AC-2b-4** Filters `branch_id`, `from`, `to`, `employee_id` each narrow the page; paging with `cursor` is stable
  (no duplicate, no gap) when ratings share a `submitted_at`.
- **AC-2b-5** The comment is returned as written (RT-Q17).
- **AC-2b-6** Each of the four filter combinations of plan §6 has an `EXPLAIN ANALYZE` assertion.
- **Not in this checkpoint:** averages, a screen.

### 61-2c — per-employee averages

- **AC-2c-1 (RT-24)** A rating with performers سارة and هند counts for both; each average is the mean of that
  employee's attributed ratings in the range, as a one-decimal string rounded half up (`"4.5"`), with its count.
- **AC-2c-2** With none of `month`, `from` and `to`, the range is the current calendar month in the business time
  zone, by `submitted_at`. An explicit `month` (`YYYY-MM`) selects that calendar month in the business time zone and
  cannot be combined with `from` or `to`. The response names the month the server used in `month` (null with
  `from`/`to`).
- **AC-2c-3** Same access rule and scope as 61-2b (403 paths, out-of-scope branches excluded).
- **AC-2c-4** Result shape and `EXPLAIN ANALYZE` are asserted.
- **Not in this checkpoint:** a screen.

### 61-2d — the admin ratings screen

- **AC-2d-1** ليلى sees the averages table and the ratings list with comments; changing the period changes the
  request and the visible rows.
- **AC-2d-2** No ratings in the range → the empty-state text; a failed request → the error state.
- **AC-2d-3** The nav item is absent when the list answers 403.
- **AC-2d-4** All strings come from `packages/i18n` (ar/en); layout uses logical properties and `packages/ui` in the
  Lovable base style.
- **Not in this checkpoint:** export.

### 57-2b — her own service lines (checkpoint 12; starts only on the recorded design approval)

- **AC-57-2b-1 (MY-01, D-A8)** سارة asks for this month and gets exactly the lines whose **current** performers
  include her, in her session's business, newest first; رنا's lines never appear; a shared line appears for each with
  her own share; a line she was removed from is gone.
- **AC-57-2b-2 (MY-02, D-A7)** A column that is not allowed is absent from the response, not `null`; `line_id`, the
  branch name and `cancelled` are always present, `cancelled_at` on a cancelled line; `late` travels only with `date`.
- **AC-57-2b-3 (MY-03, MY-04)** No response, log line or error carries a customer phone, a colleague's id or name, a
  rating or a comment; `customer_name` is the name only.
- **AC-57-2b-4 (paging)** The cursor is the last row's `line_id`; a foreign, stale or other-month cursor answers one
  uniform 400; pages have no duplicate and no gap when lines share a sort key.
- **AC-57-2b-5 (access, FR-A06, FR-A06b)** Personal session or reception device with a live private-view window;
  the employee, membership and own permission are rechecked in the read transaction; a DENY, a deleted employee or
  an expired window is refused; every answer is `no-store`; another tenant or business returns nothing.
- **AC-57-2b-6 (the #894 finding)** For a new tenant whose statistics were never refreshed (no `ANALYZE`), the first
  page and a cursor page each answer in under 200 ms on 600 visits / 602 own lines; the same holds with normal
  statistics. This regression stays in the suite.
- **AC-57-2b-7** No migration, index, configuration or planner setting is added for it; if the bound cannot be met
  that way the checkpoint stops (plan §5.4).
- **AC-57-2b-8** The route and its OpenAPI operation appear only after AC-57-2b-6 passes locally, and the PR links
  the #894 review thread with the proof.
- **Not in this checkpoint:** any screen; the estimate (57-3, 57-5); a change to the tips route.
- **AC-57-2b-9 (clarified 2026-11-22; metric changed by the owner 2026-11-23)** The regular suite asserts
  correctness, read privacy, plans and the statement count per combination (4, 5 or 6; maximum 6). The 200 ms bound
  is judged on **measured PostgreSQL execution time**: the sum of `Execution Time` from `EXPLAIN (ANALYZE)` over the
  page's statements, under 200 ms for every judged page, in an explicit performance run on the delivery head before
  merge — the six-statement combination included, first page and cursor page, stale and normal statistics, on the
  regular fixture and at 66,002 lines. Wall-clock time including the driver is recorded as a diagnostic only and
  the host-load rule no longer gates the run. Earlier wording, kept as history: the bound was judged on wall-clock
  time in one isolated run at low host load.

### 57-4 — the «شغلي» screen (checkpoint 13)

- **AC-57-4-1 (MY-01, MY-02)** سارة, signed in on her phone, opens «شغلي» from the personal screen and sees this month's
  lines newest first with exactly the columns the business allows; a column that is not allowed is not on the screen
  at all (no empty header, no dash).
- **AC-57-4-2 (MY-07)** A cancelled line is struck through with «اتلغت» and its cancellation date.
- **AC-57-4-3 (MY-08)** With `tip` allowed she sees her own tips of the month by method; with it hidden, no tips block.
- **AC-57-4-4 (amended 2026-11-22, Waleed)** The estimate card is not rendered by 57-4 from any production entry;
  57-5 shows it from the single source, the `HIDDEN` / visible status of FR-A02's own estimate route. The POS has no
  staff-facing read of the allowed columns, and 57-4 adds no API. The card component and its «pending» state exist
  and are tested at component level only. Earlier wording, kept as history: «The estimate card shows the «pending»
  state only (57-5 wires the amount); with `estimated_commission` not allowed there is no card.»
- **AC-57-4-5 (MY-13b, D-A13)** On the shared reception device «شغلي» first asks for her PIN; after it her lines show.
  After 60 s without input the screen returns to the PIN step and nothing of hers stays on screen or in the query
  cache. A 403 `PRIVATE_VIEW_EXPIRED` returns to the PIN step with سارة still the signed-in operator; a 401 leaves the
  private screen entirely.
- **AC-57-4-6** While she is using the screen it sends the activity touch at most at the throttled rate; leaving the
  screen, signing out or an operator replacement clears her data from the cache.
- **AC-57-4-7** Loading, empty («no lines this month») and error states are visible; every string is an i18n key
  (ar/en); layout uses logical properties; nothing is stored offline (FR-A09).
- **AC-57-4-8** The screen lives in `apps/pos/src/my-work/` and fetches only through generated client hooks.
- **AC-57-4-9 (D-A9; clarified 2026-11-22)** A line's time and its cancellation date are shown in the business time
  zone on the personal phone and on the reception device alike; the device's own zone is never used. The zone comes
  from the own service-lines response.
- **AC-57-4-10 (clarified 2026-11-22)** On the reception device a reloaded or newly opened tab always shows the PIN
  step, even while another tab's window is live; no tab picks a window up from shared storage.
- **AC-57-4-11 (owner decision 2026-11-22, after four local review rounds)** On the reception device the private
  view is single-tab and never resumes: any exit from the foreground (the tab hidden, `pagehide`, freeze or resume,
  a restored page, the window losing focus), the server-confirmed deadline, a refused or expired answer, an operator
  change or an unmount closes the window at once, drops her data from memory and shows the PIN step. Her data is
  held only in the screen's own memory, never in browser storage or a shared query cache; no cross-tab key or
  channel exists. A response for a closed window is discarded and its window is closed on the server. Every
  refusal conceals and clears first; then a `401` (the session itself ended) leaves the private screen as
  AC-57-4-5 says, while an expired window, a `403` and every other close return to the PIN step. This
  replaces, for «شغلي» on the reception device, the cross-tab client design of ADR-0019's addendum items 6–7.
- **Not in this checkpoint:** the estimate amount (57-5), «حضوري» changes, any API change.
- **Starts after:** checkpoint 12 (57-2b) in this PR.

### 61-3 — the staff member sees her own average (checkpoint 14)

- **AC-3-1 (D-A7)** `rating_average` is offered in the admin columns screen, accepted in a saved set and included in
  the default.
- **AC-3-2 (RT-24)** With the column allowed, سارة's «شغلي» card shows her average and count for the current month;
  with no rating it shows «لسه مفيش تقييمات».
- **AC-3-3 (RT-25)** With the column hidden there is no card at all; the card never shows a comment, a customer, a
  star list or another employee's number.
- **AC-3-4 (clarified 2026-11-22)** The rating card is shown on the personal session only. On the reception device
  «شغلي» shows no rating card and sends no rating request; showing it there is a separate follow-up.
- **Starts after:** checkpoints 1 (61-2a) and 13 (57-4); 57c-2 is merged (#553).

## 5. Edge cases (all slices)

- A permission revoked between the rating and the worker's decision is honoured; one revoked after the decision does
  not retract a stored notice (BR-B4, M2).
- A rule switched off between the rating and the decision sends nothing and records the zero-recipient decision
  (BR-B5, M2).
- Performers and role holders have no source cap; the worker transaction grows with both and runs under the worker
  delivery limit, never under the public 1000 ms limit. A delivery over the limit is retried and finally parked; the
  customer's rating is never rolled back by the notice (`../plan-61.md` §2.2). No cap or truncation is introduced.
- A phone of 2 or 3 digits masks with the same semantics as API `maskPhone`.
- Repeated first names among performers are kept, not merged.

## 6. Data and permission boundaries

| Boundary | Rule |
|---|---|
| Tenant | Every read and write runs in `withTenant(companyId, …)`. The new table `low_rating_notices` has `company_id`, PK `(company_id, id)`, RLS ENABLE + FORCE and its negative test in the same PR (61-1d) |
| Comment | Leaves the database only (a) in `low_rating_with_comment` for comment readers decided by 61-1g, (b) in the admin list for callers passing 61-2b's access check. Never in staff, public or cross-tenant reads, never in a log, never in `LowRatingSubmitted` |
| Phone | Only `phone_last3` leaves the worker; a full number is never logged (`CLAUDE.md` §8). A number the customer typed inside her comment is comment text (RT-Q17) |
| Token | Never in any event, notice, log or response of row 61 |
| Permission | `read:ratings:branch` is checked server-side from the resolved membership, together with the caller's **current** role, in the request's own single transaction (connection budget, `CLAUDE.md` §6) |
| Ledger grants | `pospay_app`: SELECT and INSERT only; a decision is never edited or deleted |
| Public transaction | Gains one fixed-size outbox insert; nothing else (D-B9, AC-1i-3) |
| Own service lines (57-2b) | Only her current-performer lines of her session's business. Any intermediate read that can touch a colleague's row carries ids and sort keys only: no amount, name or customer. Hidden columns are never selected for the response. No customer phone, colleague, rating or comment is selected at all |
| Private view (57-4) | On the shared reception device her data shows only inside a live private-view window and is cleared from the screen and the query cache when it ends; nothing is stored offline |
| Money | None is moved. A rating never moves money (BR-B3); 57-2b only reads amounts already stored, as canonical KWD strings, with no arithmetic in the read |
| Audit | No new audit action: the permission grant is already audited by the grant use case; reads of ratings are not in `CLAUDE.md` §8's list |

## 7. Slice design (pointer)

This umbrella does not restate the slice design; it lives where the implementer brief quotes it from:

| Part | Where |
|---|---|
| Schema changes, RLS, indexes, tenant-qualified FKs | `../plan-61.md` §5 (61-1c, 61-1d); `./plan.md` §6 (lane, the 61-2b index rule). 57-2b and 57-4 add no schema |
| API contract, error codes, events | `../plan-61.md` §5–§6; `../spec.md` FR-B13…FR-B15, FR-A01, FR-A06, FR-A06b; `./plan.md` §5 (57-2b) |
| Permissions | `read:ratings:branch` (61-1c seeds, 61-1g and 61-2b read); `read:ratings:own` (61-2a); `read:service-sessions:own` (57-2b, existing); §6 above |
| Test plan (domain unit, integration, RLS negative, `EXPLAIN`, performance) | §4 above mapped per checkpoint in `./plan.md` §7; 57-2b's in `./plan.md` §5.3 |

## 8. Success criteria

- **SC-61-1** A low rating reaches the configured managers' bell within 2 minutes on staging (SC-004).
- **SC-61-2** No manager without comment access ever receives a comment; no reader outside the four manager roles in
  scope ever receives a rating row.
- **SC-61-3** No switch is shown that changes nothing: `LOW_RATING` appears in the alert-rules screen only in the
  release that also emits (SC-005).
- **SC-61-4** A staff member sees only her own average and count.
- **SC-61-5** The PR is reported «implementation complete, pending `ci-gate`» until `ci-gate` is green on the
  exact head.

## 9. Assumptions

- The staging topology is one `api` and one `worker` container replaced as a whole (M3), so «deployed» is proven by
  the live image SHA in a DEP-1 receipt.
- `LowRatingSubmitted` is **not** added to the worker's standalone `KNOWN_EVENT_TYPES` list ahead of its consumer;
  the consumer's own `eventTypes` register it in 61-1h. Listing it early would acknowledge the event without a
  consumer and lose the bell.
- `apps/pos/src` has no work-screen folder on the base; 57-4 creates `apps/pos/src/my-work/` (FR-A09) and 61-3's card
  lives there.
- While rating sends stay dormant in the shipped worker, no **new** rating link is issued on a deployed build. A
  link issued earlier stays usable until its seven-day expiry, so a submission is excluded only where no unconsumed,
  unexpired link exists; plan §4 names the read-only staging check that confirms it, and plan §9 orders the
  rollback checks on that basis.

## 10. Clarifications

### Session 2026-11-22

Non-interactive pass over the coverage taxonomy of `/speckit-clarify`. Every business rule the 14 checkpoints use is
answered in the sources of §3; no `[NEEDS CLARIFICATION]` marker remains.

- Q: Does a comment with a phone number reach comment readers as written? → A: Yes (RT-Q17, Waleed, PP-207.1; Abu
  Salem pending, his differing pick would bind).
- Q: When are recipients, comment access and the rule's state decided? → A: At the worker's decision instant
  (PP-207.3).
- Q: Does this work include row 62's 62-2c? → A: No (manager decision, 2026-11-22; §1).
- Q: What does «all in one PR» cover? → A: Everything remaining, in one PR with one OpenCode owner, Medium
  (Waleed's later instruction, §3; MiniMax 3.1, then GLM 5.3 after the 2026-11-22 quota transfer, then Claude
  from checkpoint 61-1e on Waleed's instruction the same day);
  the earlier reading (57-4 + 61-3 only, PP-215) is superseded.
- Q: 57-4 depends on the unbuilt 57-2b; what happens to it? → A: 57-2b is built inside this PR, before 57-4.
  The manager approved local proof, and acceptance is required before the API is exposed (plan §5).
- Q: Does the «تقييمك هذا الشهر» card also show when she opens «شغلي» on the reception device with her PIN? → A:
  Personal phone only in this PR; the reception device is a separate follow-up (Waleed, 2026-11-22).
- Q: On the personal phone, in which time zone are a line's time and cancellation date shown? → A: Always the
  business time zone, supplied by the server in the own service-lines response (Waleed, 2026-11-22).
- Q: After a reload or in a new tab on the reception device, while the window is still live, is the PIN asked
  again? → A: Yes, always (Waleed, 2026-11-22); stricter than ADR-0019's addendum item 6 on that one point.
- Q: How is 57-2b's maximum-statement case (six statements: `customer_name` allowed and a cancelled line) accepted?
  → A: By wall-clock time including the driver, under the unchanged 200 ms bound, in one explicit isolated
  performance run at naturally low host load, once on the regular fixture and once at 66,002 lines, stale and
  normal statistics, first page and cursor; all samples, the host load and the `EXPLAIN ANALYZE` figures are
  recorded; database time is diagnostic only; no retry until green (manager design decision, 2026-11-22).
- Q: What counts as low host load for that run? → A: Mean processor load under 40 % over twelve samples in 60
  seconds, checked before the run; above it the run does not start and the proof is reported as waiting (Waleed,
  2026-11-22).
- Q: On what is 57-2b's 200 ms bound judged? → A: On measured PostgreSQL execution time, not wall-clock time with
  the driver (Waleed, 2026-11-23, relayed by the manager, verbatim: «نعم نقبل  القياس و نقبل وقت PostgreSQL
  لتسريع الشغل  (دا تصريح مني)»). The ceiling, the six-statement case, both fixtures, both statistics states and
  both page kinds are unchanged; this supersedes the two answers above on the wall-clock run and the load rule.
- Q: Does opening the PR wait for that receipt? → A: No. The PR is opened after the third local review session and
  states the open measurement; the merge waits for the receipt on the delivery head (Waleed, 2026-11-22).
- Q: How does the reception private view behave across tabs and on leaving the foreground? → A: Simplified by
  the owner after four review rounds kept finding races: single-tab, no shared storage or channel, and any exit
  from the foreground closes the window and asks for the PIN again (Waleed, 2026-11-22; AC-57-4-11). This
  supersedes the same day's earlier answer to build cross-tab closing per ADR-0019.
- Q: Can the producer of 61-1i merge together with its consumer and renderer? → A: Yes. Keep the current
  issuance lock and apply the release and activation evidence in plan §4 (PP-219).
