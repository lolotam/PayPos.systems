# Plan 050 — 35d edit price/discount of a saved service line, and the edit bell

Date: 2026-10-16. DESIGN only: no code, migration or contract file in this PR.
Worktree: `F:\Dev\Worktrees\PosPay\docs-189-edit-bell-plan`; branch `docs/189-edit-bell-plan`.
Baseline: main `29dab827` (35a, 35b-1/2, 35c and the 35c-13 recovery rows merged; staging runs it).
Sources: [spec](spec.md) (FR-016, SS-Q10), [35a plan](plan.md), [35b plan](plan-35b.md), [35c plan](plan-35c.md),
[owner answers](owner-questions.ar.md) (batch 17 = ED-Q1…ED-Q8; batch 22 = ED-Q9…ED-Q11, answered by Waleed 2026-10-16; batch 23 = ED-Q12, **PENDING**),
[ADR-0041](../../adr/0041-orders-service-sessions-reads-and-events.md) (§4 events, §5 late bell, §6 later consumers),
[ADR-0044](../../adr/0044-service-line-price-edit-event-and-bell.md) (this plan's event and consumer decision),
[ADR-0037](../../adr/0037-not-clocked-in-alert-discovery-and-recipients.md) (interim in-app manager rule),
[ADR-0018](../../adr/0018-notification-delivery.md) (notification storage and consumer dedupe),
[module map](../../module-map.md) §3/§4/§6, [CLAUDE.md](../../../CLAUDE.md) §3.1/§4/§5/§6.

**Why this plan exists.** Issue #189 (from the Codex review of #187): ED-Q6 (Waleed, 2026-10-13) says every price or
discount edit of a saved session rings the branch manager. The module map had `ServiceLineChanged` going only to
`commissions` and `customers`, and its `orders → notifications` arrow existed only for the late-session notice. 35d must
not start until the event, the consumer, the map entry, the ADR and the delivery tests are settled. This PR settles
them; it does not implement 35d.

**Status.** The mechanics below (event shape, same-transaction emit, consumer, ledger, no-manager behaviour, tests,
split) depend on no open owner answer. The three recipient/wording details were answered by Waleed on 2026-10-16 (Abu
Salem has not answered; his pick binds if different): **ED-Q9** the same four scoped roles as the late-visit bell,
**ED-Q10** everyone gets the bell **including the editor** (against the recommendation), **ED-Q11** service, branch and
date + «was X, now Y» (net) + the editor's name. One question is still PENDING and marked `TODO(spec)`: ED-Q12, the
reception edit history (batch 23). See [owner-questions.ar.md](owner-questions.ar.md).

## 1. What 35d is, in one table

35d lets an authorized person correct the price or discount of one saved line. Each owner answer lands in one sub-PR (§8).

| Answer | Rule | Lands in |
|---|---|---|
| ED-Q1 | New delegable permission «edit session price/discount»; defaults to owner, general manager, business manager, branch manager | 35d-3 |
| ED-Q2 | The editor's own discount limit applies, with the same half-up effective-discount arithmetic as row 35 | 35d-4 |
| ED-Q3 | Same window as recording (first of the previous month). An approved/paid month records a correction on the next month | 35d-4 window; correction = §6 note |
| ED-Q4 | No editing a line you performed, exactly as in recording (SS-25: even an unlimited owner is refused; the answer records no owner exemption) | 35d-4 |
| ED-Q5 | A typed reason is required | 35d-4 (stored in history, **never** in the event) |
| ED-Q6 | A bell to the branch manager on every edit | 35d-1 and 35d-2 (this plan) |
| ED-Q7 | Edit from the branch day list **and** from the reception screen for lines just saved | 35d-5, 35d-6 |
| ED-Q8 | «Changed» badge with before/after/who/when history | 35d-3 storage, 35d-6 display |

## 2. The event: one `ServiceLineChanged`, with an additive `change` block

ADR-0041 §4 already reserves `ServiceLineChanged` (full line state, per-line `revision`) for 35d, 37 and 37b. The bell
needs three things the shipped contract does not carry: *what kind of change*, *who made it*, and *the previous
money*. 35d adds them to the same event instead of emitting a second one (ADR-0044 §1 lists the rejected options).

`packages/contracts/src/orders/service-session.ts` `serviceLineChanged` gains one **optional** member:

| Field | Value |
|---|---|
| `change.kind` | `'PRICE_DISCOUNT_EDIT'` (37 and 37b add their own kinds later; the bell reacts to this one only) |
| `change.changed_at` | server instant of the edit (`timestamp`) |
| `change.changed_by`, `change.changed_by_membership_id` | the **editor's** user and membership. `recorded_by` keeps naming the original recorder |
| `change.previous` | `{ revision, price, discount, net }` before the edit, canonical three-decimal KWD strings |

The rest of the payload is the existing full line state with `price`, `discount`, `net` after the edit and
`revision = previous.revision + 1`. **Never in the event:** the typed reason (ED-Q5 — free text, can hold a phone or a
name), customer name or phone (only the existing `customer_id`), performer names, recipients.

Rules the 35d-1 contract PR must keep:

- `change` is **optional**, never required or nullable-required. Every payload already published (`ServiceSessionRecorded`
  and `ServiceSessionLinesAdded` embed `recordedServiceLine = serviceLineChanged.extend(…)`) has no such key, and the
  schemas are strict. A cross-field refinement: `change` present ⇒ `revision = change.previous.revision + 1` and `status = ACTIVE`.
- 35d-1 must pin `change` absent on `recordedServiceLine` (for example `change: z.undefined()`; it would otherwise inherit
  the optional member). Because `serviceLineChanged` becomes a refined schema, and Zod 4 refuses `.extend()` on a refined
  schema, that construction must change to `.safeExtend()` (already used in `packages/contracts/src/staff/schedules.ts`).
- Arabic doc comment on the contract and in `events/published.ts`: «يصدر مرة لكل سطر عند حفظ تعديل سعر أو خصم، في نفس
  معاملة التعديل».

**When exactly it is emitted.** In the 35d-4 edit use case's single tenant transaction — the same one that (a) updates
the line with a compare-and-set on `revision`, (b) inserts the edit-history row (ED-Q8) and the audit entry, and (c)
stores the idempotent response. One `ServiceLineChanged` outbox row per changed line; any failure (stale revision,
over-limit, window, permission) rolls everything back and emits nothing. Aggregate type `service_session`, aggregate id
the session id, like the recording events. A request that changes nothing emits nothing (whether equal values are
refused with an error is a 35d-spec detail — `TODO(spec)`, not a bell rule).

## 3. The consumer: worker `orders`, not `notifications`

`notifications` "knows nothing about the business" (module map §2): the emitting module resolves recipients and puts
them in the event, and `notifications` only stores. So the consumer is a **worker `orders`** use case, exactly the
35b-2 shape, and `notifications` changes only by registering a new source event type and a template. Notifications does
**not** consume `ServiceLineChanged` (ADR-0044 §2).

`request-price-edit-notice` (worker `orders`, consumer id `orders.price-edit-notice-v1`, event type `ServiceLineChanged`),
all inside the consumer transaction under `withTenant(event.company_id)`:

1. Parse with the shipped schema; check `aggregateType = service_session`, `session_id = aggregateId`. **Ignore** (mark
   consumed, no effect) any event whose `change` is absent or whose kind is not `PRICE_DISCOUNT_EDIT` — commissions
   and customers read the same event for other reasons.
2. `repository.matchesLine` — the line exists in this company/business/branch/session and its **current** revision is at
   least the event's (a later edit may already exist; this bell still describes *this* edit from the event's own
   before/after values). Otherwise throw `PRICE_EDIT_EVENT_INVALID`, like `LATE_SESSION_EVENT_INVALID`.
