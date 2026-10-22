# Phase 1 — Implementation Plan

> **v7 · 2026-10-01** · implements `docs/specs/phase-1/SPEC.md` v7. Rules as in Phase 0: **one use case per PR**, in
> the order contract → migration + RLS → domain + tests → use case → adapters → integration tests → screen; Codex
> reviews every PR; `pnpm check` and `ci-gate` green before merge; a business rule not in the spec is a `TODO(spec)`
> and a stop.

---

## 1. Gates — each its own PR (or input) before the work that needs it

| Gate | What                                                                              | Size | Before       |
| ---- | --------------------------------------------------------------------------------- | ---- | ------------ |
| G1   | ADR-0010: Phase 1 ports and events (SPEC §3) + `module-map.md` §3/§4 and its YAML | S    | PR 4         |
| G2   | ADR-0012: `SECURITY DEFINER` pending-outbox count for approval, grants, tests     | S    | PR 53        |
| G3   | ADR-0011 + `CLAUDE.md` §5: the public rating link                                 | S    | PR 58        |
| G4   | ADR-0013: Better Auth `passkey` plugin + platform WhatsApp suppression            | S    | PRs 5, 20    |
| G5   | ADR-0014: email provider                                                          | S    | PR 14        |
| D-55 | The salon's real plan rules (input from the client, no build days)                | —    | ✅ supplied 2026-10-05, completed 2026-10-07 |

**Named exceptions to the template:** PRs 1–3 are shells (no domain). PRs 29–31 are domain-only (pure functions,
fixtures, no database or screen) and are the **one parallel track**: they touch no shared file and may run beside
M1–M3. Everything else is serial by default; since 2026-10-07 (Waleed, constitution 3.0.0) up to three PRs may be in
flight when their file paths are disjoint, each merged only when green.

---

## 2. PRs — one use case each

Nominal size: **S** = 2 focused days, **M** = 4, **L** = 7 (the Phase 0 convention; §3).

