# Spec 060 — The staff app "my" pages, customer ratings and the alert rules (Phase 1 rows 57, 57b, 57c, 58–62)

> **Status:** Draft · 2026-10-21 · docs-only PR. **PP-18 batch 1 answered (Waleed, 2026-10-21):** RT-Q1 **postpones the whole rating track to the end of the
> project**; RT-Q2…RT-Q10 and RT-Q12 are decided for the postponed track (RT-Q6 and RT-Q10 against the recommended
> options); RT-Q11 is postponed with RT-Q1.
> PP-18 batch 4: MY-Q1…MY-Q4 answered (MY-Q1 and MY-Q2 against the recommended options). Batch 5: MY-Q5, MY-Q7, MY-Q8
> and RT-Q13 (PP-20.4, for the postponed track) answered (MY-Q5, MY-Q7 and RT-Q13 against the recommended options).
> PP-18's last batch (2026-10-21): AL-Q1…AL-Q6 and the RT-Q7 follow-up answered (AL-Q1, AL-Q2 and the follow-up against
> the recommended options); MY-Q9 answered as PP-21.1 (against the recommended option).
> **1 owner question remains open** (MY-Q6, PP-18.6); **MY-Q6** (what an employee sees of her approved earnings) is also a money
> question and is in the money list for Abu Salem ([owner-questions.ar.md](owner-questions.ar.md)). Every rule that waits on an answer is marked `TODO(spec)` here and
> blocks only the sub-PRs named in §3. **No code starts before this spec is merged.**
> **Two parts:** **Part A** — the staff app (rows 57, 57b, 57c). **Part B** — ratings and alerts (rows 58, 59, 59b, 60,
> 61, 62). Each part has its own decisions, tests, requirements and sub-PR plan; §1–§3 and §8–§9 are shared.
> **Governed by:** [SPEC §2–§4, §10–§12](../phase-1/SPEC.md), PRD D-30, D-38, D-39, D-41, D-43, D-46, D-47, D-52,
> D-57, D-58, [ADR-0010](../../adr/0010-phase-1-ports-and-events.md), [ADR-0011](../../adr/0011-public-rating-link.md)
> (with `CLAUDE.md` §5, the fourth session-less entry point), [ADR-0013](../../adr/0013-passkey-and-platform-suppression.md),
> [ADR-0018](../../adr/0018-notification-delivery.md), [ADR-0026](../../adr/0026-employee-own-leave-access.md),
> [ADR-0027](../../adr/0027-personal-staff-session.md), [ADR-0037](../../adr/0037-not-clocked-in-alert-discovery-and-recipients.md).
> **Relates to:** [spec 050](../050-orders-record-service-session/spec.md) (sessions, `business_date`, SS-Q12, the
> recording events rows 50/59 consume), [spec 055](../055-orders-change-line-performers/spec.md) (a performer change
> before the claim changes who is rated; after it, nothing — SPEC §10), [spec 033](../033-staff-document-expiry-job/spec.md)
> (row 62's one-time recipient attachment contract), [spec 036](../036-staff-not-clocked-in-alert/spec.md) and
> [spec 039](../039-permissions-documents-owner-default/spec.md) (interim rules and recipients row 62 replaces).
> **Depends on:** rows 17, 22 (merged), 34 (merged), 35 (merged), 4/4b/5 (merged), G3 (ADR-0011, accepted); **row 50**
> (commission projection and estimate on read) for the estimate only; rows 15, 28 (merged) for row 62.
> **Consumed later by:** row 28b (staff web push needs the staff app shell of 57b), row 28c (its lead time lives in
> row 62), row 56b (statement reminders read row 62's rules). **Any alert emitter merged after 62-1 (rows 52/53, 56b included)
> takes recipients from `AlertRulesPort` in its own slice; one merged before is moved by sub-PR 62-2c.**

## 1. What and why

The salon owner's pains are attendance and commissions (SPEC §1). This spec gives each employee one place on her own
phone to see what she did and what she is likely to earn, and gives the owner a customer's voice after each visit
without letting that voice touch commission (D-41, D-14).

**Worked example (salon «صالون الأميرة», branch السالمية, `Asia/Kuwait`, opening hours 10:00–22:00).**

- **Staff app.** سارة (hair) opens PosPay on her own phone, signs in with the WhatsApp code (ADR-0027) and sees «شغلي»:
  this month's lines she performed — date, time, service, the customer's first name «نورة», her share and the estimated
  commission, as the manager ليلى allowed in the staff-columns setting (D-47). The phone of نورة never appears (D-43).
  She also sees «حضوري» (her clock-ins this month, a «متأخرة 12 دقيقة» note on Monday, a «اتعدّل» mark on a day the
  manager corrected) and «إجازاتي» (request, cancel, and the status of her leave requests — the API already exists,
  ADR-0026).
- **Ratings.** نورة had a صبغة at 15:10 with سارة and رنا (70/30). At 16:10 (`due_at` = 15:10 + 1 h, before the 22:00
  close) the job claims her request, reads her active lines through `DaySessionsPort`, snapshots سارة and رنا, and sends
  one WhatsApp message with a link. نورة opens it: the page shows only «صالون الأميرة» and five stars (ADR-0011 §4). She
  gives 2 stars and writes «الصبغة طلعت غامقة». Both سارة and رنا get the 2 stars in their average (SPEC §10); ليلى
  gets a low-rating bell (≤ 2 stars, D-41); the comment is visible to whoever holds `read:service-sessions:branch` for that
  branch (ليلى, the owner, and reception if granted it), never to سارة or رنا in the staff app (ADR-0011 §8, FR-B15). Their commission does not move (D-14).
- **Alert rules.** The owner opens «التنبيهات»: one row per alert kind with on/off, recipients, channels and the delay
  or lead time, plus one master switch (D-47). Turning «تقييم منخفض» off stops the bell to ليلى from the next rating on.

## 2. Already decided — cited, not re-asked

| Ref | Rule | Source |
|---|---|---|
| S-1 | Low rating = **≤ 2 stars**; it emits `LowRatingReceived` only if the alert is on | SPEC §10, D-41 |
| S-2 | One request per customer **per business** per day; the day and closing time come from the branch of her **last** session that day; `due_at = min(last session + 1 h, closing)`; each new session moves it; `send_deadline = closing + 30 min`; **no deadline when opening hours are unset**; past the deadline → `CANCELLED (PAST_DEADLINE)`, never the next day | SPEC §10, D-30, D-52, D-58 |
| S-3 | Transitions SCHEDULED → SENDING → SENT; SCHEDULED → CANCELLED; `NO_ACTIVE_LINE` reopens before the deadline; `PAST_DEADLINE`, `OPTED_OUT`, SENDING and SENT are terminal | SPEC §10 |
| S-4 | The claim is authoritative: `DaySessionsPort` read at claim time; attribution fixed at the claim; a cancel after the claim does not remove a performer; a session after it is not rated | SPEC §10, D-52 amended, ADR-0010 |
| S-5 | At most once end to end: `FOR UPDATE SKIP LOCKED` claim, attempt row committed before the provider call, a redelivery with an attempt row is not resent; a lost rating is acceptable, a duplicate is not; `notifications` refuses after `send_deadline` (attempt `EXPIRED`) | SPEC §10, ADR-0018 §1 |
| S-6 | Every performer in the snapshot gets the stars; her average is the mean of the ratings attributed to her; ratings never change commission | SPEC §10, D-41, D-14 |
| S-7 | Token `<company_id>.<256-bit random>`, only its SHA-256 stored, 7-day life from issuance, single use by an atomic `UPDATE … WHERE consumed_at IS NULL`, same token opts out until expiry (also after rating), per-IP limit **30 requests/IP/minute** shared by all rating operations, generic bilingual 429 with `Retry-After` | ADR-0011 §1–§4, §7 |
| S-8 | The page shows **only the business name and the stars form** (1–5 stars, optional comment, submit, opt-out); comment = optional plain text ≤ 1,000 characters, no links or images; `no-store`, `no-referrer`, no trackers, no indexing | ADR-0011 §4 |
| S-9 | **Comments never reach the staff app or a public response**; in the admin they are visible to every holder of `read:service-sessions:branch` in its scope (amended 2026-10-21, RT-Q7 follow-up: «أي حد معاه الصلاحية»; it replaced the earlier owner/manager-only rule). This owner decision **overrides the `rating_comments` staff column** that SPEC §4 still lists (see §9, amendment 1) | ADR-0011 §4, §7, §8 (Waleed, 2026-10-02 and 2026-10-21) |
| S-10 | Page opt-out sets `customers.opted_out_at` at once and blocks every later claim; it is company-wide (one customer per company); a WhatsApp STOP is the separate global suppression; at most one request per business already claimed that day may still be delivered | SPEC §10, ADR-0011 §3, ADR-0013 |
| S-11 | The employee sees **her own** average; she sees her own commissions; reception is like any employee plus the entry screen | D-41, D-46, SPEC §11 V1–V2 |
| S-12 | Staff see the customer's **name only**; the phone is masked to the last 3 digits everywhere except the entry form and is never a staff column, an export or a log line | D-43, SPEC §4, SPEC §11 R1 |
| S-13 | The employee's normal view is **her own services only, with the allowed columns, without the customer's phone**; reading the whole branch's sessions is `read:service-sessions:branch` (four manager roles, grantable by the owner) | spec 050 SS-Q12 (Waleed, 2026-10-12) |
| S-14 | The manager picks which columns the staff app shows, **one setting per business**; the allowed codes are SPEC §4's list | D-47, SPEC §4 |
| S-15 | The estimate is computed on read (never stored); no plan → the estimate says «مفيش خطة» (never a silent zero); a whole-period plan version → the staff app says the calculation changed | SPEC §6, D-57, D-38 |
| S-16 | Every alert kind has on/off, recipients, channels (WhatsApp, email, in-app) and its delay or lead time, plus a **master switch**; every alert can be switched off alone and all at once | D-47, SPEC §12 |
| S-17 | Not-clocked-in: on, 20 min after shift start, the four scoped manager roles, in-app, **no email** | D-47, spec 036 NC-Q1, NC-Q2, NC-Q4, ADR-0037 §3 |
| S-18 | Document-expiry alerts go only to holders of `read:files:business`; row 62 attaches recipients **once** to notices emitted without them (the spec 033 contract) | spec 039 OD-Q3, spec 033 "PR 62 contract" |
| S-19 | Staff private access is online only: no private data persisted or synced in the PWA; caches cleared on logout/replacement | `CLAUDE.md` §7 (ADR-0019), ADR-0027 |
| S-20 | Leave: request, cancel and list own requests already exist (`staff/me/leave-requests`, kiosk and personal sessions); no leave balance in Phase 1 | ADR-0026 |

## 3. Open owner questions and what each blocks

All are in [owner-questions.ar.md](owner-questions.ar.md) with options and a recommended option. MY-Q6 is a money
question (what staff earn, `CLAUDE.md` §1 5b) and goes to Abu Salem too; the others are Waleed's. Until an answer arrives the rule is `TODO(spec)` and only the sub-PRs listed here wait.

| ID | Subject | Blocks |
|---|---|---|
| MY-Q1 | My pages on the personal phone only, or also on the reception device after PIN | **Answered (PP-18.1): both, the reception device after the PIN** — against the recommended option (D-A13, sub-PR 57-0) |
| MY-Q2 | How many months back the staff app shows | **Answered (PP-18.2), custom: a per-business admin setting**; default the current month plus the previous one (D-A14) |
| MY-Q3 | Default columns when the manager has not chosen | **Answered (PP-18.3): her work and her money only** (D-A6) |
| MY-Q4 | May the column setting hide the estimate | **Answered (PP-18.4): yes, an ordinary column, shown by default** (MY-20) |
| MY-Q5 | Who edits the staff-columns setting | **Answered (PP-18.5): the existing `manage:settings:business`**, for the columns and the months-back setting — against the recommended option |
| MY-Q6 | What a closed (approved) month shows: the approved amount or the estimate | 57-3, 57-5 |
| MY-Q7 | What the employee sees of a manager's attendance correction | **Answered (PP-18.7): every detail** (time before and after, reason, who edited) — against the recommended option (D-A10) |
| MY-Q8 | Cancelled lines in «شغلي»: shown with a mark, or hidden | **Answered (PP-18.8): shown struck through** (MY-07) |
| MY-Q9 | The months-back setting's default and allowed range (D-A14) | **Answered (PP-21.1): «شهر، ولحد 24»** — the current month by default, 1–24 — against the recommended option |
| RT-Q1 | How the rating link reaches the sender without storing the token (ADR-0011 open question 1) | **Answered (PP-18.9): rating messages are postponed to the end of the project**, so the whole rating track (Part B rows 58–61 and the low-rating part of 62-3) waits; against the recommended option |
| RT-Q2 | Approval of the ar/en copy: WhatsApp message, page, completion, opt-out, unavailable link | **Answered (PP-18.10): approved as proposed** (§B.4 copy); used when the track resumes |
| RT-Q3 | A per-business switch for sending rating requests, and its default | **Answered (PP-18.11): a switch, off at first** (D-B16); used when the track resumes |
| RT-Q4 | Which closing time counts when a day has two opening periods, and which day an overnight interval (its close and its post-midnight visits) belongs to (after-close behaviour is settled by S-2) | **Answered (PP-18.12): the last close of the day; an overnight interval belongs to the day it started** (D-B3); used when the track resumes |
| RT-Q5 | A visit recorded after its day ended (late entry): rated or not | **Answered (PP-18.13): no message**, with or without opening hours (RT-05) |
| RT-Q6 | The average's window and the minimum count before an employee sees it | **Answered (PP-18.14, PP-18.15): the last 90 days; shown from the first rating** — both against the recommended options (D-B12) |
| RT-Q7 | Who reads ratings, averages and comments in the admin | **Answered (PP-18.16): the existing `read:service-sessions:branch`**, no new permission; its follow-up (2026-10-21): comments for **every** holder, «أي حد معاه الصلاحية» (FR-B15, ADR-0011 §8) |
| RT-Q8 | The low-rating alert before the alert-rules screen exists | **Answered (PP-18.17): on, in-app, the four managers in the visit branch's scope** (the recommended interim rule; RT-22) |
| RT-Q9 | What the low-rating alert shows | **Answered (PP-18.18): stars, branch, date, performers' names, the customer's name and the last 3 phone digits; the comment in-app only**, WhatsApp/email say «there is a low rating, open PosPay» (the recommended option; RT-23) |
| RT-Q10 | May reception or a manager undo a customer's opt-out | **Answered (PP-18.19): reception and the manager may turn a customer's rating messages back on, logged with who and when** — against the recommended option; new postponed sub-PR 58-3 |
| RT-Q11 | Where the public rating page is hosted | **Postponed with RT-Q1, not asked now** (was: 60-2) |
| RT-Q12 | The message names the performers (first names) when there are several | **Answered (PP-18.20): all first names; more than 3 → «the team of <business>»** (the recommended option; D-B6) |
| RT-Q13 | Who may switch rating requests on or off for a business (D-B16) | **Answered (PP-20.4): the alert-rules permission**, which AL-Q1 (PP-18.21) made `manage:settings:business` — against the recommended option; a decision for the postponed track (59-2) |
| AL-Q1 | Who edits the alert rules | **Answered (PP-18.21): «نفس «إدارة الإعدادات»»**, the existing `manage:settings:business`, no new code — against the recommended option |
| AL-Q2 | Alert rules per business or per branch | **Answered (PP-18.22): «نشاط، والفرع يغيّر»**, business rules a branch may override (D-B13) — against the recommended option |
| AL-Q3 | Recipients chosen by role or by named person | **Answered (PP-18.23): by role** (recommended) |
| AL-Q4 | What the master switch covers | **Answered (PP-18.24): team alerts only** (recommended); rating requests keep their own switch (D-B16) |
| AL-Q5 | The default of every alert kind (the table in §B.4) | **Answered (PP-18.25): approved** (recommended) |
| AL-Q6 | Email/WhatsApp to team members: in row 62, or later after a contact-read ADR | **Answered (PP-18.26): later, in row 62b** (recommended); row 62 is in-app only |

---

# Part A — The staff app (rows 57, 57b, 57c)

## A.1 Scope and decisions record

**In:** «شغلي» (my lines and their estimate, row 57), «حضوري» and «إجازاتي» (row 57b), the staff-columns setting and its
admin screen (row 57c). All in `apps/pos` behind the ADR-0027 personal session, one screen per slice.

**Not in Part A:** push subscriptions and reminders (rows 28b/28c); the employee's IBAN (spec 040 IB-Q6: a later row of
its own); requesting an attendance correction from the app (row 26a is manager-initiated); a leave balance (ADR-0026);
the statement PDF or Excel (rows 56, 27g); anything about other employees.

| ID | Decision (technical; none is an owner question) | Alternative rejected |
|---|---|---|
| D-A1 | **Each module serves its own "my" read**: orders serves my lines (it owns lines, performers, customer id and already reads catalog, customers and settings by port, ADR-0041), commissions serves the estimate per line and in total, customers serves my rating average, staff serves my attendance. The POS screen calls them side by side and joins the estimate to a line by `line_id` for display only | one aggregating endpoint (it would need a module reading three others, an arrow nobody declared); commissions serving the whole line list (customer names and prices are not in its projection and must not be, SPEC §4 `CommissionLine`) |
| D-A2 | **Columns are enforced on the server.** Every "my" read loads the business's staff columns through `StaffColumnsPort` in its own transaction and omits a disallowed field from the response; the client only renders what it receives (`CLAUDE.md` §8: never only in the UI) | filtering in the POS (a hidden column would still travel to the phone) |
| D-A3 | `StaffColumnsPort` consumers: commissions, customers and staff (approved in ADR-0010 §2; staff reads `monthsBack` for «حضوري», D-A14) and **orders, which ADR-0010 does not list**: orders' port is a new port and needs an **ADR-0010 addendum before any code** (ADR-0010 requires an ADR before a new port), shipped as docs PR **A-0** (§A.5) together with worker orders' `AlertRulesPort` (D-B14). The adapter edges are then added to `module-map.md` §2/§3 and its YAML in the sub-PR that first uses them | a shared helper in `packages/` (settings data read outside the settings module) |
| D-A4 | **New own permission codes**, following ADR-0026 (an own code is refused unless the actor's user is the subject employee's user; owner immunity and covering DENY as ADR-0026): `read:service-sessions:own` (orders), `read:commissions:own` (commissions), `read:attendance:own` (staff), `read:ratings:own` (customers). Defaults: every human role, like `read:leave:own` (`role-defaults.ts`, `humans`), which is what D-46 and S-11 say; devices forbidden. A per-person DENY hides one employee's page | reusing branch read codes (they would show colleagues' rows, against S-13) |
| D-A5 | **ADR-0027 addendum** (sub-PR 57-1): ADR-0027 lists the personal purpose's own-scope capabilities as "schedule/leave; later attendance challenge/assertion". The four reads of D-A4 are added to that list explicitly, with the same live employee and membership recheck on every request | enabling them silently on `PERSONAL_ROUTE` |
| D-A6 | Storage of the column setting: a nullable `staff_columns text[]` on `business_settings` (one row per business, D-47), `NULL` = the MY-Q3 default (PP-18.3: `date, time, service, customer_name, share, estimated_commission, tip, rating_average`, without `list_price`, `discount` and `net`; `rating_average` stays hidden until the rating track ships, D-A7) (the `business_settings` "null = template" pattern), a `CHECK` that every element is an allowed code and there are no duplicates; every change audited (`CLAUDE.md` §8, settings) | a new table (one value per business does not need one) |
| D-A7 | **Allowed codes:** `date, time, service, customer_name, list_price, discount, net, share, estimated_commission, tip, rating_average`. `rating_comments` is **not** an allowed code (S-9). **`rating_average` stays hidden until the rating track ships (RT-Q1, PP-18.9):** the code exists in the enum, but the column screen does not offer it, a saved set that names it is refused, and «شغلي» never returns it. `customer_phone` never exists as a code (S-12). **Context fields outside the setting:** every row of «شغلي» always carries `line_id` and the branch name (the employee's own workplace, needed to tell two branches apart), and a cancelled line also carries `cancelled: true` and `cancelled_at` (MY-07, MY-Q8), whatever columns are hidden; every other field is one of the codes above | keeping `rating_comments` because SPEC §4 lists it (the later owner decision in ADR-0011 overrides it) |
| D-A8 | A line belongs to «شغلي» when the employee is a **current** performer of it (her `line_performers` row), in the line's business, in the month asked, by the session's `business_date`. Her **share** is her `share_bps` of the line; money fields are canonical KWD strings (spec 050) | listing every visit she touched (removed performers see nothing after a performer change, spec 055) |
| D-A9 | The month is a business-timezone calendar month (`YYYY-MM`), like statements (SPEC §5). Default = the current month at the injected Clock | a rolling 30 days (does not match the statement) |
| D-A10 | «حضوري» shows her attendance sessions by `working_date`: branch name, clock-in, clock-out, `late_minutes` (already stored on the session), source (QR / card), open exceptions by kind (no notes), and, for a session a manager corrected (spec 035), every detail (MY-Q7, PP-18.7, against the recommended option): the time before and after, the written reason and the name of who made the edit. Lateness is shown, never deducted (SPEC §7) | recomputing lateness on the phone |
| D-A11 | «إجازاتي» uses the existing ADR-0026 routes unchanged; Part A adds only the POS screens and their tests | a second leave API |
| D-A13 | **«شغلي» and «حضوري» also open on the shared reception device (MY-Q1, PP-18.1)**, through the ADR-0019 `STAFF_POS` operator session after her PIN, besides the ADR-0027 personal session. Because that device is shared and its session is 8 hours with no idle timeout, these private screens get their own short window: opening one asks for the PIN again (a fresh PIN proof, at most 60 s old), the server grants a **private-view window of at most 5 minutes** bound to that session and operator, and every «شغلي» or «حضوري» read (FR-A01…FR-A04) on `STAFF_POS` is refused without a live window (route policy FR-A06b). **The 60 s idle limit is enforced by the server, not by the tab:** the auth-owned window record holds `opened_at` and `last_activity_at`; every «شغلي» or «حضوري» request on `STAFF_POS` passes only when `now − last_activity_at ≤ 60 s` and `now − opened_at ≤ 5 min`, and a passing request sets `last_activity_at = now` (each request extends the window by 60 s from its own time, never past 5 minutes from the opening); a request after 60 s without one is refused (401) and the window is closed, so a killed tab, a lost connection or a bypassed client never keeps it open. While the screen has input it sends a throttled activity touch (at most one every 20 s) on the same route policy, so the server clock follows real use. Leaving the screen, sign-out or operator replacement also close it and clear the screen and the query cache in every tab (ADR-0019's replacement clearing). Responses are `no-store` and nothing is persisted (S-19). The window is a new rule for ADR-0019 (which has no idle timeout) and ADR-0027 (which lists own reads for the personal purpose only), so **sub-PR 57-0 adds the ADR-0019/0027 addendum before any code**. «إجازاتي» is not affected: its ADR-0026 kiosk and personal routes (D-A11) need no window and keep their behaviour | personal phone only (the recommended option, not chosen); the 8-hour operator session with no extra step (any colleague at the counter would see her commission) |
| D-A14 | **How many months back (MY-Q2, PP-18.2, custom answer):** a per-business admin setting `staff_months_back smallint NULL` on `business_settings`, with `CHECK (staff_months_back BETWEEN 1 AND 24)` and a `NULL` default that means 1, the current month only (MY-Q9, PP-21.1: «شهر، ولحد 24»). It counts calendar months in the business timezone (D-A9), the current month included; the «شغلي» and «حضوري» reads (FR-A01…FR-A04) and MY-13 use it, and «إجازاتي» (D-A11) is not limited by it; `StaffColumnsPort` returns it with the column set. It sits on the column-settings screen under `manage:settings:business` (MY-Q5, PP-18.5); changes are audited `settings.staff_months_back_changed` | a fixed window (Waleed asked for an admin option) |
| D-A12 | Plan order: **57c-1 (the column setting's storage and port) comes before 57-2**, because every "my" read needs `StaffColumnsPort`. IMPLEMENTATION-PLAN splits row 57c accordingly: 57c-1 does not depend on row 57, and the rest of 57c (the admin screen, 57c-2) still does | building 57-2 on a hard-coded column list and changing it later |

## A.2 User scenarios and acceptance criteria

Named tests; integration tests against real Postgres (T2 stack) unless marked unit or UI. سارة and رنا are employees,
منى the receptionist (cashier), ليلى the branch manager, the salon's owner «المالك».

### Story A1 — سارة sees her own lines and estimate (P1)

- **MY-01** سارة signed in with a personal session asks for this month: she gets exactly the lines whose current
  performers include her, newest first, with only the allowed columns. رنا's lines that سارة did not perform never
  appear; a line shared by both appears for both, each with her own share.
- **MY-02** A field outside the allowed columns is **absent** from the response (not `null`), for every code of D-A7;
  the D-A7 context fields (`line_id`, branch name, and `cancelled` / `cancelled_at` on a cancelled line) are always present.
  A UI test asserts the hidden column is not on the screen (`CLAUDE.md` §9).
- **MY-03** No response, log line or error of these routes contains a customer phone, a colleague's id or name, or a
  comment (S-9, S-12). A contract test checks the response schema has no such field.
- **MY-04** `customer_name` shows the customer's name only; a customer with an opt-out still appears (opt-out concerns
  ratings, spec 050).
- **MY-05** (row 50, blocked) With `estimated_commission` allowed, the estimate card shows the total of the current
  DRAFT month for her and the estimate per line; with it hidden the response carries **no figure at all** (neither
  total nor per line) and the card is not shown; it equals the engine on the DRAFT projection (SPEC §6). `NO_PLAN` / `NO_SALARY` show
  «مفيش خطة عمولة لسه» and no number (D-57). A whole-period version shows «الحساب اتغيّر» (D-38).
- **MY-06** `TODO(spec)` MY-Q6: a closed month shows the approved amount or the estimate.
- **MY-07** MY-Q8 (PP-18.8): a cancelled line is shown struck through with «اتلغت» and its cancellation date, and no
  commission.
- **MY-08** Tips: with `tip` allowed, her own tips of the month by method (cash / card) from her own tip rows; never a
  colleague's tip.

### Story A2 — Access (P1)

- **MY-09** No personal session, an expired session (8-hour absolute life), a reception-device (`STAFF_POS`) session without a live private-view window (D-A13), a
  device, an admin cookie, or a session of another business → 401/403, nothing returned.
- **MY-10** The employee was deleted, unlinked from the user, or her membership expired after sign-in → 403 at the
  recheck of that request (ADR-0027).
- **MY-11** A per-person DENY of `read:service-sessions:own` (or `read:commissions:own`) hides that page for that
  employee only; the owner's immunity follows ADR-0026.
- **MY-12** A request naming another employee, a branch she is not attached to, or a foreign business → uniform 403;
  no client field selects the employee (the server takes it from the session).
- **MY-13** A month before the business's `staff_months_back` window (D-A14) → 422 `MY_PERIOD_OUT_OF_RANGE`; a
  malformed month → 400. Unset (`NULL`): the current month passes and the previous one → 422 (MY-Q9). Saving 3 lets the
  previous two months through and refuses the fourth; saving 24 lets 23 previous months through; 0 and 25 → 422 (and
  the `CHECK` refuses them in the database); «إجازاتي» lists are not limited.
- **MY-13b** Reception device (D-A13): سارة on the shared device enters her PIN → «شغلي» shows her lines; after 60 s idle
  the screen returns to the PIN step and the query cache is empty; a request after the 5-minute window or after منى
  replaces her as operator → 401 and nothing returned; a stale PIN proof (over 60 s) does not open a window. **Killed
  tab:** the tab is closed without sending the close request → a request 61 s after the last one → 401 and the window
  is closed on the server; requests every 50 s keep it open, and the first one past 5 minutes from the opening → 401.
  The same
  for «حضوري»: after her PIN it shows her sessions, after 60 s idle the screen returns to the PIN step with an empty
  cache, and `GET /v1/staff/me/attendance` outside a live window → 401. «إجازاتي» on the same device opens with no PIN
  step, as today (D-A11).

### Story A3 — My attendance and my leave (P1)

- **MY-14** «حضوري» lists her sessions of the month by `working_date` with D-A10's fields; an open session shows
  «لسه ما بصمتيش خروج»; a `MISSED_OUT` session shows «خروج ناقص»; a voided session (row 26c) is not shown.
- **MY-15** MY-Q7 (PP-18.7): a corrected session shows «اتعدّل», the time before and after, the reason and who edited
  it; an uncorrected session shows none of these.
- **MY-16** «إجازاتي» requests, cancels a pending request and lists her requests through the ADR-0026 routes; errors
  are the existing named errors; a UI test asserts the visible status of each request.

### Story A4 — The staff-columns setting (P1/P2)

- **MY-17** With nothing saved, every read uses the MY-Q3 default (D-A6): no `list_price`, `discount` or `net`; `rating_average`
  not returned while the rating track is postponed.
- **MY-18** A holder of `manage:settings:business` (MY-Q5) saves a column set; the next read of every employee of that business
  follows it; one audit entry `settings.staff_columns_changed` with before/after codes.
- **MY-19** An unknown code, a duplicate, `rating_comments` or `customer_phone` → 422 `STAFF_COLUMNS_INVALID`;
  nothing saved.
- **MY-20** MY-Q4 (PP-18.4): `estimated_commission` is an ordinary toggle, shown by default; saving a set without it hides
  the estimate card (57-5).
- **MY-21** A caller without the permission, a device, or another business → uniform 403.

### Edge cases

- An employee attached to two branches sees her lines of both, each with its branch; the setting is per business.
- An employee in two businesses of the same company sees only the business of her session (ADR-0027 workspace).
- A line recorded late (D-49) appears under its own `business_date`, with the «متأخرة» mark.
- A performer change (spec 055) that removes سارة removes the line from her list from that revision on.
- Offline: the screen shows «محتاج إنترنت» and keeps nothing (S-19).

## A.3 Requirements

- **FR-A01** `GET /v1/staff/me/service-lines?month=YYYY-MM&cursor&limit` (orders, `queries/`): her current-performer
  lines of the month in the session's business, projected by `StaffColumnsPort` (D-A2), cursor-paginated, newest first.
  Guarded by `@Authenticated()` + `PERSONAL_ROUTE` + an explicit own check of `read:service-sessions:own` (ADR-0026),
  feature `orders`.
- **FR-A02** (blocked on row 50) `GET /v1/staff/me/commission-estimate?month=YYYY-MM` (commissions, `queries/`):
  `{ status: 'ESTIMATE' | 'NO_PLAN' | 'NO_SALARY' | TODO(spec) MY-Q6, total?, per_line?: [{ line_id, amount }],
  recalculated?: boolean }`, computed on read by the engine (S-15); `total` **and** `per_line` only with
  `estimated_commission` allowed, otherwise `{ status: 'HIDDEN' }` with no amount (D-A2); `read:commissions:own`, feature `commissions`.
- **FR-A03** `GET /v1/staff/me/tips?month=YYYY-MM` (orders): her tips of the month by method, only with `tip` allowed,
  under `read:service-sessions:own`.
- **FR-A04** `GET /v1/staff/me/attendance?month=YYYY-MM` (staff, `queries/`): D-A10's fields; `read:attendance:own`,
  feature `staff`.
- **FR-A05** **POSTPONED with the rating track (RT-Q1):** `GET /v1/staff/me/rating-summary` (customers, Part B FR-B14): only with `rating_average` allowed.
- **FR-A06** Every FR-A route resolves the employee from the session server-side (ADR-0027), samples the Clock once,
  rechecks the employee, membership and own permission inside the read transaction, and returns `no-store`.
- **FR-A06b** Route policy of FR-A01…FR-A04 (D-A13): today `PERSONAL_ROUTE = true` makes `SessionGuard` call
  `personalSessionRequest` at once (`apps/api/src/shared/session.guard.ts`), so a `STAFF_POS` session would be refused
  before any window check. These routes use the combined `PERSONAL_ROUTE = 'staff'` policy the ADR-0026 leave routes
  already use (Authorization supplied → the `STAFF_POS` operator path, otherwise the personal session; never an admin
  fallback), plus one more check on the `STAFF_POS` path: a live private-view window for that session and operator
  (within 60 s of its last request and 5 minutes of its opening; a passing check extends it, D-A13), otherwise 401. The `SessionGuard` change is named in the 57-0 addendum and built in 57-1; the leave routes keep their
  policy with no window check.
- **FR-A07** `GET/PUT /v1/businesses/:businessId/settings/staff-columns` (settings): read and replace the set; the
  `PUT` is idempotent (`Idempotency-Key`), audited, guarded by `manage:settings:business` (MY-Q5, PP-18.5, also for
  `staff_months_back`); the read is guarded by the same permission or `read:settings:business`.
- **FR-A08** `StaffColumnsPort.allowed(tx, companyId, businessId): ReadonlySet<StaffColumnCode>` in each consumer's
  `ports/` (Arabic JSDoc), returning the saved set or the MY-Q3 default, plus `monthsBack(tx, companyId, businessId)` (D-A14).
- **FR-A09** POS: «شغلي», «حضوري», «إجازاتي» screens in `apps/pos/src/my-work/`, `apps/pos/src/my-attendance/`,
  `apps/pos/src/my-leave/` (business-named folders, `CLAUDE.md` §7), reachable from the personal screen; generated
  client hooks, i18n keys, logical CSS; no fetch in components; nothing stored offline.
- **FR-A10** Admin: «أعمدة تطبيق الموظفين» settings page — one checkbox per allowed code with an example value, save,
  error states; UI tests assert the saved state is shown.

## A.4 Slice design

### Business rules

- **BR-A1** An employee sees only her own rows, chosen by the server from her session, never from a parameter (S-13).
- **BR-A2** A hidden column never leaves the server (D-A2).
- **BR-A3** The estimate is never stored and never shown as a number when the engine returns a named error (S-15).
- **BR-A4** Nothing in Part A writes money, attendance or ratings; it is read-only except the column and months settings.

### Schema

| Table | Change | Notes |
|---|---|---|
| `business_settings` | add `staff_columns text[] NULL` with `CHECK` (allowed codes, no duplicates) and `staff_months_back smallint NULL` with `CHECK (staff_months_back BETWEEN 1 AND 24)` (D-A14, MY-Q9) | expand-only; `NULL` = defaults (D-A6, D-A14); `UPDATE (staff_columns, staff_months_back)` grant to `pospay_app`; allowlist and privileges test updated |
| access catalog | four own codes (D-A4); no new settings code (MY-Q5: `manage:settings:business`) | defaults in a custom migration like ADR-0026's leave codes; device cells forbidden |

No new tenant table in Part A. The "my" queries add the indexes their `EXPLAIN` needs in the same migration (e.g.
`line_performers (company_id, employee_id)` if missing).

### Permissions

`read:service-sessions:own`, `read:commissions:own`, `read:attendance:own`, `read:ratings:own` (D-A4); the staff-columns
and months-back editor is the existing `manage:settings:business` (MY-Q5, PP-18.5).

### Error codes (`message_ar` / `message_en`, in `src/shared/errors.ts`)

- `MY_PERIOD_OUT_OF_RANGE` 422 — «الشهر ده برّه الفترة اللي تقدري تشوفيها.» / "This month is outside the period you can view."
- `STAFF_COLUMNS_INVALID` 422 — «الأعمدة دي مش مسموحة.» / "These columns are not allowed." (`details.codes`)
- Reused: `UNAUTHENTICATED`, `FORBIDDEN`, `FEATURE_DISABLED`, `NOT_READY`, `IDEMPOTENCY_KEY_REUSED`.

## A.5 Delivery — sub-PRs (at most three subtasks each)

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **A-0** | ADR-0010 addendum (docs only) | 1. Orders `StaffColumnsPort` (D-A3), worker orders `AlertRulesPort` (D-B14) and worker customers `BranchScheduleHoursPort` (D-B3). 2. module-map §3 rows + YAML | this spec merged | 60–120 |
| **57-0** | Reception-device private view: ADR addendum (docs only) | 1. ADR-0019/ADR-0027 addendum for D-A13 (fresh PIN proof ≤ 60 s, a private-view window ≤ 5 min bound to the `STAFF_POS` session and operator, a server-enforced sliding 60 s idle expiry within that 5-minute life, clearing on leave/sign-out/replacement, `no-store`; «شغلي» and «حضوري» only, leave unchanged). 2. The auth-owned window store and its check, and the FR-A06b `SessionGuard` policy, named for 57-1. 3. — | this spec merged | 60–120 |
| **57c-1** | Column setting storage + port | 1. Contract (`StaffColumnCode` enum, GET/PUT schemas), migration (`staff_columns`, `staff_months_back`, grant; no new permission, the routes use `manage:settings:business`, MY-Q5). 2. Settings use case + routes + audit; `StaffColumnsPort` readers (orders, commissions, customers and staff adapters — staff's serves the «حضوري» window of 57b-1 — + their module-map rows and YAML edges). 3. Unit + integration tests MY-13 (window part, through each adapter, staff's included), MY-17…MY-21 | **A-0** (MY-Q3, MY-Q4, MY-Q5, MY-Q9 decided) | 260–380 |
| **57-1** | Own access for the staff app | 1. Four own codes + defaults migration, catalog, inventory tests. 2. ADR-0027 addendum (D-A5). 3. Own-check helper reuse + refusal tests MY-09…MY-12; the D-A13 reception-device path (PIN step-up and private-view window in `packages/auth`, the FR-A06b `SessionGuard` policy) + MY-13b, its killed-tab case included | **57-0** (MY-Q1 decided) | 180–280 |
| **57-2** | «شغلي» API | 1. Orders own query (FR-A01) + tips (FR-A03) with column projection + `EXPLAIN`. 2. Routes, guard, error mapping, OpenAPI + clients. 3. Tests MY-01…MY-04, MY-07, MY-08, MY-13 | 57-1, 57c-1, **A-0** (MY-Q2, MY-Q8, MY-Q9 decided) | 300–420 |
| **57-3** | Estimate API | 1. Commissions own query over the DRAFT projection (FR-A02). 2. Route + OpenAPI. 3. Tests MY-05, MY-06 | **row 50**, 57-1, 57c-1; MY-Q6 | 200–320 |
| **57-4** | «شغلي» screen | 1. POS screen + hooks + i18n. 2. Estimate card shell (renders "pending"; 57-5 wires it); the reception-device private view (PIN step, idle close, the throttled activity touch, cache clearing, D-A13). 3. UI tests (visible columns, hidden column absent, pending card, the PIN step and the closed screen after idle) | 57-2 | 240–360 |
| **57-5** | Estimate card wiring | 1. The card calls the generated `commission-estimate` hook (57-3) and replaces the pending state. 2. i18n for amount / «مفيش خطة» / recalculated note. 3. UI tests asserting the visible amount, the no-plan text and the hidden card when `estimated_commission` is not allowed (MY-05, MY-06 screen side) | 57-3, 57-4 | 120–200 |
| **57b-1** | «حضوري» API | 1. Staff own query (FR-A04, with the MY-Q7 correction details) + `EXPLAIN`. 2. Route (FR-A06b policy) + OpenAPI + clients. 3. Tests MY-14, MY-15, the API part of MY-13b for attendance + access | 57-1, 57c-1 (months window) (MY-Q2, MY-Q7, MY-Q9 decided) | 220–320 |
| **57b-2** | «حضوري» and «إجازاتي» screens | 1. Attendance screen, opened on the reception device through the private-view flow built in 57-4 (PIN step, idle close, cache clearing; reused, not rebuilt). 2. Leave screen on the ADR-0026 routes, with no PIN step (D-A11). 3. UI tests MY-16 and MY-13b's «حضوري» case (the PIN step, the closed screen after idle) | 57b-1, 57-4 | 260–380 |
| **57c-2** | Admin column screen | 1. Settings page: the columns and the months-back setting (D-A14). 2. i18n. 3. UI tests (saved columns and months visible) | 57c-1 | 160–240 |

---

# Part B — Ratings and alerts (rows 58, 59, 59b, 60, 61, 62)

## B.1 Scope and decisions record

> **POSTPONED (RT-Q1, PP-18.9, 2026-10-21): the whole rating track waits until the end of the project.** The answer
> postpones the rating messages, and a rating comes only from the customer's link in that message: with no message
> there is no input, so storage, the page, submission, averages and the low-rating alert would have nothing to work on,
> and they wait with it. Rows
> 58-1, 58-2, 58-3, 59-1, 59-2, 59b-1…59b-3, 60-1, 60-2, 61-1…61-3 and the low-rating part of 62-3 do not start now. Their
> design below is kept as written, with RT-Q2 (copy approved as proposed), RT-Q3 (a switch, off at first) and RT-Q4
> (the last close of the day; an overnight interval belongs to the day it started) recorded as decisions: wherever the
> text below offers a branch for another answer of those three, the answered branch applies. Also decided for the track: RT-Q5 (a
> visit recorded after its day ended gets no message), RT-Q6 (the last 90 days; shown from the first rating) and RT-Q7
> (`read:service-sessions:branch`; comments for every holder, its 2026-10-21 follow-up). RT-Q8 (the four managers, in-app), RT-Q9 (the recommended content, the comment in-app only), RT-Q10 (reception and the
> manager may restore a customer's rating messages, audited; sub-PR 58-3) and RT-Q12 (all first names) are decided too;
> RT-Q1 itself (how the link
> reaches the sender) and RT-Q11 are asked when the track resumes (RT-Q13 is answered: PP-20.4). **The alert rules proceed now:** 62-1,
> 62-2, 62-2b, 62-2c, 62-4 and 62-3 without the low-rating part; the `LOW_RATING` kind joins them with the track.

**In:** the rating request lifecycle (schedule, claim, send, expire), the public page with submit and opt-out, the
attribution and averages, the low-rating alert, and the alert-rules screen with its master switch, which replaces every
interim rule shipped so far.

**Not in Part B:** ratings affecting commission (D-41, D-14); Google review cards and loyalty (Phase 4); SMS; a customer
account or history page; marketing messages; delivery of email/WhatsApp to team
members, deferred to a later row 62b after an ADR on reading team contacts (AL-Q6, PP-18.26).

| ID | Decision (technical; none is an owner question) | Alternative rejected |
|---|---|---|
| D-B1 | Customers owns `rating_requests`, `rating_performers` (the claim snapshot), `ratings` and `rating_attributions`. All are tenant tables: PK `(company_id, id)`, FORCE RLS, tenant-qualified FKs, negative isolation tests in the PR that creates them | one table with arrays (no FK to employees, no index per performer) |
| D-B2 | A **new worker `customers` module** consumes `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged` (module-map §4 already names customers as a consumer) and upserts the day's request: SCHEDULED, `due_at` moved by each new active session, `NO_ACTIVE_LINE` reopened (S-2, S-3). **The event is only a trigger, never the state:** from it the consumer takes `(company, business, customer)` and the session's `branch_id` and `occurred_at` (all three events carry them), **derives the request day first** (`requestDayOf` over `occurred_at` and that branch's effective timezone and hours, read through `BranchScheduleHoursPort`, D-B3; never the event's `business_date`), and only then locks that day's request row `(company, business, customer, day)` (insert-or-lock), then **reads the authoritative day state through `DaySessionsPort` on every delivery** (the sessions of that day under D-B3's rule, FR-B06) and recomputes branch, `due_at` and deadline from the latest active session it returns (or `NO_ACTIVE_LINE` when none). So reordered or replayed `ServiceLineChanged` deliveries, and a cancel that makes an earlier session the latest again, converge without any per-line revision table; `consumed_events` only dedupes event ids | a per-line scheduling projection with applied revisions (a second copy of orders' line state to keep in step; the claim reads `DaySessionsPort` anyway) | computing schedules in the API request path (the recording transaction must not grow) |
| D-B3 | The rating **day** is derived from the session's `occurred_at` **in the effective timezone of the session's branch** (D-10, read with the hours below), not orders' `business_date`, which can differ near midnight when the branch zone is not the business zone; `rating_requests.business_date` stores that request day (SPEC §4's column name). The closing time is read from the branch's `opening_hours` (ISO weekday intervals, `packages/contracts/src/tenancy/opening-hours.ts`) for that request day's weekday, in the same zone. **Each session belongs to exactly one request day**, computed by one pure function `requestDayOf(occurredAt, zone, openingHours)` in `customers/domain`: by default the session's own branch-local calendar date. **A visit after midnight inside an opening interval that started the day before (an overnight interval such as 18:00–02:00) belongs to the day the interval started (RT-Q4, PP-18.12):** a 00:30 visit in 18:00–02:00 joins the previous day's request and uses that weekday's interval and its 02:00 close; That one rule selects the event's key (D-B2), the request row, the sessions the consumer and the claim read (FR-B06) and the attribution, so no session is ever counted in two requests: visits at two branches of one business share a request only when their request days are equal. Near midnight, a 23:30 visit at a Kuwait (UTC+3) branch on day D and a 00:10 visit at a Dubai (UTC+4) branch on D+1, which is 20 minutes earlier as an instant, are two requests, each scheduled from and attributed to its own session (RT-01b). **The hours reach worker `customers` through `BranchScheduleHoursPort`**, defined in worker `customers/ports/` (`hours(tx, companyId, branchId)` → `{ opening_hours \| null, time_zone }`, on the caller's transaction) and bound at the worker root to a new public reader of the worker `tenancy` module, `branchScheduleHours(tx, companyId, branchId)`, the same shape as its existing `branchPlace` and `businessTimeZone` readers (CLAUDE.md §4.1: a cross-module read goes through the consumer's port). The port is new, so it is listed in the **A-0 ADR-0010 addendum** and 59-1 waits on A-0. The 59-1 consumer and the claim's reschedule (D-B5) both call it. The pilot is all `Asia/Kuwait`; the function takes both zones as inputs and tests a branch whose zone differs from its business's. The pure function `ratingSchedule(lastSession, openingHours, tz)` → `{ due_at, send_deadline \| null }` lives in `customers/domain` with exhaustive unit tests, including a visit at 23:30 branch time whose business-zone date is the next day; among several intervals the last close of the day counts (RT-Q4, PP-18.12) | orders' `business_date` (business zone: the wrong weekday and day key for a branch in another zone), or the customer's locale |
| D-B4 | **Discovery** of due work follows ADR-0037: a per-company BullMQ scheduler `rating-claims-<companyId>` registered on the first scheduling event of the company and repaired on every later one; job data `{ companyId }` only; the job pages due rows with `FOR UPDATE SKIP LOCKED` inside `withTenant` | a cross-tenant query (`pospay_app` has no such access, ADR-0003) |
| D-B5 | **Claim** (one transaction per request, 59b): lock the customer row (the lock order ADR-0011 §3 shares with page opt-out), then the request; recheck `opted_out_at` (→ `OPTED_OUT`), the deadline (→ `PAST_DEADLINE`), read `DaySessionsPort` (orders, injected callback at the worker root, module-map §3) for the request's day under D-B3's rule (FR-B06): a newer session moved `due_at` → reschedule; no active line → `NO_ACTIVE_LINE`; else snapshot the performers, read their first names through `PerformerNamePort`, store `token_hash` and `expires_at = claim instant + 7 days`, set SENDING and append `RatingRequestReady` | reading the projection (it may be stale by design, ADR-0010) |
| D-B6 | `RatingRequestReady` carries what ADR-0018 §1 requires: stable event id, the customer's canonical E.164 phone and `locale`, channel WHATSAPP, template `rating_request` and revision, safe parameters (`customer_first_name` — the first word of `customers.name`, passed through the ADR-0037 §4 display-name rules and omitted if RT-Q2 picks the no-name option —, business name, the performers' first names per RT-Q12 (all of them; more than 3 → «فريق <business>»), `rating_request_id`), and `send_deadline`. **Never the token** (ADR-0018 §1, ADR-0011 §1) | putting the link in the event |
| D-B7 | **Token transport** = RT-Q1 (`TODO(spec)`). The recommended design is ADR-0011's proposal: the token's random part is a keyed, domain-separated 256-bit HMAC of `(company_id, rating_request_id)`, derived only in the sender's memory by a restricted codec injected at both roots; the key lives only in Dokploy secrets; customers stores only the full-token hash. A new ADR records it. **Until RT-Q1 is answered no `rating_request` template is enabled and no rating message is sent** | storing the plaintext or an encrypted token (ADR-0011 forbids it silently) |
| D-B8 | `SENT` is recorded when worker `customers` consumes the notification outcome of its own `rating_request` attempt (`NotificationDelivered`). **Correlation:** the claim stores the `RatingRequestReady` outbox event id in `rating_requests.ready_event_id` (unique per company); the consumer matches the result's `source_event_id` and `template_key = 'rating_request'` (`notificationResult` in `packages/contracts/src/notifications.ts`) inside `withTenant(company_id)` and ignores every other result. A `FAILED`, `EXPIRED` or `SUPPRESSED` outcome leaves the request SENDING, never resent (S-5). This adds a `notifications ⇒ customers` event row to module-map §4 and an ADR-0010 addendum | dropping SENT (SPEC §10 names it) |
| D-B9 | **Submit** follows ADR-0011 §2 exactly: validate stars/comment, `withTenant(candidate)`, lock the request, sample the Clock, atomic consume `UPDATE … RETURNING`, insert the rating and one `rating_attributions` row per snapshotted performer, and append `LowRatingReceived` only when stars ≤ 2 and the alert is on — all in one transaction | attributing at submit time from the current lines (S-4) |
| D-B10 | The public routes are API routes in `customers/http` with one `@Public()` each and the explicit token capability check (ADR-0011 §4): `GET /v1/ratings/view` (returns `{ business_name, state: 'open' \| 'submitted' }` only: `submitted` when `consumed_at` is set, so a reloaded used link renders the completion state ADR-0011 §4 requires, with opt-out still offered until expiry; never the stars or the comment), `POST /v1/ratings/submit`, `POST /v1/ratings/opt-out`. The token travels in a dedicated, redacted header; the link carries it in the URL fragment | the token in a query string (proxy logs) |
| D-B11 | The per-IP limiter runs **before** token parsing, in Redis, keyed by the verified proxy-derived IP, shared by the three routes; missing Redis fails closed (ADR-0011 §4) | in-memory limits (several API containers) |
| D-B12 | Averages are computed on read from `rating_attributions` (no stored average), within the RT-Q6 window (**the last 90 days**, PP-18.14, against the recommended current month), shown from the **first** rating (PP-18.15, against the recommended minimum of 3), rounded half up to one decimal for display only | a stored running average (drifts, needs repair) |
| D-B13 | **Alert rules** live in settings: `alert_rules`, one row per kind for the business and, optionally, one per kind for a branch that overrides it (AL-Q2, PP-18.22: «نشاط، والفرع يغيّر»). `branch_id NULL` is the business rule; a branch row replaces the business rule for that branch's events (all its fields: on/off, recipients, channels, delay or lead), and deleting it returns the branch to the business rule. **Recipients are chosen by role** (AL-Q3, PP-18.23): a rule's recipients are a list of selectors, `ROLE` (owner, general manager, business manager, branch manager, each in the scope of the event's branch; editable), `PERMISSION_HOLDERS` (for example `read:files:business` for `DOCUMENT_EXPIRING`, `decide:attendance-change:company` for `ATTENDANCE_CHANGE_REQUESTED`) and `CONTEXT` (the requester, the employee herself). The last two come from the code defaults table per kind, are shown read-only on the screen and can only be switched with the rule; `PERMISSION_HOLDERS` resolves through identity's effective-permission reader, so personal ALLOWs, custom roles and DENY precedence apply exactly as today (ADR-0040); absent = the AL-Q5 default (PP-18.25, §B.4) from one code-side defaults table. **The master switch is per business** (`business_settings.alerts_enabled boolean NULL`, `NULL` = on): AL-Q2 was asked about the rules, and the master switch is the business-wide stop of AL-Q4's example (a holiday week); a branch stops its own alerts by switching kinds off in its override. It covers every team alert, managers' and employees' (AL-Q4, PP-18.24), and never the customer rating requests (D-B16). `AlertRulesPort.rule(tx, companyId, scope, kind)` with `scope = { businessId, branchId \| null }` returns the effective rule with the master switch applied: the branch's override when the event has a branch and an override exists, otherwise the business rule; kinds without a branch (statements, document expiry) pass `null` and get the business rule. **Who edits:** `manage:settings:business` (AL-Q1, PP-18.21: «نفس «إدارة الإعدادات»», no new code) for the business rules, the master switch and every branch override; the catalog has no branch-scoped settings code, so none is added and a branch override is written only by a caller holding `manage:settings:business` for the whole business: the routes' guard target is the business alone (`{ business: 'businessId' }`, no branch), which a `BRANCH`-scoped grant never covers (`covers`, `identity/domain/access.ts`), so a grant limited to one branch cannot change that branch's override; the use case also evaluates the branch as a target, so a DENY on that branch refuses its override (ADR-0003 §4) | a JSON blob per business (no per-kind audit, no `CHECK`s); a per-branch master switch (one business-wide stop, and a branch already overrides each kind) |
| D-B14 | Worker emitters read rules through a **minimal worker `settings` module** exporting a read function on the caller's transaction (the worker `tenancy` / `identity` shape, ADR-0037 §2); recipient user ids still come from identity's scoped-role read (`forBranch(…, roles)`), with roles now from the rule instead of `interimNotClockedInRule`. Worker **orders** reading `AlertRulesPort` is a port ADR-0010 does not list: it lands in the ADR-0010 addendum of docs PR A-0 before 62-3 | the API pushing rules to the worker |
| D-B15 | A rule change applies to events emitted **after** it commits; nothing is re-sent or back-filled, except the one-time document-expiry attachment spec 033 already contracts (S-17, S-18). **Periodic alerts record suppression:** when the not-clocked-in or break-not-returned job finds a candidate while its rule or the master switch is off, it writes the same ledger row it writes for a sent notice (`attendance_not_clocked_in_notices`, the break ledger) with `suppressed_at` set, no recipients and no notification, so that candidate is never emitted later when the rule turns back on | replaying past events when a rule turns on |
| D-B16 | **Rating-request switch (RT-Q3), separate from `alerts_enabled`:** customers owns `rating_settings` (one row per business once saved, `requests_enabled boolean NULL`). `NULL` means off (RT-Q3, PP-18.11: a switch, off at first), read from one code constant. Written by `PUT /v1/businesses/:businessId/rating-settings` (customers/http, idempotent, audited `customer.rating_requests_switched`, permission = `manage:settings:business` (RT-Q13, PP-20.4: the alert-rules permission, which AL-Q1, PP-18.21, made «إدارة الإعدادات»)), read by `GET` on the same path; the toggle sits on the settings page from 59-2 and moves into the alerts screen with 62-4 (RT-Q3's recommended place). The master switch never changes it (AL-Q4, PP-18.24: team alerts only). 59-1 reads it before inserting a request (off → no row); the claim (D-B5) rechecks it, and a request found switched off is `CANCELLED` with `cancel_reason = 'REQUESTS_OFF'` | one flag in `business_settings` (settings module; customers may import only `tenancy`, so it would need a new port and an ADR-0010 change), or reusing `alerts_enabled` (AL-Q4 keeps customer messages outside the team master switch) |

## B.2 User scenarios and acceptance criteria

People as in §1. Tests R1–R10 are SPEC §11's; the ADR-0011 §6 list is copied into PRs 58–60 as named tests.

### Story B1 — Scheduling (row 59, P1)

- **RT-01** (R2) نورة's 15:10 session schedules one request due 16:10, deadline 22:30; a second session at 17:00 at
  another branch of the same business moves it to that branch's day and closing; a session in another **business** of
  the company creates a second request (R9).
- **RT-02** (R2b) A 21:30 visit with a 22:00 close is due at 22:00 and is claimed and dispatched within the grace with
  the clock advancing through claim and dispatch.
- **RT-03** (R10) All her lines cancelled → `NO_ACTIVE_LINE`; a new active session before the deadline reopens it.
- **RT-04** (R7) A claim after the deadline → `PAST_DEADLINE`; an event reaching notifications after it → attempt
  `EXPIRED`, not sent.
- **RT-05** A branch with no opening hours → `send_deadline = NULL` (S-2). RT-Q5 (PP-18.13): a session recorded after
  its request day ended is left out of the day's sessions for scheduling and the claim. **The day ends at the close of its last open
  interval** (02:00 for an 18:00–02:00 day, the overnight tail included, RT-Q4), or at the branch-local midnight when
  the branch has no opening hours; no recording-delay allowance exists. One pure predicate `isLateEntry(recordedAt,
  requestDay, zone, openingHours)` in `customers/domain`, applied inside `sessionsOfDay` so scheduling and the claim
  use the same rule. A 00:30 visit in 18:00–02:00 recorded at 00:31 is on time; recorded at 02:05 it is late.
  **`TODO(spec)` (issue #452, postponed track):** a visit that really happens after the close and is recorded as it
  happens (22:15 at a 22:00 close, recorded at 22:15) is late by this rule, while RT-06 (S-2) lets it be claimed until
  22:30; which rule wins is settled when the track resumes. This holds with or without opening hours; a day whose only sessions are such late entries gets no
  row; a late entry added to a day that already has a request does not move it.
- **RT-01b** Two branches of one business, Kuwait (UTC+3) and Dubai (UTC+4), neither with an interval crossing
  midnight: a 23:30 Kuwait visit on day D and a
  00:10 Dubai visit on D+1 (20 minutes earlier as an instant) make two requests; D is due from the Kuwait session at
  the Kuwait close, D+1 from the Dubai session at the Dubai close; the events delivered in either order give the same
  two rows; each claim snapshots only its own session's performers (scheduling part in 59-1, claim part in 59b-2).
- **RT-06** RT-Q4 (decided): a split day (10:00–13:00, 16:00–22:00) and an overnight interval (18:00–02:00), including
  a 23:00 and a 00:30 visit in that interval: one request on the start day with the 02:00 close (D-B3, RT-Q4), and
  `requestDayOf` unit tests. Settled
  either way (S-2): a 22:15 visit at a 22:00 close is due at once and claimable until 22:30; at 22:31 → `PAST_DEADLINE` (whether such a
  visit recorded after the close is a late entry is the RT-05 `TODO(spec)`, issue #452).
- **RT-07** RT-Q3 (decided: a switch, off at first): a business with rating requests switched off schedules nothing (59-1), and a request
  found switched off at the claim is `CANCELLED` with `REQUESTS_OFF` (59b-2). Both exist only if RT-Q3 keeps the switch.
- **RT-08** Bootstrap (FR-B02b): sessions recorded before 59 ships schedule only requests whose deadline is still ahead;
  expired deadlines never trigger historical ratings (spec 050); checkpoint restart, coverage count and the
  consumer-start/live-write race of FR-B02b.

### Story B2 — Claim and send (row 59b, P1)

- **RT-09** (R3) A request crashed in SENDING is not resent; a notifications redelivery with an attempt row is not
  resent; two workers claim once.
- **RT-10** (R4) Attribution = the performers read at the claim; a cancel before the claim removes a performer; one
  after it does not; a performer change (spec 055) before the claim changes who is rated.
- **RT-11** (R8) A cancellation not yet seen by any projection still blocks the send (authoritative read).
- **RT-12** (R6) A STOP committed between the suppression check and the attempt is impossible (both under the phone
  lock, ADR-0013).
- **RT-13** Page opt-out racing a claim, both commit orders: opt-out first → `OPTED_OUT`; claim first → that one
  request may still be delivered (S-10).
- **RT-14** The event, job, logs and traces contain no token and no link (ADR-0018 §1); the phone appears only where
  ADR-0018 allows it.

### Story B3 — The page, submit and opt-out (rows 58 and 60, P1)

- **RT-15** (R5, ADR-0011 §6 "Tampered") altered random byte, altered prefix alone, malformed or non-canonical
  encodings, truncated or extra parts → the one generic unavailable view; no rating, no preference change, no business
  name.
- **RT-16** (ADR-0011 §6 "Replayed") repeated submit, lost-response retry, two concurrent submits, rollback during the
  rating/outbox insert: one committed rating, consumption and event; a view never consumes.
- **RT-17** (ADR-0011 §6 "Expired") just before, exactly at and after 7 days, for view, submit and opt-out; a consumed
  token opts out just before expiry and not after; nothing refreshes the life.
- **RT-17b** RT-Q10 (PP-18.19): reception or a manager restores a customer's rating messages: `customers.opted_out_at`
  cleared, one audit row `customer.rating_messages_restored` with actor, time, customer and the previous
  `opted_out_at`; the next day schedules again; a WhatsApp STOP suppression is never reversed (ADR-0013), so a
  STOP-suppressed customer stays unreachable and the screen says so; a caller without the permission or from another
  company → uniform 403; a duplicate restore is idempotent and writes one audit row. **`TODO(spec)` (issue #452):**
  `opted_out_at` is company-wide (S-10), so a holder whose permission covers one branch or business would turn the
  messages back on for every business of the company; whether such a holder may restore, or the opt-out becomes per
  business, is settled when the track resumes.
- **RT-18** (ADR-0011 §6 "Cross-tenant") A's token with B's prefix, foreign ids in the body, a signed-in admin of
  another company, equal random parts in A and B: every capability stays on the full hash's own row.
- **RT-19** (ADR-0011 §6 "Opt-out") before and after rating, duplicate POST keeps the first time, a customer shared
  by two businesses, global STOP suppression unchanged; the page/token flow never re-subscribes (restoring is only the
  staff action of RT-17b).
- **RT-20** (ADR-0011 §6 "Privacy/admission") the view DTO is exactly `{ business_name, state }`, `state` ∈ `open` / `submitted`; the rendered page shows only
  that and the form, ar/en, RTL; `no-store`, `no-referrer`; 30 requests/IP/minute across the three routes and all
  prefixes before lookup; bilingual 429 with `Retry-After`; a spoofed forwarded header is ignored.
- **RT-21** (ADR-0011 §6 "Comments") empty, absent and 1,000-character comments accepted; 1,001 (Unicode) rejected;
  a comment containing a link (URL, `www.`, a bare domain) or an image is **rejected on the server** with
  `RATING_INPUT_INVALID` (ADR-0011 §4); accepted text with markup characters is stored as text and rendered
  escaped, never as HTML, Markdown or a link; every invalid input leaves the token unconsumed.

### Story B4 — Low rating and averages (row 61, P1/P2)

- **RT-22** A 2-star rating with the alert on emits one `LowRatingReceived` with recipients and channels from the rule
  (the `LOW_RATING` rule of row 62, whose default is RT-Q8's: on, in-app, the four managers in the visit branch's scope); 3 stars emits nothing; the alert off emits nothing.
- **RT-23** RT-Q9 (decided): stars, branch, date, performers' first names, the customer's name and last 3 phone digits; the
  comment only in the in-app notice, WhatsApp/email carry «فيه تقييم منخفض، افتح PosPay» only; never the phone beyond the last 3 digits (S-12), never the token.
- **RT-24** Both snapshotted performers get the rating; سارة's average is the mean of her attributed ratings in the
  last 90 days (RT-Q6); an employee with no rating in that window sees «لسه مفيش تقييمات»; one rating is enough to show it.
- **RT-25** The staff app shows her average and count only (S-9, S-11); the admin list shows comments to every
  holder of `read:service-sessions:branch` in its scope, reception included when granted it (FR-B15, RT-Q7 follow-up); staff-app and public reads never return a comment (ADR-0011 §8).

### Story B5 — Alert rules (row 62, P1)

- **RT-26** Every kind of §B.4's table can be switched off alone (the next event of that kind carries no recipients and
  sends nothing; nothing is stored except the `suppressed_at` ledger row a periodic alert writes, D-B15, RT-27b) and all at once by the master switch (SPEC §12).
- **RT-26b** Branch override (AL-Q2): السالمية's `SHIFT_NOT_CLOCKED_IN` overridden to 10 minutes → السالمية's shifts alert
  at 10, حولي's at the business's 20; deleting the override → السالمية back to 20; document expiry (no branch) always
  uses the business rule; the master switch off stops both branches.
- **RT-27** Changing a rule's recipients or delay changes the next emission only (D-B15); the not-clocked-in job, the
  break job, the four orders bells and the low-rating emitter all read the rule, and `interimNotClockedInRule` and
  `interimBreakNotReturnedRule` are deleted.
- **RT-27b** Off-then-on for a periodic alert: a shift becomes overdue while `SHIFT_NOT_CLOCKED_IN` (or the master
  switch) is off → a ledger row with `suppressed_at` and no notification; the rule turns on before the shift ends →
  the next job run emits nothing for that shift; a new overdue shift after that is emitted. Same for break not returned.
- **RT-28** Document expiry: notices with `recipients_attached_at IS NULL` still current and in their window get one
  recipient-bearing event, only for holders of `read:files:business` (S-18, spec 033).
- **RT-29** A caller without `manage:settings:business` for the whole business (AL-Q1), including one whose grant covers a
  single branch writing that branch's override (D-B13), a device, another business → uniform 403; every change audited
  with before/after.

## B.3 Requirements

- **FR-B01** Tables of D-B1 (§B.4 Schema), with RLS and negative tests in 58-1.
- **FR-B02** Worker customers consumers (D-B2): one row per `(company, business, customer, business_date)`, the
  `UNIQUE` of SPEC §4, where `business_date` is the branch-local day of D-B3. Each delivery derives that day from the
  event's `branch_id` and `occurred_at` before anything else, then locks that row (insert-or-lock), reads `DaySessionsPort` for the day (FR-B06) and the
  latest session's branch hours (`BranchScheduleHoursPort`, D-B3) in the same transaction and recomputes branch, `due_at` and deadline from the latest active session; no active line →
  `NO_ACTIVE_LINE`. A SENDING, SENT or terminal row is never changed. No per-line revision is stored: the read state
  is authoritative, so delivery order does not matter. Tests: reordered deliveries of two revisions of one line, a
  cancel of the latest session making an earlier one latest again, a replayed event, and a consumer integration test
  for the 23:30 visit whose orders `business_date` is the next day (the row is keyed on the branch-local day). A business
  whose rating-request switch is off (D-B16) gets no row (RT-07, only while RT-Q3 keeps the switch).
- **FR-B02b** **Bootstrap = an orders-owned paged authoritative reader** (ADR-0041 §6's second option; retained-event
  replay is rejected because it depends on outbox retention and on a dispatcher-facade path this slice does not need).
  Order: the 59-1 consumers are deployed on every replica first, so every event published after that is consumed live;
  then an operator job runs per company. `DaySessionsPort.sessionsSince(tx, companyId, range, afterSessionId, limit)`
  pages `{ session_id, business_id, customer_id, branch_id, occurred_at }` of sessions with at least one active line,
  `occurred_at >= cutoff`, keyset on the UUID v7 `session_id`, `limit` ≤ 200, with `countSince(tx, companyId, range)`
  for coverage. **The range is frozen before the first page:** the job reads a watermark once, the highest `session_id`
  and its own start instant `T0`, and both reads take the same `range = { cutoff, maxSessionId, recordedAtOrBefore: T0 }`
  (`session_id <= maxSessionId` and `recorded_at <= T0`). A session outside it, recorded after the job started
  (including one synced later with an older offline UUID v7), is left to the live consumer, already running. The cutoff is the job's start minus 48 hours (every deadline still ahead lies inside it). **The same
  48 hours bound deadline-free sessions** (a branch with no opening hours, S-2, has `send_deadline NULL`): a
  deadline-free session older than the cutoff is deliberately not rated, the bootstrap's equivalent of RT-08's «no
  historical ratings», and is outside `countSince` by construction; one inside the window is scheduled like a live
  delivery (its `due_at` already past, so it is claimed on the next run). This bound applies to the bootstrap only;
  live scheduling is unchanged. Each page
  row goes through **the same code path as a live delivery** (derive the day, insert-or-lock, read `DaySessionsPort`,
  recompute; a past deadline → `CANCELLED` with `PAST_DEADLINE`, never sent, RT-08), so live and bootstrap converge on one row by
  construction. The job takes an explicit company, cutoff and UUID checkpoint, prints the checkpoint after each page
  and the processed count at the end; the runbook compares it with `countSince` and a mismatch stops the rollout
  (ADR-0041 §6 runbook count/checkpoint). Tests: paging across pages and a restart from a checkpoint, coverage count
  equal, a session committed while the job pages is outside the range, consumed live, and the count still matches, a no-hours branch with sessions 47 h and 49 h before the job (the first scheduled, the second no row and not
  counted), and the **consumer-start/live-write race**: a session recorded and its event consumed while the bootstrap
  pages the same customer/day, in both commit orders, gives one row with the latest `due_at`.
- **FR-B03** `ratingSchedule` pure function (D-B3) and its unit tests: 1 h after, capped by closing, deadline +30 min,
  no hours → no deadline, timezone boundaries, RT-Q4's last close and overnight start day.
- **FR-B04** Per-company claim scheduler (D-B4) every minute, keyset pages of at most 100 due requests.
- **FR-B05** Claim transaction (D-B5) with the lock order customer → request, Clock sampled after the locks.
- **FR-B06** `DaySessionsPort.activeLines(tx, companyId, businessId, customerId, fromInstant, toInstant)` → active lines of
  the customer's sessions in that business whose `occurred_at` is in the window, with performers, branch, the session's
  `occurred_at`, `recorded_at` (for RT-Q5's `isLateEntry`, RT-05) and `business_timezone`. Orders does not know branch zones, so the caller passes the widest window any
  zone and an overnight tail can map to the day (`[day 00:00 at UTC+14, day+1 24:00 at UTC−12)`) and the pure
  `customers/domain` function `sessionsOfDay(sessions, placeByBranch, day)` keeps only the sessions whose `requestDayOf`
  is the day (D-B3, overnight ownership per RT-Q4) and that are not `isLateEntry` (RT-05), each branch's zone and hours read through
  `BranchScheduleHoursPort` once per distinct branch; unit tests cover the two-branch midnight case (used by the 59-1 consumer and the claim), in orders' public reader, bound by injected callback (module-map §3 note, ADR-0041).
- **FR-B07** `PerformerNamePort.firstNames(tx, companyId, employeeIds)` (staff) → ar/en first names, display-safe (the
  ADR-0037 §4 name rules).
- **FR-B08** `RatingRequestReady` per D-B6; template `rating_request` (ar/en, RT-Q2) with an opt-out line (D-41);
  the link built in sender memory by the RT-Q1 codec.
- **FR-B09** SENT tracking per D-B8.
- **FR-B10** Opt-out (row 58): `POST /v1/ratings/opt-out` per ADR-0011 §3: same full hash, `expires_at > now`,
  `consumed_at` not required, lock the customer row, keep the first `opted_out_at`, audit `customer.rating_opted_out`
  (no phone).
- **FR-B11** View and submit (row 60) per D-B9/D-B10 and ADR-0011 §2/§4; the view's `state` is `submitted` once the
  token is consumed (never the rating or comment).
- **FR-B12** Rate limiter per D-B11; error `TOO_MANY_REQUESTS` (existing) with the generic rating copy and
  `Retry-After`.
- **FR-B13** `LowRatingReceived` (customers ⇒ notifications) with recipients and channels from `AlertRulesPort`
  (kind `LOW_RATING`), groups of at most 100 recipients (ADR-0037 §5); template `low_rating` (ar/en, RT-Q9).
- **FR-B14** `GET /v1/staff/me/rating-summary` → `{ average, count }` in the RT-Q6 window, only with `rating_average`
  allowed and `read:ratings:own`.
- **FR-B15** Admin ratings read, guarded by the existing `read:service-sessions:branch` (RT-Q7, PP-18.16; each holder in
  their scope, no new permission). **Comments:** every holder of that permission reads them in its scope, a non-manager
  role it is granted to included (SS-Q12; RT-Q7 follow-up, 2026-10-21: «أي حد معاه الصلاحية»), which amends ADR-0011's
  owner/manager-only rule (ADR-0011 §8); staff-app, public and cross-tenant reads never return a comment. Test: a
  reception holder of `read:service-sessions:branch` gets stars, date, branch, performers and the comment; a caller
  without it → 403. `GET /v1/businesses/:businessId/ratings?branch_id&from&to&employee_id&cursor`
  → rating list (stars, date, branch, performers, comment) and per-employee averages; `queries/` with `EXPLAIN`.
- **FR-B16** Alert rules (row 62): `GET/PUT /v1/businesses/:businessId/alert-rules` (business rules),
  `GET/PUT/DELETE /v1/businesses/:businessId/branches/:branchId/alert-rules` (a branch's overrides; `DELETE` of a kind
  returns the branch to the business rule, AL-Q2) and `PUT /v1/businesses/:businessId/alert-rules/master`; idempotent,
  audited, all guarded by `manage:settings:business` on the business (AL-Q1, D-B13); validated per kind (delay/lead
  ranges, allowed recipient roles, `IN_APP` only until row 62b, AL-Q6).
- **FR-B17** `AlertRulesPort` read in the API (customers) and worker (staff, orders) per D-B13/D-B14; every interim rule
  is replaced: `interimNotClockedInRule` (ADR-0037 §3), `interimBreakNotReturnedRule` (spec 041, both in
  `apps/worker/src/modules/staff/domain/`), the late-session,
  price-edit, cancel and performers bells (ADR-0041 35b-2, ADR-0044 and addenda), `AttendanceExceptionRaised`
  (no recipients until now, ADR-0032), `DocumentExpiring` (spec 033 contract), and the row 28c lead time, and the API staff emitters of `AttendanceChangeRequested` / `AttendanceChangeDecided` (ADR-0040, sub-PR 62-2b).
- **FR-B18** Public page (row 60, host per RT-Q11): business name, five stars, optional comment, submit, opt-out,
  completion and unavailable states; generated client hooks, i18n, RTL; the token read from the fragment and sent in
  the header; nothing stored in the browser.

## B.4 Slice design

### Business rules

- **BR-B1** A rating request is one per customer per business per day, and is sent at most once (S-2, S-5).
- **BR-B2** Who is rated is fixed at the claim and never changes afterwards (S-4).
- **BR-B3** A rating never moves money (D-14).
- **BR-B4** A comment is read by the holders of `read:service-sessions:branch` in the visit branch's scope (FR-B15, RT-Q7
  follow-up, ADR-0011 §8). So the `LOW_RATING` in-app notice carries the comment (RT-Q9) only for a recipient who holds
  that permission in that scope, checked at emission; any other recipient gets the same notice without the comment.
- **BR-B5** A switched-off alert sends nothing for events emitted while it is off, and stores nothing except the
  `suppressed_at` ledger row of a periodic alert (D-B15, RT-27b).

### Schema

| Table | Change | Notes |
|---|---|---|
| `rating_requests` (new) | `company_id`, `id`, `business_id`, `customer_id`, `business_date`, `branch_id`, `due_at`, `send_deadline NULL`, `status`, `cancel_reason NULL`, `token_hash bytea NULL` (32 bytes), `expires_at NULL`, `claimed_at NULL`, `ready_event_id uuid NULL` (D-B8), `sent_at NULL`, `consumed_at NULL`, `created_at`, `updated_at` | `UNIQUE (company_id, business_id, customer_id, business_date)` (SPEC §4); `UNIQUE (company_id, ready_event_id)` where not null; `UNIQUE (company_id, token_hash)` where not null (ADR-0011 §1); `CHECK`s on status/reason pairs and on token/expiry together; partial index `(company_id, due_at) WHERE status = 'SCHEDULED'` for the claim page; column `UPDATE` grants only |
| `rating_performers` (new) | `company_id`, `id`, `request_id`, `employee_id` | the claim snapshot; `UNIQUE (company_id, request_id, employee_id)`; insert-only |
| `ratings` (new) | `company_id`, `id`, `request_id`, `business_id`, `branch_id`, `stars smallint`, `comment text NULL`, `submitted_at` | `UNIQUE (company_id, request_id)` (ADR-0011 §2); `CHECK (stars BETWEEN 1 AND 5)`, comment ≤ 1,000 characters; insert-only |
| `rating_attributions` (new) | `company_id`, `id`, `rating_id`, `employee_id`, `business_id`, `branch_id`, `stars`, `submitted_at` | one row per snapshotted performer; index `(company_id, employee_id, submitted_at)` for averages; insert-only |
| `alert_rules` (new, row 62) | `company_id`, `id`, `business_id`, `branch_id uuid NULL` (`NULL` = the business rule, otherwise that branch's override, AL-Q2), `kind`, `enabled`, `recipient_roles text[]` (AL-Q3: roles; the kind's fixed `PERMISSION_HOLDERS` / `CONTEXT` selectors come from the code defaults table, D-B13), `channels text[]` (`IN_APP` only in row 62; row 62b adds `WHATSAPP` and `EMAIL`, AL-Q6), `delay_minutes NULL`, `lead_minutes NULL`, `updated_by`, `updated_at`, `revision` | `UNIQUE (company_id, business_id, kind) WHERE branch_id IS NULL` and `UNIQUE (company_id, branch_id, kind) WHERE branch_id IS NOT NULL`; the branch must belong to `business_id` (composite FK to `branches`); `CHECK`s per kind (`DOCUMENT_EXPIRING`: `lead_minutes IS NULL`, its lead is the type's `alert_days`); FORCE RLS |
| `business_settings` | add `alerts_enabled boolean NULL` (the master switch, per business, D-B13) | `NULL` = on |
| `rating_settings` (new, row 59-2; RT-Q3 decided) | `company_id`, `id`, `business_id`, `requests_enabled boolean NULL`, `updated_by`, `updated_at`, `revision` | `UNIQUE (company_id, business_id)`; `NULL` = the RT-Q3 default (D-B16); FORCE RLS |

`customers.opted_out_at` already exists (`packages/db/schema/customers.ts`). Every new table gets restricted-role
read/write/re-home/FK negative tests and pooled-context leak tests (ADR-0011 §6).

### Events and module map

| Event | From ⇒ to | Status |
|---|---|---|
| `ServiceSessionRecorded`, `ServiceSessionLinesAdded`, `ServiceLineChanged` | orders ⇒ customers (worker) | listed in module-map §4; consumer added in 59-1 |
| `RatingRequestReady` | customers ⇒ notifications | listed (ADR-0010); payload per D-B6 fixed in 59b-2 |
| `LowRatingReceived` | customers ⇒ notifications | listed; payload in 61-1 |
| `NotificationDelivered` (source `rating_request`) | notifications ⇒ customers | **new row** (D-B8), ADR-0010 addendum in 59b-3 |

Ports: `DaySessionsPort`, `PerformerNamePort`, `AlertRulesPort`, `StaffColumnsPort` — approved in ADR-0010 for
customers, staff and commissions; **orders' `StaffColumnsPort`, worker orders' `AlertRulesPort` and worker customers'
`BranchScheduleHoursPort` are not, and wait for the ADR-0010 addendum (docs PR A-0)**. Adapter edges are added to module-map §2/§3 when first used.

### Alert kinds and their defaults (AL-Q5, approved PP-18.25)

| Kind | Event | Proposed default (until the owner changes it) | Source of the default |
|---|---|---|---|
| `SHIFT_NOT_CLOCKED_IN` | `ShiftNotClockedIn` | on · 20 min · four scoped manager roles · in-app; **plus the absent employee herself by push, fixed** (like `SHIFT_ENDS_SOON`: not a selectable channel and not in `channels`; the screen shows «إشعار على الموبايل للموظفة» read-only; sent only once row 28b is merged; it follows this kind's `enabled` toggle and the master switch, so switching the kind off stops the managers' notice and her push together) | D-47, NC-Q1/Q2/Q3/Q4, row 28b |
| `SHIFT_BREAK_NOT_RETURNED` | `ShiftBreakNotReturned` | on · as `interimBreakNotReturnedRule` today · same roles · in-app | spec 041 BW-Q5 |
| `SHIFT_BREAK_RETURNED_OTHER_BRANCH` | `ShiftBreakNotReturned` with `notice_kind = 'break_returned_other_branch'` | on · the branch's managers · in-app | row 16b-3 (BW-Q10) |
| `SHIFT_ENDS_SOON` (employee) | row 28c event | on · 30 min before shift end · the employee · **push, fixed** (not a selectable channel: the rule row holds only `enabled` and `lead_minutes`; its `channels` is empty and the screen shows «إشعار على الموبايل» read-only, so the SPEC §4 channel set WHATSAPP/EMAIL/IN_APP is unchanged) | NC-Q1 answer, row 28c, 28b |
| `ATTENDANCE_EXCEPTION` | `AttendanceExceptionRaised` | on · four scoped manager roles · in-app | AL-Q5 (PP-18.25) |
| `DOCUMENT_EXPIRING` | `DocumentExpiring` | on · the type's `alert_days` (30 days by default, editable per document type, D-39) — the lead is **not** a rule field: `lead_minutes` stays `NULL` for this kind and the alerts screen shows the window read-only with a link to the document-types screen, because spec 033's PR 62 contract selects and attaches by that same window · holders of `read:files:business` · in-app | D-39, OD-Q3 |
| `LATE_SERVICE_SESSION` | `LateServiceSessionNoticeRequested` | on · four scoped manager roles · in-app | SS-Q11, ADR-0041 |
| `SERVICE_LINE_EDITED` / `_CANCELLED` / `_PERFORMERS_CHANGED` | the three orders notice events | on · four scoped manager roles, the actor included · in-app | ED-Q6, spec 054, PF-Q4 |
| `ATTENDANCE_CHANGE_REQUESTED` / `_DECIDED` | ADR-0040 events | on · holders of `decide:attendance-change:company` / the requester · in-app | ADR-0040 |
| `LOW_RATING` | `LowRatingReceived` | on · the four managers in the visit branch's scope · in-app (RT-Q8) — **postponed with the rating track (RT-Q1)** | RT-Q8 |
| `STATEMENT_AWAITING_REVIEW` / `_APPROVAL` | rows 52/53, reminders 56b | on · holders of `review:commissions:business` / the owner · in-app · the owner's reminders on the 3rd and 5th | SPEC §6, D-54 |

### Permissions

- `read:ratings:own` (Part A D-A4).
- The admin ratings read: `read:service-sessions:branch` (RT-Q7); comments for every holder in scope (RT-Q7 follow-up,
  FR-B15, ADR-0011 §8).
- The alert rules, their branch overrides, the master switch and the rating-request switch: the existing
  `manage:settings:business` on the business (AL-Q1, AL-Q2, RT-Q13); no new code.
- The public routes carry `@Public()` plus the token capability check; they pass route-access coverage (ADR-0011 §6).

### Error codes

- `RATING_LINK_UNAVAILABLE` 404 — «الرابط ده مش متاح.» / "This link is not available." — one answer for malformed,
  unknown, tampered, expired, consumed (on submit) and cross-tenant (ADR-0011 §1). Final copy per RT-Q2.
- `RATING_INPUT_INVALID` 422 — stars or comment invalid; the token stays unconsumed.
- `ALERT_RULE_INVALID` 422 — a value outside the kind's allowed range, role or channel.
- Reused: `TOO_MANY_REQUESTS` (429), `FORBIDDEN`, `FEATURE_DISABLED` (feature `customers`), `NOT_READY`.

### Public copy (approved as proposed, RT-Q2 / PP-18.10; used by 59b-3 and 60-2 when the track resumes)

- WhatsApp (ar): «أهلاً {{customer_first_name}}، شكراً لزيارتك {{business_name}} النهارده. قيّمي خدمة {{performers}} من هنا:
  {{link}}. لو مش عايزة رسايل تقييم تاني، ابعتي "إيقاف" أو اختاري "مش عايزة رسايل" في نفس الصفحة.»
- WhatsApp (en): "Hi {{customer_first_name}}, thank you for visiting {{business_name}} today. Rate {{performers}}'s
  service here: {{link}}. To stop rating messages, reply "STOP" or choose "No more messages" on the same page."
- Page: «قيّمي زيارتك لـ {{business_name}}» · «اكتبي ملاحظتك (اختياري)» · «ابعتي التقييم» · «مش عايزة رسايل تقييم تاني» ·
  done: «شكراً، وصلنا تقييمك» · opt-out done: «تمام، مش هنبعتلك رسايل تقييم تاني» · unavailable: «الرابط ده مش متاح.»
  (en mirrors each line).

The message uses the customer's stored name only as a greeting inside her own WhatsApp; the page never shows it
(ADR-0011 §4). If the owner prefers no name in the message, only the template changes.

## B.5 Delivery — sub-PRs (at most three subtasks each)

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **58-1** | Rating storage — **POSTPONED (RT-Q1)** | 1. Migration: the four tables of D-B1, RLS, grants, indexes (not `rating_settings` and not the `REQUESTS_OFF` reason: both wait for RT-Q3 in 59-2). 2. Contracts (statuses, reasons, DTOs). 3. RLS/privilege negative tests | this spec merged | 280–400 |
| **58-2** | Opt-out API + public-route base — **POSTPONED (RT-Q1)** | 1. Token parser and hash (pure), per-IP limiter (D-B11). 2. `opt-out` use case + `@Public()` route + audit. 3. Tests RT-17 (opt-out part), RT-19, RT-20 (limits) | 58-1 | 300–420 |
| **58-3** | Restore rating messages — **POSTPONED (RT-Q1)** | 1. ADR-0011 addendum (a staff restore is a separate audited capability; the token flow still never re-subscribes; WhatsApp STOP is never reversed, ADR-0013) + a new permission granted by default to reception and the four manager roles (RT-Q10). 2. `restore-rating-messages` use case + route (idempotent, audited `customer.rating_messages_restored` with actor and time) + the button on the customer screen with the STOP note. 3. Tests RT-17b + UI test (restored state and the STOP note visible) | 58-2; the restore scope `TODO(spec)` of RT-17b (issue #452) | 220–320 |
| **59-1** | Scheduling — **POSTPONED (RT-Q1)** | 1. `ratingSchedule` pure function + unit tests; `DaySessionsPort` reader in orders + worker root callback (FR-B06); `BranchScheduleHoursPort` in worker customers bound at the root to the worker tenancy `branchScheduleHours` reader (D-B3); `requestDayOf` + unit tests. 2. Worker customers module: the three consumers reading `DaySessionsPort` on every delivery (D-B2), insert-or-lock, reopen; bootstrap job + orders `sessionsSince`/`countSince` paged reader + runbook entry (FR-B02b). 3. Tests RT-01…RT-08 (RT-07 scheduling part only, and only if RT-Q3 keeps the switch), RT-01b scheduling part, the FR-B02 reorder/replay tests and the differing-date consumer test | 58-1, 59-2 (or RT-Q3 answered «no switch»), **A-0**; RT-Q3, **RT-Q4** (both decided) | 360–500 |
| **59-2** | Rating-request switch — **POSTPONED (RT-Q1)** | 1. Migration `rating_settings` (RLS, grant, negative tests) + the `REQUESTS_OFF` cancel reason in contracts, then `set-rating-requests` use case + `GET/PUT …/rating-settings` routes, audit, permission (D-B16); nothing of this is built if RT-Q3 drops the switch. 2. Admin toggle on the settings page (i18n, RTL). 3. Tests of the switch itself only: persistence (`NULL` default, on/off round trip), audit, uniform 403, UI test (switch state visible); RT-07's scheduling and claim tests live in 59-1 and 59b-2 | 58-1 (RT-Q3, RT-Q13, AL-Q1 decided) | 220–320 |
| **59b-1** | Token codec — **POSTPONED (RT-Q1)** | 1. ADR (RT-Q1) + codec in its owning package, keys from env only. 2. Root injection (api + worker). 3. Unit tests (determinism, domain separation, key ids) | **RT-Q1** | 160–260 |
| **59b-2** | Claim — **POSTPONED (RT-Q1)** | 1. `PerformerNamePort` (the `DaySessionsPort` of 59-1 reused). 2. Claim use case (D-B5), discovery scheduler (D-B4), `RatingRequestReady`; on rollout, a registered ADR-0038 data step reads `companies.id` and, per company under `withTenant`, emits one outbox `RatingClaimsDiscoveryRequested` when it already has unclaimed requests (written by 59-1 or its bootstrap), whose consumer registers `rating-claims-<companyId>` exactly as the first scheduling event would (idempotent; no new session needed). 3. Tests RT-09…RT-13, a company whose requests exist before 59b-2 deploys is claimed with no new event, RT-01b claim attribution, RT-07 claim part (`REQUESTS_OFF`, only if RT-Q3 keeps the switch) | 59-1, 59b-1 | 380–520 |
| **59b-3** | Send — **POSTPONED (RT-Q1)** | 1. Template `rating_request` ar/en + link rendering in the sender + deadline. 2. SENT tracking (D-B8) + module-map/ADR addendum. 3. Tests RT-04 (send side), RT-14 | 59b-2 (RT-Q2, RT-Q12 decided). May merge with sending disabled; **live activation** (template enabled; and, only if RT-Q3 keeps a switch, the business's switch on through 59-2; with RT-Q3's «no switch» answer the enabled template alone) waits until **60-1 and 60-2 are deployed and verified on staging**, so no customer gets a link before the page and submit work | 260–380 |
| **60-1** | Submit API — **POSTPONED (RT-Q1)** | 1. `view` + `submit-rating` use cases (D-B9). 2. Routes + OpenAPI. 3. Tests RT-15…RT-18, RT-21 | 58-2 | 360–480 |
| **60-2** | Public page — **POSTPONED (RT-Q1)** | 1. App shell or route per RT-Q11, headers, no trackers. 2. Page states ar/en/RTL + opt-out control. 3. UI tests (only business name and form visible; completion; reopening a consumed, unexpired link shows the completion state and the opt-out control, not the form; unavailable) | 60-1; **RT-Q2**, RT-Q11 | 280–420 |
| **61-1** | Low-rating alert — **POSTPONED (RT-Q1)** | 1. `LowRatingReceived` with recipients taken from `AlertRulesPort` (kind `LOW_RATING`, its default = RT-Q8's four managers in-app); no interim fixed rule is built. 2. Template `low_rating` + bell render; the comment only in the notices of recipients whose effective `read:service-sessions:branch` in the visit branch's scope allows it, DENY first (BR-B4, identity's effective-permission reader), never by role. 3. Tests RT-22, RT-23, a manager-role recipient with a DENY on `read:service-sessions:branch` for the visit branch who gets the notice without the comment, and one holding it who gets the comment | 60-1, **62-1** (RT-Q8, RT-Q9 decided) | 260–360 |
| **61-2** | Averages — **POSTPONED (RT-Q1)** | 1. Staff summary read (FR-B14) + admin list/averages (FR-B15) with `EXPLAIN`. 2. Permission (RT-Q7) + routes. 3. Tests RT-24, RT-25 + admin screen UI test | 61-1, 57c-1 (RT-Q6, RT-Q7 decided) | 340–460 |
| **61-3** | Rating summary on «شغلي» — **POSTPONED (RT-Q1)** | 1. The work screen's card calls the generated `rating-summary` hook (61-2) when `rating_average` is allowed. 2. i18n for average / count / the «no ratings yet» text (RT-Q6: shown from the first rating). 3. UI tests asserting the visible average and count, the below-minimum text, and no card when `rating_average` is not allowed | 61-2, 57-4 | 120–200 |
| **62-1** | Alert-rule storage and port | 1. Migration (`alert_rules` with branch overrides, master switch), defaults table; no new permission (`manage:settings:business`, AL-Q1). 2. Settings use cases + routes (business rules, branch overrides, master) + audit; `AlertRulesPort` (api) + worker settings module. 3. Tests RT-26, RT-26b, RT-29 | — (AL-Q1…AL-Q6 answered, PP-18.21…PP-18.26; no longer waits on 61-1: `LOW_RATING` joins the rules with the postponed track; channels `IN_APP` only, row 62b widens them, AL-Q6) | 360–480 |
| **62-2** | Staff worker emitters on the rules | 1. Not-clocked-in + break rules read the port; `interimNotClockedInRule` and `interimBreakNotReturnedRule` deleted; the employee's own not-clocked-in push (NC-Q3) is kept as the kind's fixed push recipient, under the same toggle and master switch; their ledgers gain `suppressed_at` and the off path writes it (D-B15). 2. Attendance exceptions and document expiry (spec 033 contract); 28c lead time. 3. Tests RT-27, RT-27b, RT-28 | 62-1 |
| **62-2b** | Staff API emitters on the rules | 1. `AttendanceChangeRequested` / `AttendanceChangeDecided` (`apps/api/src/modules/staff/persistence/attendance-change-writes.ts`, ADR-0040) take recipients and channels from `AlertRulesPort` (api, on the same transaction) instead of resolving them inline. 2. The rule's role set maps to today's recipients (holders of `decide:attendance-change:company` / the requester) so the defaults change nothing. 3. Tests: each kind off → event with no recipients; master switch off → none; defaults → today's recipients (RT-26), including an approver who holds `decide:attendance-change:company` only by a personal ALLOW or a custom role (still a recipient) and one with a DENY (not a recipient), under the `PERMISSION_HOLDERS` selector (D-B13; AL-Q3 decided: roles) | 62-1 | 200–300 | 320–440 |
| **62-2c** | Commissions emitters on the rules | 1. Whichever of rows 52/53 (`STATEMENT_AWAITING_REVIEW` / `_APPROVAL`) and 56b (the owner's reminders) is merged when 62-1 lands: its emitter or reminder scheduler takes recipients and channels from `AlertRulesPort` instead of resolving them inline; one merged after 62-1 consumes the port in its own slice (the §Relates rule), and this sub-PR then only adds its tests. 2. Defaults map to today's recipients (holders of `review:commissions:business` / the owner), so nothing changes until a rule is edited. 3. Tests: each kind off → no recipients; master switch off → none; defaults → today's recipients (RT-26) | 62-1; rows 52/53 or 56b merged | 160–260 |
| **62-3** | Orders bells on the rules | 1. Late, edit, cancel, performers bells read the port. 2. ~~Low rating reads the port~~ **POSTPONED with the rating track (RT-Q1)**: when 61-1 ships, its low-rating emitter reads the port in its own slice. 3. Tests | 62-1, **A-0** (AL-Q6 decided) | 260–380 |
| **62-4** | Alert-rules screen | 1. Admin page: one row per kind + master switch, and a branch selector to edit a branch's overrides or reset a kind to the business rule (AL-Q2); it lists only kinds whose emitter already reads `AlertRulesPort`, so no switch is shown that changes nothing (RT-26, SC-005): the staff, attendance-change and orders kinds from the start; the commissions kinds (62-2c) in the sub-PR that moves their emitter onto the port; `LOW_RATING` with 61-1. 2. i18n. 3. UI tests (switch states visible; a kind not yet on the port is not listed) | 62-1, 62-2, 62-2b, 62-3 (non-rating part) | 240–340 |

**File overlap:** 57c-1 and 62-1 both touch `business_settings` and the settings module — one at a time. 59b-3 and 61-1
both add templates in `packages/notifications` — one at a time. 62-3 touches the worker orders consumers of 35b, 35d,
37 and 37b — it waits until no PR of those rows is open. **Design advisors** review 58-1 (public capability storage) and
59b-1 (key custody) before they start.

## 8. Success criteria

- **SC-001** An employee sees her month's work and estimate on her phone in under 5 seconds, and nothing about anyone
  else (0 cross-employee rows in tests and in the pilot).
- **SC-002** 0 duplicate rating messages to one customer for one business and day; 0 messages after `send_deadline`.
- **SC-003** 0 rating pages or API responses showing more than the business name and the form; 0 tokens in logs,
  events or jobs.
- **SC-004** A low rating reaches the configured recipients within 2 minutes of submit when the alert is on.
- **SC-005** Every alert kind can be switched off alone and all at once from one screen, and the switch holds from the
  next event on.
- **SC-006** Ratings never change any commission figure (a test compares the period before and after ratings).

## 9. Assumptions and governing-document amendments

- **Amendment 1 (SPEC §4):** `StaffColumns` must drop `rating_comments` (S-9: ADR-0011 §4/§7 overrides it). The
  orchestrator applies it with this spec or in a docs PR; Part A already follows it.
- **Amendment 2 (ADR-0027):** the own-scope capability list gains the four reads of D-A4 (sub-PR 57-1).
- **Amendment 3 (ADR-0010 / module-map §4):** the `notifications ⇒ customers` outcome row (D-B8).
- **Amendment 4 (IMPLEMENTATION-PLAN):** 57c-1 before 57-2 (D-A12); rows 59b and 60 wait on RT-Q1 and RT-Q2; rating
  sends go live only after 60-1 and 60-2 are deployed and verified.
- **Amendment 5 (ADR-0010 addendum, docs PR A-0):** orders as a `StaffColumnsPort` consumer (D-A3), worker orders as
  an `AlertRulesPort` consumer (D-B14) and worker customers' new `BranchScheduleHoursPort` (D-B3), with their module-map §3
  rows; before 57c-1, 57-2, 59-1 and 62-3.
- **New ADR:** the rating token codec and key custody (RT-Q1, 59b-1). Row 60-2 may need one if RT-Q11 adds a new app
  (`apps/menu` is planned in `06` §2, so Next.js itself needs no new-framework ADR, but its deploy target does).
- This spec builds no per-message cap or metering for rating messages; who bears the WhatsApp cost is outside this
  slice (per-tenant usage metering is PRD P5-T4.9).
- Rating requests and alerts are polled screens (SPEC §2: no realtime in Phase 1).
- Phase 1 has no production data; the bootstrap of 59-1 (FR-B02b) schedules only requests whose deadline is still ahead.