3. Closed company: skip (`companyOpen`), as 35b-2.
4. Recipients: `identity.branchManagerRecipients` at the injected `Clock` instant with the roles of the interim rule
   (ADR-0037: active, scope-covered `owner | general_manager | business_manager | branch_manager`), ED-Q9. The editor is **not**
   excluded (ED-Q10): a manager or owner who made the edit receives the bell like the others, and when the editor is the
   only eligible person the bell still goes to them.
5. Claim the ledger row `service_line_edit_notices` (§4). Lost claim ⇒ stop; the other delivery already produced the bell.
6. Zero recipients: the ledger row records `recipient_count = 0`, **no** notice event, no error, no escalation. The edit-history
   row (ED-Q8) is the permanent record.
7. Otherwise read the branch names (`tenancy.branchPlace`) and, from orders' own tables through the repository, the line's
   service-name snapshot and the session's saved `business_timezone` (the event carries `business_date` but no
   timezone, and the date is never re-derived), build the template parameters, split recipients into groups of at most 100, and append one
   `ServiceLineEditNoticeRequested` per group. The consumed mark, the ledger row and every group commit together.

**Idempotency.** First line: the outbox consumed mark per `(consumer id, event id)`, committed in the same transaction as
the appended notice events (ADR-0018). Second line: `UNIQUE(company_id, line_id, revision)` on the ledger, so a replay
that lost its consumed mark still converges to one bell. It is per `(line, revision)`, **not** per session like the late
bell: ED-Q6 says *every* edit, so a second edit of the same line, or an edit of another line of the same visit, rings
again.