| #   | PR                                                                                                                  | Size         | Depends on         |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------ |
|     | **M1 · shells and access**                                                                                          |              |                    |
| 1   | `packages/ui`: RTL kit, tokens, Arabic font, lucide                                                                 | M            | —                  |
| 1b  | GET /v1/me/workspaces (memberships → companies, businesses, branches)                                               | S            | —                  |
| 2   | `apps/admin` shell: login, TOTP, tenant selector, generated client                                                  | M            | 1, 1b              |
| 3   | `apps/pos` shell: PWA, device pairing screen                                                                        | M            | 1                  |
| 4   | `notifications`: WhatsApp channel, templates ar/en, delivery log                                                    | M            | G1                 |
| 4b  | in-app notification channel: store, list, mark read (admin bell)                                                    | M            | 4                  |
| 5   | platform suppression + WhatsApp "stop" callback                                                                     | S            | 4, G4              |
| 6   | staff OTP login (`OtpSender` bound at the composition root)                                                         | S            | 3, 4, 5            |
| 7   | permissions screen: role defaults + per-person ALLOW/DENY                                                           | M            | 2                  |
| 7b  | per-person discount limit (`limit_bps` on the discount permission)                                                  | S            | 7                  |
| 7c  | business default discount limit (settings)                                                                          | S            | 7b                 |
|     | **M2 · staff**                                                                                                      |              |                    |
| 8   | `create-employee`                                                                                                   | S            | 7                  |
| 8b | duplicate-name warning on create / update employee: a soft "same name exists, add the full four-part name?" prompt, never a block (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 8, 9 |
| 8c | employee number on every employee: assigned, then added as a NEW field to the attendance board contract/query/generated client/tests (27a has no such field today), and shown in profile, lists, board, report, CSV and the official statement (Abu Salem's AB-Q10 pick, Waleed 2026-10-12; questions EN-Q1…Q4, batch 14, spec 051; auto-assigned sequentially per company in hire-date order, digits only, unique per company, editable by the owner, never reused after deletion; batch 17, Waleed 2026-10-13: EN-Q5 owner sets the starting number once (default 1), EN-Q6 the counter continues on its own ignoring manual edits and skips any number already used, EN-Q7 same hire date → created first gets the lower number and deleted employees are numbered too, EN-Q8 whole number 1–999999 with no leading zeros, EN-Q9 optional on create (blank = auto) and searchable in the staff list and the reception performer picker; batch 27, Waleed 2026-10-17, settles how the one-time starting number (EN-Q5) meets the backfill of existing employees, which runs before the setting screen exists: EN-Q10 the numbers already given stay (for example 1, 2, 3 when the owner then picks 1000 as the start) and the start only affects new employees (the first new one gets the start), the start is chosen once and the counter never goes back; EN-Q11 new owner-grantable permission `manage:employee-number:company`, EN-Q12 no import column, EN-Q13 the derived rules confirmed, EN-Q14 a number freed by a hand edit may be given again; spec 051 sub-PRs are ready) | S | 8, 27a, 27b |
| 9   | `update-employee` (incl. branches)                                                                                  | S            | 8                  |
| 9b | employee IBAN on the employee record: masked to the last 4 except with the salary-style restricted read, audited on change; not a document type (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 9, 10 |
| 10  | `set-salary` (one entry per date, any date, audited, restricted read, `SalaryChanged`)                              | S            | 8, G1              |
| 11  | import framework (template, preview, all-or-nothing) + employee import                                              | M            | 8                  |
| 12  | `files`: presigned upload/download with stored permission, access audit                                             | M            | 7                  |
| 13  | document types + `record-employee-document`                                                                         | S            | 8, 12              |
| 13b | employee-document access defaults to the owner only: `read:files:business`, `manage:files:business` and `manage:document-types:company` leave the manager role defaults and stay grantable by the owner to any human role or person; employee import uploads also require owner-granted read + manage files (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 7, 13 |
| 14  | email channel                                                                                                       | S            | 4, G5              |
| 15  | document-expiry job                                                                                                 | S            | 13, 14             |
| 16  | schedules + templates                                                                                               | M            | 8                  |
| 16b | fixed break window per employee per shift (from–to) in schedules and templates (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)); 16b-2 adds return-from-break lateness and, by the owner's BW-Q5 change on 2026-10-10, the manager alert when she does not clock back in from the break (spec 041) | S | 16 |
| 16c | **Implemented locally (spec 042); FR-013 owner decision pending: isolated batches measured 200.9 / 289 ms against 200 ms; cap remains 20.** Max shifts starting on one day becomes an owner setting, allowed 1–4, default 3 (was a fixed 2); one shift stays at most 16 h; long holiday stretches are consecutive shifts with no minimum gap (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 16 |
| 16d | default working hours and break length on the employee profile, set by the owner in the staff list (a working day may be 12 h, not 8) — the partner's BW-Q4 comment, 2026-10-10 ([spec 041 owner-questions](../041-staff-schedule-break-window/owner-questions.ar.md)); needs its own spec and owner questions | S | 8, 16b |
| 16b-3 | break return at another branch counts as the return: no "did not come back" alert; the branch manager instead gets a notice that she returned from the break at the other branch (Abu Salem's BW-Q10 pick, approved by Waleed 2026-10-11; follow-up to 16b-2) | S | 16b |
| 16d-3 | "same hours for all days" button on the employee default-hours screen: fills every working day with one time range and leaves days off empty; each day still editable (Abu Salem's DH-Q2 pick, approved by Waleed 2026-10-11) | S | 16d |
| 17  | `request-leave`                                                                                                     | S            | 8                  |
| 18  | `decide-leave`                                                                                                      | S            | 17                 |
|     | **M3 · attendance**                                                                                                 |              |                    |
| 19  | QR issuer + attendance screen                                                                                       | M            | 3                  |
| 20  | `enrol-passkey`                                                                                                     | M            | 6, 8, G4           |
| 21  | `unbind-passkey` + the two-employees-one-device flag                                                                | S            | 20                 |
| 21b | a phone bound by passkey to one employee refuses another employee's clock-in (block, replacing the warn-only two-employees flag for passkey devices; the shared reception card device is unaffected) (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 21, 22 |
| 22  | `clock-attendance`: state machine, geofence, 5-minute dedupe                                                        | M            | 16, 19, 20         |
| 23  | `clock-by-card` on the paired device                                                                                | S            | 22                 |
| 24  | suspected / missed-out job                                                                                          | S            | 22                 |
| 25  | `resolve-attendance-exception`                                                                                      | S            | 24                 |
| 26  | `correct-attendance`                                                                                                | S            | 22                 |
| 26a | attendance change requests: a manager requests a manual day or a void, the owner approves or rejects; both steps audited (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | M | 26 |
| 26b | `add-manual-session` (source MANUAL, reason, actor recorded — spec 035 CA-Q6) — applied only after owner approval through 26a (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 26, 26a |
| 26c | `void-attendance-session` (kept, marked voided with who/when/why, out of reports — spec 035 CA-Q6) — applied only after owner approval through 26a (owner review 2026-10-09, [owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)) | S | 26, 26a |
| 27  | attendance board + monthly report + CSV (row 21b: the shared-phone pair list is replaced by the refused-attempt list, query `attendance-device-refusals`); split into 27a board API, 27b monthly report + CSV API, 27c board/report screens, 27d exceptions/correction/request screens (spec 049, AB-Q1) | M            | 25, 26, 16d        |
| 27g | official attendance statement (a month or any date range) PDF per employee / per branch with the business logo and official name, «issued by PosPay» footer, audited download (Abu Salem's AB-Q10 pick; questions ST-Q1…Q5, batch 14; needs `packages/documents` PDF renderer; filters: employee / date range / shift; signature lines; language ar/en chosen at download (ST-Q4); every download audited with who, when, form, branch, employee, period, shift filter and language (ST-Q5); a missing clock-out day stays uncounted until fixed through the existing manual-correction flow (rows 26/26a)) | M | 27, 8c, 27h, 27i |
| 27h | business identity settings: the owner uploads the business logo and types the official name ar/en once per business; the statement falls back to the name when no logo (ST-Q1, batch 14, recorded in spec 051's owner-questions; this row's spec is 052). The logo file is owned by the `files` module (content-type detection, size cap, full re-encode, R2 key generated by us); settings stores only the file reference — the settings → files read arrow needs an ADR (ADR-0046); spec 052, owner questions BI-Q1…BI-Q4 answered (batch 28: a new owner-only permission `manage:business-identity:business`, a 10 MiB logo like every file); split 27h-1a permission, 27h-1 names, 27h-2 files rules, 27h-3 logo retire consumer (before any producer), 27h-4 `set-business-logo`, 27h-5 admin screen | S | 2, files upload |
| 27i | PDF renderer pulled forward from P5-T2 for 27g: `packages/documents` Playwright HTML→PDF renderer run as a worker job (>200 ms), ar/en RTL templates, the PDF is streamed to the requester as a download and not stored (no cross-module write; storing a copy later needs a files-owned handoff + ADR); ADR required for bringing the renderer into Phase 1 | M | 27, 27h-4 |
| 28  | not-clocked-in alert: detection + once-only notice + `ShiftNotClockedIn`, in-app to the branch's managers by a fixed interim rule (spec 036, ADR-0037; owner 2026-10-08) | S            | 22, 15, 4b         |
| 28b | staff web push: subscriptions table + RLS, staff-session subscribe/unsubscribe, custom service-worker push handler, `push` channel adapter; delivers the employee's own not-clocked-in notice (spec 036 NC-Q3). ADR first: `web-push` library, VAPID key custody (`CLAUDE.md` §8), the staff-session route exception. iOS delivers web push only to the PWA added to the home screen Push text is rendered in a stored per-user language preference (added here), per the owner, 2026-10-08. **Spec 063 / ADR-0052 split it into 28b-1 (subscriptions + routes), 28b-2 (attempts + consumer), 28b-3 (web-push channel + processor), 28b-4 (PWA), 28b-5 (employee's not-clocked-in recipient, after 28b-3 and 62-2); the control sits on the existing personal screen, so 57b's shell is not a blocker (spec 063 TD-3).** | M            | 3, 57b, 28         |
| 28c | "your shift ends soon" reminder to the employee by push, default 30 min before shift end, lead time editable from the dashboard (row 62); new SPEC §3 event + module-map row through the ADR-0010 process (owner 2026-10-08) | S            | 28b, 62            |
|     | **M4 · engine (parallel track, domain only)**                                                                       |              |                    |
| 29  | engine I: order, shares, overrides, base, MARGINAL (SPEC §5.1–5.5)                                                  | M            | —                  |
| 30  | engine II: WHOLE, SESSIONS, salary multiple, versions, package sale, §5.7 validation, §5.8 hand-calculated fixtures | M            | 29, D-55           |
| 31  | package allocation and slots (`orders/domain`, SPEC §8)                                                             | S            | —                  |
|     | **M5 · catalog, customers, sessions**                                                                               |              |                    |
| 32  | services (create / update)                                                                                          | S            | 11                 |
| 32b | services import                                                                                                     | S            | 32                 |
| 33  | package types                                                                                                       | S            | 32                 |
| 33b | package types: stop selling / resume selling (owner PT-Q5, 2026-10-08) — before PR 42                               | S            | 33                 |
| 34  | customers: find-or-create by phone                                                                                  | S            | G1                 |
| 34b | customers import                                                                                                    | S            | 34, 11             |
| 35  | `record-service-session` — effective discount up to the limit only; above it refused                                | L            | 32, 34, 9, 7c      |
| 35d | edit price / discount of a saved service line, audited, with the same effective-discount limit as row 35 (half-up to the mill, a fraction above the limit is refused) (SS-Q10 = option 2, Waleed 2026-10-12; spec 050; batch 17, Waleed 2026-10-13: ED-Q1 new delegable permission «edit session price/discount» defaulting to owner, general manager, business manager, branch manager; ED-Q2 the editor's own limit; ED-Q3 same window as recording, an approved/paid month gets a correction in the next month; ED-Q4 no editing a line you performed; ED-Q5 typed reason required; ED-Q6 a bell to the branch manager on every edit; ED-Q7 edit from the branch day list AND from the reception screen for lines just saved; ED-Q8 «changed» badge with before/after/who/when history; plan: `050-…/plan-35d.md`, edit event and bell: ADR-0044, issue #189) | M | 35 |
| 36 | `record-tip`: a tip per employee and method (CASH/CARD) for a saved visit, recorded by whoever may record a visit and never by the employee for herself; same back-dating window as recording; a wrong tip is replaced (new revision) with a written reason, audited, no bell; the screen suggests the split by each performer's share of the visit net (TP-Q1…TP-Q4, batch 26, and TP-Q5…TP-Q8, batch 29; spec 053); split 36-1 storage, 36-2 pure domain, 36-3a contracts/errors/pure rules/event type/ports, 36-3b `record-session-tips` use case + storage access + event `SessionTipsChanged`, 36-3c HTTP + current-set read, 36-4 reception screen, 36-5 public reader `listCurrentSessionTips` that **row 50 must bootstrap from before approval opens** (spec 053 BR-08) | S | 35 |
| 37 | `cancel-service-line`: a manager cancels one saved service line (negative commission: removed in the same month before approval, a correction on the next month after it; SPEC §6, M4) with a written reason, a bell to the branch managers and a «cancelled» mark with its date; new delegable permission, nobody cancels a line he or she performs; blocked while a performer would keep a tip and have no active line (CX-Q1…CX-Q4, batch 26; spec 054; CX-Q5, batch 30, is answered: a cancel is final and a mistaken cancel is fixed by recording the service again); split 37-1 contracts/template/map, 37-2 permission + `service_line_cancellations` + `UPDATE (status)` grant, 37-3 bell consumer (`orders.line-cancel-notice-v1`), 37-4a/4b/4c writer (4b waits on **36-1** for the tip guard), 37-5 manager day list; redeemed package lines are refused here and handled by row 44, package-sale lines are refused here and handled by row 46 | M | 35, 35d, **36-1** (37-4b only) |
| 37b | `change-line-performers`: a manager replaces the performers (one to four) and shares of one saved service line (price, discount and net never move; commission follows the performers: two corrections after approval, SPEC §6, M12) with a written reason, a bell to the branch managers and a «changed» mark with its date; new delegable permission `change:service-line-performers:branch`, nobody changes a line he or she performs or puts himself or herself on it (a removed performer stays blocked), same period as recording, same recording rules (PF-Q1…PF-Q4, batch 26, and PF-Q5, batch 31; spec 055); split 37b-1 contracts/template/map, 37b-2 permission + `service_line_performer_changes` + `DELETE` grant (design advisors first), 37b-3 bell consumer (`orders.line-performers-notice-v1`), 37b-4a/4b/4c writer, 37b-4d retained-identity read wired into the 35d, 054 and 36 writers (before 37b-4c; independent of 37b-4a), 37b-5 manager day list; tips follow TP-Q6 (batch 29: a tip stays recorded; no tip code here); PF-Q5 (batch 31) is answered: a performer who stays is not re-checked | M            | 35, 35d            |
| 38  | `request-discount-approval` (proposal with terms hash)                                                              | S            | 35, 7              |
| 39  | `approve-discount` by PIN on the device                                                                             | S            | 38                 |
| 40  | `approve-discount` remotely                                                                                         | S            | 38                 |
| 41  | above-limit discounts: consume the approval in the line's transaction (M2)                                          | S            | 39, 40             |
|     | **M6 · packages**                                                                                                   |              |                    |
| 42  | `sell-package`                                                                                                      | M            | 33, 31, 35         |
| 43  | `redeem-package-session` under a row lock                                                                           | M            | 42                 |
| 44  | `cancel-redemption`                                                                                                 | S            | 43                 |
| 45  | `extend-package`                                                                                                    | S            | 42                 |
| 46  | `refund-package`                                                                                                    | M            | 43                 |
| 47  | import open packages                                                                                                | S            | 43                 |
|     | **M7 · commissions**                                                                                                |              |                    |
| 48a | statements table + the period lock helper (every period writer uses it)                                             | S            | 30                 |
| 48  | plan versions + builder screen + validation                                                                         | M            | 48a                |
| 49  | service overrides                                                                                                   | S            | 48                 |
| 50  | projection consumer (lines, sales, tips, salaries) + estimate on read; **tips bootstrap from 36-5 `listCurrentSessionTips` with revision guards, discharge of the covered outbox events in `consumed_events`, a per-session revision freshness check and a coverage test, before approval opens** | M            | 10, 35, 36, **36-5**, 42, 48 |
| 51  | `generate-statement` + fingerprint                                                                                  | M            | 50                 |
| 52  | `review-statement`                                                                                                  | S            | 51                 |
| 53  | `approve-statement` (atomic)                                                                                        | M            | 52, 55b, G2        |
| 54  | `mark-statement-paid`                                                                                               | S            | 53                 |
| 55  | corrections: generations, PAID too, target lock order, tips, salaries — tested on seeded closed periods             | M            | 51                 |
| 55b | blocked corrections + period repair (NO_PLAN / NO_SALARY in a closed period)                                        | S            | 55                 |
| 56  | statement Excel export with the tips columns                                                                        | S            | 53                 |
| 56b | approval reminders on the 3rd and 5th                                                                               | S            | 53                 |
| 57  | staff app: my sessions and estimate                                                                                 | M            | 50, 57c-1          |
| 57b | staff app: my attendance and my leave                                                                               | S            | 22, 17, 57c-1      |
| 57c-1 | staff-columns setting: storage and `StaffColumnsPort` (spec 060 sub-PR 57c-1), which row 57's reads need          | S            | spec 060 A-0       |
| 57c | staff-columns setting: the admin screen (spec 060 sub-PR 57c-2)                                                     | S            | 57, 57c-1          |
|     | **M8 · ratings and alerts**                                                                                         |              |                    |
| 58  | customer opt-out on the rating page                                                                                 | S            | 34, G3             |
| 59  | rating scheduling (due time, send deadline)                                                                         | S            | 35, G3, spec 060 A-0 |
| 59b | at-most-once rating send: authoritative claim through `DaySessionsPort`, attempt row under the phone lock           | S            | 59, 4, 5           |
| 60  | rating page + `submit-rating`                                                                                       | S            | 59b                |
| 61  | low-rating alert + averages                                                                                         | S            | 60                 |
| 62  | alert-rules screen + master switch; replaces row 28's interim fixed rule (on, 20 min, managers, in-app) and owns row 28c's lead-time setting | S            | 4b, 15, 28, spec 060 A-0 |
| 62b | email and WhatsApp delivery of team alerts, after an ADR on reading team contacts (AL-Q6, PP-18.26)          | S            | 62; the ADR on reading team contacts (ADR-0003 amendment, AL-Q6) |
|     | **M9 · pilot**                                                                                                      |              |                    |
| 63  | real data by import, dry-run week, parallel month, comparison (D-45); the salon pilot starts only on the new server (D-11, owner review 2026-10-09)                                                | S + calendar | every row except 58–61 (the rating track, postponed by RT-Q1, PP-18.9, with the low-rating bell of spec 060 sub-PR 62-3); the new server with point-in-time recovery (D-11) |

---

## 3. Duration

**Update 2026-10-11:** rows 16b-3 and 16d-3 add two S PRs (+4 focused days); the rows added since v7 (8b, 9b, 13b, 16b–16d, 21b, 26a–26c, 27 split, 28b/28c, …) are not yet re-totalled below — the figures stay the v7 nominal baseline until the next plan revision.

**Nominal, from the table:** 5 gates and 49 PRs at S (108 days), 25 at M (100), 1 at L (7) = **215 focused days ≈ 43
weeks for one developer** — the figure given to the client until Phase 1's own pace is measured. If the engine
track (PRs 29–31, 10 days) is handed to a second implementer, the critical path is ≈ 41 weeks.

**Scenario, not a commitment:** Phase 0 was forecast at 6–8 weeks and delivered in about 10 calendar days
(2026-09-22 → 2026-10-01). If Phase 1 ran at the same ratio it would take ≈ 8–10 calendar weeks — but one phase is not
a trend, and Phase 1 has screens and client inputs that Phase 0 did not.

**Re-forecast** after M2 from the measured days per PR, and tell the client then. On top of build: **+5 calendar
weeks** of pilot, not compressible, plus one more validation cycle if the parallel month finds engine differences.

Largest risks: the engine's combinations (M4 — hand-calculated fixtures, started first); approval racing live data
(PR 53 — the atomic protocol and its race tests); package concurrency (PRs 43, 46 — row locks and race tests).

---

## Recorded for later phases — owner review 2026-10-09

Decided by the owner on 2026-10-09 ([owner-review-2026-10-09.ar.md](owner-review-2026-10-09.ar.md)); not Phase 1 rows.

- Face-recognition clock-in on the POS device (D-13, CB-Q1). Needs an ADR first: image privacy, consent, storage. Phase 1 keeps the card.
- Payroll components (S021-1): work-permit salary, actual salary, overtime, leave allowance, advance, gift, food, housing and transport allowances, with two Excel exports (work-permit salary; allowances). Row 10 stays base salary only.
- Product-sale commission (D-37), with product selling.
- Per-service barcode slip for the staff member (D-15): the invoice is the customer's, the barcode is the staff member's.

---

## 4. Where the implementer must stop and ask

- A commission case SPEC §5.7 cannot express — a new calc or `from` kind by decision, never an `if`.
- Any screen, export or log that would show a customer's full phone, or a salary without the permission.
- Any module arrow or event not in SPEC §3.
- The salon's real plans or data contradicting the spec — raised when they arrive (D-55), not at the pilot.

---

## 5. Debate log — verdict tables

Rounds 1–3 ran on Codex `gpt-6-sol` (high) against v1–v3; every finding was accepted and is closed in the text
(30, 17 and 11 findings; round-3 closure audit in PR #49's history). Round 4 ran on Codex `gpt-6.1-sol` (high)
against v4, as a fresh full review.

### Round 4 — `gpt-6.1-sol` high, against v4

| #   | Finding                                    | Sev | Verdict | Reason                                                                                                                                                  |
| --- | ------------------------------------------ | --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Corrections stop at PAID                   | P1  | accept  | "Closed" = APPROVED or PAID (§6)                                                                                                                        |
| 2   | Correction target can close mid-post       | P1  | accept  | Ascending lock order, recheck, corrections in the target's fingerprint (§6)                                                                             |
| 3   | Card tips bypass approval                  | P1  | accept  | `SessionTipsChanged`, tip projection, frozen tip lines, TIP corrections (§3, §4, §6)                                                                    |
| 4   | Approval ships before corrections          | P1  | accept  | PR 55 before PR 53; PR 48a lock helper before plan writers                                                                                              |
| 5   | Effective dates without timezone           | P2  | accept  | Business dates in the business timezone, resolved before the engine (§5)                                                                                |
| 6   | Override rounding unspecified              | P2  | accept  | One `roundKwd` on every rule path (§5.2)                                                                                                                |
| 7   | FIXED step at the line's endpoint          | P2  | accept  | Half-open interval; endpoint step not touched; fixture 5.500 (§5.5)                                                                                     |
| 8   | Missing plan or salary                     | P2  | accept  | D-57: named errors, record allowed, review/approval blocked (§5)                                                                                        |
| 9   | Discount limit undefined                   | P2  | accept  | D-56: `limit_bps` per person + business default; (list − net) / list; PRs 7b, 7c                                                                        |
| 10  | No performer-change use case               | P2  | accept  | PR 37b `change-line-performers`                                                                                                                         |
| 11  | Eventual consistency vs cancel-before-send | P2  | accept  | Claim reads `DaySessionsPort` synchronously (§10)                                                                                                       |
| 12  | Sending after closing                      | P2  | accept  | `send_deadline`; late claim → CANCELLED (D-58)                                                                                                          |
| 13  | STOP race with the send                    | P2  | partial | Phone-hash lock serializes check, attempt and STOP; guarantee stated as "attempts not yet authorized" — a message handed to WhatsApp cannot be recalled |
| 14  | Page opt-out bound across businesses       | P2  | accept  | Bound stated per business (§10)                                                                                                                         |
| 15  | Package inputs unvalidated                 | P2  | accept  | One validator, named errors, at preview and commit (§4)                                                                                                 |
| 16  | Package retries                            | P2  | accept  | `Idempotency-Key` on sale and redemption; one-time conditional reversal (§8)                                                                            |
| 17  | IN_APP channel missing                     | P2  | accept  | PR 4b in-app channel                                                                                                                                    |
| 18  | Exactly 16 h                               | P2  | accept  | `< 16 h` closes, `≥ 16 h` missed; both lock the open session (§7)                                                                                       |

### Round 5 — `gpt-6.1-sol` high, against v5

| #   | Finding                                        | Sev | Verdict | Reason                                                                                               |
| --- | ---------------------------------------------- | --- | ------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Salary commit can change an approved month     | P1  | accept  | Salary is an event input (`SalaryChanged`) applied under the period locks → correction (§3, §6)      |
| 2   | A missing historical salary cannot be repaired | P1  | accept  | Back-dating allowed, audited, only into unclosed periods (§4, §6)                                    |
| 3   | Late NO_PLAN line in a closed period           | P1  | accept  | Event consumed, blocked correction, audited period repair; blocks the target's approval (§6, PR 55b) |
| 4   | Package-only seller escapes NO_PLAN            | P2  | accept  | NO_PLAN covers sales; disabled `package_sale` pays 0 (§5)                                            |
| 5   | Deadline not enforced at the send              | P2  | accept  | Event carries `send_deadline`; notifications refuses after it (§10)                                  |
| 6   | Due-time cap vs R2                             | P2  | accept  | Owner decided: send at closing — `due_at = min(+1 h, closing)` (D-58 amended)                        |
| 7   | Attribution after the claim                    | P2  | accept  | Attribution fixed at the claim; D-52 amended to "cancelled before the claim"                         |
| 8   | Zero list price                                | P2  | accept  | Effective discount 0 % at list 0 (§4)                                                                |
| 9   | Package lines and the discount limit           | P2  | accept  | Redemption list price = slot value; the package's discount is checked on its sale line (§4)          |
| 10  | First clock-in race                            | P2  | accept  | `AttendanceState` row locked by every scan; one open session per employee (§4, §7)                   |
| 11  | Refund quantity                                | P2  | accept  | Positive integer, exact or `INSUFFICIENT_SLOTS` (§8)                                                 |
| 12  | CANCELLED transitions                          | P2  | accept  | Reasons and transitions; `NO_ACTIVE_LINE` reopens before the deadline (§4, §10)                      |

### Round 6 — `gpt-6.1-sol` high, against v6 (final round of three)

| #   | Finding                              | Sev | Verdict | Reason                                                                                                                                                         |
| --- | ------------------------------------ | --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Salary history has no selection rule | P1  | accept  | One entry per (employee, date), replacement on the same date; latest date on or before the period's last day; event identity and revision defined (§3, §4, §5) |
| 2   | Back-date guard has no contract      | P2  | accept  | Guard removed instead of adding a cross-module read: any date, audited; closed periods get corrections (§6) — simpler and the same audit trail                 |
| 3   | Zero-length send window at closing   | P2  | accept  | `send_deadline` = closing + 30 min (D-58 amended); test advances the clock through claim and dispatch                                                          |

The debate budget (three rounds on `gpt-6.1-sol`) is spent; every finding of every round is accepted or partially
accepted with a stated reason, and no P1 remains open.

## PR 6 amendment — ADR-0019, 2026-10-02

PR 6 remains dependent on PRs 3/4/5 and implements existing global users on a paired POS, with active device-scoped membership plus explicit login:staff:branch. Staff/cashier bundles are explicit; Owner/admin authority alone is insufficient. OTP defaults disabled and incomplete activation closes only its capability; production API/worker stay ready with empty notification settings. Auth-owned deterministic derivation uses independent verification MACs, a hash-only global ledger, acknowledged PREPARED→PENDING release, bounded worker wait outside DB connections, at-most-once execution and shared Redis admission. All admitted outcomes share the 200 ms 202 window. Sessions use Better Auth with isolated staff cookie and original eight-hour deadline, without idle timeout or renewal, and are revalidated online on every request. Recovery uses the employee's own PIN with manager assistance; no impersonation or STOP bypass. Login does not open a shift or record attendance.

The slice includes contracts/schema and exact grants, auth facade/guards, both composition roots, POS generated client/i18n/cache clearing, secret-free observability, environment/deploy injection and independent readiness smoke. ADR-0019 §7 is the complete test obligation. Before PR 20, resolve personal-phone/passkey enrollment and use the scoped staff verification contract; never auto-enroll the shared kiosk. PR 22 still requires per-clock UV, QR and presence proof. Final bilingual Meta copy/names/components and recovery copy remain TODO(spec), blocking live activation until approved.

## Spec 060 amendment — rows 57c, 62, 62b and 63, 2026-10-21

Row 62 no longer depends on row 61: RT-Q1 (PP-18.9) postpones the rating track to the end of the project, and the
alert rules proceed without it; the `LOW_RATING` kind joins them when the track resumes (spec 060 §B, sub-PR 61-1).
Row 63 (the salon pilot) depends on every row except 58–61 and that low-rating part of row 62, so the pilot does not
wait for the postponed track.

Row 57c is split: 57c-1 (the setting's storage and `StaffColumnsPort`) no longer depends on row 57, because row 57's
and 57b's reads need that port (spec 060 D-A12), so rows 57 and 57b now depend on 57c-1; the rest of 57c (the admin
screen) still depends on row 57. Row 62b is new:
AL-Q6 (PP-18.26) keeps row 62 in-app only and moves team email and WhatsApp to 62b, after an ADR on reading team
contacts (ADR-0003). Rows 59 and 62 also wait for spec 060's docs PR A-0 (the ADR-0010 addendum for the new ports
59-1 and 62-3 use), and row 62b for that contact-read ADR.