**Notice event** `ServiceLineEditNoticeRequested` (new, `orders → notifications`): `schema_version: 1`, `session_id`,
`line_id`, `revision`, `business_id`, `branch_id`, `business_date`, `business_timezone`, and
`notification_recipients` (1…100 IN_APP recipients, locale `ar`, template key `service_line_price_edited`,
`template_revision: 1`, per-recipient `safe_parameters`). Registered in `NOTIFICATION_SOURCE_EVENTS`; it reaches the
existing `notificationRequestConsumer` → `StoreInAppNotification` → admin inbox/bell. No provider send, no new bell
infrastructure, no realtime in Phase 1, no `packages/notifications` import from orders.

**Safe parameters.** `displayName` in `in-app-notifications.ts` is a name filter: it rejects any seven digits even when
separators sit between them (`1250.000` fails, `125.000` passes), so it would refuse ordinary KWD amounts and is not a
money type. The template therefore gets a dedicated strict money parameter
(`/^\d{1,11}\.\d{3}$/`, canonical KWD) next to `business_date`'s `z.iso.date()`; names keep the existing display-name
filter with the generic fallback label used by the late bell. Which parameters appear (service name, previous → new net,
editor name, branch, date) is fixed by ED-Q11: service name, branch and date, «was X, now Y» (net) and the editor's
name. The editor's name is a **snapshot taken when the edit commits**, not a lookup at consume time: display names live on
`employees` (`name_ar`, `name_en`, linked by `employees.user_id`; the global `user` table is reachable from
`packages/auth` only), and by the time the outbox is processed that employee may be deactivated or relinked. So the 35d-4
edit use case reads the editor's names through an orders-owned port `EditorNamePort` (api side, a narrow `staff` export keyed
by company + business + user id, active employees only, because `employees_active_user_business_key` allows one active
employee per user in each business) and stores `editor_name_ar` / `editor_name_en` (nullable) in the immutable edit-history
row of the same transaction. The event does not carry the names; the 35d-2 consumer reads that history row by
`(line_id, revision)` through the orders repository, so the worker needs no `staff` read. An editor with no linked employee
(for example an owner who is not an employee) is stored with null names and the bell falls back to a generic translated
label, like the branch-name fallback; names pass the existing display-name filter. The `orders → staff` arrow already
exists and the exact §6 entry is declared in this PR.

**Ordering.** Consumer first, writer later (§8). No `ServiceLineChanged` carrying a `change` exists until 35d-4 merges,
so ADR-0041 §6's "later consumers must recover earlier records" obligation does not arise for the bell. The commission
and rating consumers (rows 50/59) still need the recovery ADR-0041 §6 already requires; the new event kind does not
change it.

## 4. The ledger table

`service_line_edit_notices` (orders, insert-only, FORCE RLS, `SELECT`/`INSERT` grants only):
`company_id`, `id` (UUID v7), `business_id`, `session_id`, `line_id`, `revision`, `source_event_id` (provenance, no
outbox FK, as the late ledger), `decided_at`, `recipient_count >= 0`. PK `(company_id, id)`; FKs `(company_id,
business_id, …)`, `(company_id, session_id)`, `(company_id, line_id)`; `UNIQUE(company_id, line_id, revision)`; an index
for the session FK. New tenant table ⇒ policy, privilege-allowlist entry, tenant-table inventory entry and a negative
RLS test in the same PR (CLAUDE.md §5; pipeline §5 database review applies).

## 5. Module map and ADR (declared in this PR)

- `docs/module-map.md` §4: the `ServiceLineChanged` row gains worker `orders` (price/discount-edit bell); a new
  `ServiceLineEditNoticeRequested` row `orders → notifications`.
- §3: two consumer-owned port rows for worker `orders` (`PriceEditNoticeRecipients`, `PriceEditNoticePlace`).
- §6 reads (the YAML is generated from it by `pnpm module-map:generate`): `orders → identity.branchManagerRecipients`,
  `orders → tenancy.companyOpen` at `apps/worker/src/modules/orders/persistence/price-edit-recipients.adapter.ts`, and
  `orders → tenancy.branchPlace` at `…/price-edit-place.adapter.ts`. They are separate adapter files, not reuse of the
  late-notice adapters, so each consumer owns its port (ADR-0041 35b-2 precedent) and the checker needs the exact
  `{symbol, file}` pair. These add **no new import arrow**: `orders → identity` and `orders → tenancy` already exist.
- **Why the `orders → notifications` arrow is allowed.** It is an *event* arrow (module map §1), never an import: orders
  appends to the outbox and knows none of its consumers. ADR-0044 §3 records this, and why the shared
  `ServiceLineChanged` event must not itself name `notifications` as a consumer.

## 6. Derived rules (no owner question needed)

- **One bell per saved edit.** ED-Q6 says "with every edit". No batching, digest or rate limit in 35d. If the owner later
  finds it noisy that is a new question, not something to build speculatively.
- **Edits after the monthly close ring like any other** (ED-Q3 + ED-Q6). Orders cannot know whether a month is approved
  or paid until the commission statement rows (52–55) exist, so the 35d bell carries **no** "correction" marker. Adding
  one later is an additive template revision plus one optional event field. `TODO(spec)` for the 35d spec: how the
  correction on the next month is recorded is a commissions-side rule, read from the line revision history.
- **No manager in scope = no bell**, as in §3 step 6. It is not an error and not an escalation to the owner.
- **Multi-line edits.** The consumer is per event and per line. If the 35d spec allows editing several lines in one
  request, each changed line is one `ServiceLineChanged` and one bell. `TODO(spec)`: confirm in the 35d spec whether the
  day list and the reception screen edit one line at a time.

## 7. Delivery tests (every item is a named test in 35d-2 or 35d-4)

Emit side (35d-4, real Postgres, T2 compose stack, one cloned database per spec file):

1. **Emit in the same transaction.** A committed edit leaves exactly one `ServiceLineChanged` per changed line with
   `revision = previous.revision + 1`, `change.changed_by` = the editor (not the recorder), `change.previous` equal to the
   row before the edit, and the new money equal to the stored line. A stale revision, an over-limit edit, a closed
   window and a missing permission each leave **zero** outbox rows, no history row and no audit row.
2. **Payload privacy.** The emitted key set is exactly the contract: no reason, phone, customer name or recipients.
3. **Contract compatibility.** Every payload published by 35a still parses; `recordedServiceLine` rejects a `change`.

Consume side (35d-2, tests 4–9; fixtures insert `ServiceLineChanged` rows and the edit-history snapshot row directly, like `late-notice.spec.ts`, because the writer does not exist yet):

4. **Consume once.** Deliver the same event twice (and once with the consumed mark removed): one ledger row, one set of
   notice events, one in-app row per recipient. Two edits of one line (revisions 2 and 3) ring twice; edits of two lines
   of one visit ring twice.
5. **Tenant and scope isolation.** Another tenant's manager, a manager scoped to a different branch, a membership outside
   its validity dates, a membership of another business, a non-manager role and a deactivated user never receive the bell.
   Eligibility is role membership alone (ADR-0037 interim rule, ED-Q9): `branchManagerRecipients` does not read
   permission overrides, so no DENY case is specified.
   Ledger RLS negative tests (cross-tenant read = 0 rows, cross-tenant write = error), privilege-allowlist and
   tenant-table-inventory entries.
6. **No manager.** Zero eligible recipients ⇒ ledger row with count 0, no `ServiceLineEditNoticeRequested`, consumed mark
   set, no exception. Also: the editor is the only eligible person ⇒ the bell is still sent to the editor (ED-Q10); the editor who is a manager is included among several; an editor without a linked employee gets the generic name label; the editor's name is the snapshot stored at commit, so a deactivated or relinked employee does not change an already-committed bell (a test required).
7. **Groups.** More than 100 recipients ⇒ stable groups of at most 100, all committed with the ledger row.
8. **Ignored events.** `ServiceLineChanged` with `change` absent (or another kind) ⇒ consumed, no ledger row, no bell.
   A closed company ⇒ skip. A malformed payload or a line that does not match ⇒ `PRICE_EDIT_EVENT_INVALID`.
9. **Notification side.** The template renders in ar and en; money parameters accept `"2.500"` and `"1250.000"` and reject
   `"2.5"`, a phone-like string and a URL; the in-app row is visible only to its recipient through the admin inbox API.
10. **End to end through the dispatcher** (35d-4, once the writer exists). edit → outbox → dispatcher → consumer → notice
    event → in-app row, for a branch manager, with no provider call; the bell names the editor from the history snapshot.

## 8. Sub-PR split (owner rule 2026-10-12: at most three subtasks per PR, small enough to review)

Consumer **before** writer. Sizes are hand-written lines including tests and copy; generated OpenAPI/client changes are
reported separately. If an estimate is exceeded, split again before code.

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **35d-1** | Contracts, template and registrations; no behaviour | 1. `ServiceLineChanged.change`, `ServiceLineEditNoticeRequested`, recipient and money-parameter schemas, OpenAPI. 2. `packages/notifications` template, `packages/i18n` ar/en keys, admin bell render, including the editor-name parameters. 3. Register the notice event in `NOTIFICATION_SOURCE_EVENTS` and the worker's known types; Arabic doc comments | — (ED-Q11 answered); #249 (money kind in the template validator) | 250–380 |
| **35d-2** | The bell works for any `ServiceLineChanged` carrying a `change` | 1. Migration + RLS + grants for `service_line_edit_notices`. 2. Worker `orders` use case, domain functions (recipient groups, parameters), ports, the two adapters (recipients, place), the repository read of the edit-history row (editor-name snapshot), consumer registration. 3. Delivery tests 4–9, privilege and inventory entries | 35d-3 (the edit-history table with the editor-name snapshot columns); ED-Q9, ED-Q10 answered | 400–550 |
| **35d-3** | Permission and storage for edits | 1. «Edit session price/discount» permission and its four default roles (ED-Q1). 2. Edit-history table (ED-Q8 storage; includes the nullable `editor_name_ar` / `editor_name_en` snapshot): insert-only, FORCE RLS, explicit `SELECT, INSERT` grants to `pospay_app` after the usual revoke, as the other orders tables. 3. A narrow **column-level `UPDATE`** grant for `pospay_app` on `service_lines` (migration 0131 grants `SELECT, INSERT` only): `price`, `discount`, `net`, `effective_discount_bps`, `limit_bps_applied`, `limit_source` and `revision`, nothing else (the three limit columns change together with the editor's limit per ED-Q2, so `service_lines_limit` and `service_lines_limit_presence` keep holding; the recorder's original values stay in the history row), plus the grant allowlist, inventory and negative tests | — | 300–450 |
| **35d-4** | `PATCH` one line's price/discount, audited | 1. Pure domain functions: editor limit (ED-Q2), window (ED-Q3), self-line rule (ED-Q4), reason (ED-Q5). 2. Use case + HTTP adapter + `Idempotency-Key`, outbox emit in the same transaction. The edit authority is rechecked inside the locked transaction through an orders-owned `SessionEditAccessPort` (`lock()` then `read()` of the selected editor membership, the new permission, DENY state and the orders feature, as recording does with `tx.access`), after every line and performer wait and before an idempotency replay is returned (revocation test required). The self-edit rule (ED-Q4) calls `PerformerCheckPort.lock(employeeIds)` (`FOR SHARE` on the employee rows) and then re-reads the line's performers' persisted user links in that transaction (saved `line_performers` hold employee IDs only), never from the request (concurrency test required). The editor's names are read through `EditorNamePort` and stored in the history row (snapshot, two-business editor test). 3. Delivery tests 1–3 and 10 and the edge cases | the 35d spec; 35d-1, 35d-2 (the consumer must be merged first), 35d-3 | 450–600 |
| **35d-5** | Edit from the branch day list (ED-Q7) | 1. Guarded history read: contract, query under `read:service-sessions:branch`, route and EXPLAIN test (ED-Q8 data; the day-list line contract carries only current money). 2. Admin form and hook. 3. ar/en keys, component tests | 35d-4 | 250–380 |
| **35d-6** | Edit on the reception screen + «changed» badge and history (ED-Q7, ED-Q8) | 1. Edit for just-saved lines. 2. Badge + before/after/who/when panel. 3. Tests and keys | 35d-4, 35d-5, ED-Q12 | 300–450 |

`TODO(spec)` for 35d-6: the history read of 35d-5 needs `read:service-sessions:branch`, which a receptionist with only the recording and edit permissions lacks (SS-Q17). How the reception screen gets the history of lines she just saved or edited (the edit response carrying it, or a narrow read limited to her own just-saved lines) is an authorization rule for the 35d spec, not decided here. The owner question is ED-Q12 (batch 23, number 32) and 35d-6 stays blocked on it.

Order: 35d-1 and 35d-3 first (contracts; permission and storage — disjoint paths, and 35d-3 adds the first migration) →
35d-2 (the consumer reads the history snapshot, so it needs 35d-3; it adds the second migration, numbered at merge, and
there is still no writer) → 35d-4, which starts only after 35d-2 has merged, so no edit event exists without its
consumer (ADR-0044) → 35d-5 → 35d-6. The 35d spec (`/speckit-specify`, extending spec 050) is written
before 35d-4 and carries the `TODO(spec)` items above.

## 9. Owner questions (batch 22 answered; batch 23 pending)

| Id | Question | Recommended |
|---|---|---|
| ED-Q9 | Who gets the bell? | **answered:** the same four scoped manager roles as the late-visit bell |
| ED-Q10 | Does a manager who made the edit get a bell for it? | **answered:** yes, everyone including the editor (against the recommendation) |
| ED-Q11 | What does the bell say? | **answered:** service, branch, date, «was X, now Y» (net) and the editor's name |
| ED-Q12 | What edit history does a receptionist without branch-read permission see for lines she just saved or edited: the edit response carries it, a narrow own-lines read, or only the «changed» badge? | the edit response carries it, no new read |

Waleed answered ED-Q9…ED-Q11 on 2026-10-16; Abu Salem has not, and his pick replaces Waleed's if it differs (the
recipient rule, the editor handling and the template wording are small, isolated pieces of 35d-2 and 35d-1). Nothing
blocks 35d-1 or 35d-2; only ED-Q12 (batch 23) gates 35d-6.
