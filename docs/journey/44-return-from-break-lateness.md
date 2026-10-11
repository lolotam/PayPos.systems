# 44 · Return from break: lateness and the "not returned" alert — الرجوع من البريك والتنبيه لو ما رجعتش

**Status / الحالة:** shipped in #147 (PR 16b-2, merged). The API and the worker are live on staging (api + worker at
commit `6c220e4`, 2026-10-11); the admin and POS apps are **not** deployed yet (issue #54), so the bell and the clock
screens run locally only. Your decision BW-Q5 (changed on 2026-10-10 to the partner's pick, option 2) applies: she
**clocks out and back in for the break**; the return is measured against the **break end** with the usual 10-minute
grace, and if she clocked out for the break and has not come back 10 minutes after it ends, the branch's managers get a
bell message. Also BW-Q8 to BW-Q11 ([owner-questions.ar.md](../specs/041-staff-schedule-break-window/owner-questions.ar.md)).
It builds on the break you set in [43](43-schedule-break-window.md) and the clock in [26](26-clock-attendance.md) /
[30](30-employee-cards-and-clock-by-card.md). Attendance never changes pay or commission.

**Before you start / قبل ما تبدأ:**
- [43](43-schedule-break-window.md) done: branch Salmiya (فرع السالمية), سارة with a shift `09:00`–`17:00` and break
  `13:00`–`14:00` on the test day. Run `pnpm db:migrate` (the `attendance_break_not_returned_notices` table) and
  `pnpm db:seed`. API **and worker** running (the worker runs the alert job every 5 minutes, the same company job as the
  not-clocked-in alert, [36](36-not-clocked-in-alert.md)).
- A controlled clock for the 10-minute boundaries (the tests inject it; on staging you cannot move time, so use the API
  assertions below with a test fixture rather than waiting).
- Synthetic users: the Owner, the General Manager, the Business Manager and the Salmiya Branch Manager (each should see
  the bell message), and a manager of another branch (must not).
- Clocking works as in 26 / 30: personal QR + passkey, or the card at reception. Never use real staff data.

## العربي

**الجزء الأول: التأخير عند الرجوع من البريك**

1. **رجوع في المعاد:** سارة تبصم حضور `08:58`، وتبصم خروج `13:00` للبريك، وتبصم حضور تاني `14:05` ← الحضور التاني
   **دقائق التأخير للتقرير فقط، دون خصم عمولة** ما تظهرش (التأخير صفر)، لأنه اتقارن بنهاية البريك `14:00` مش ببداية الوردية
   `09:00` (5 دقايق جوّه السماح 10 دقايق). بداية الوردية المحفوظة في الجلسة بقت نهاية البريك.
2. **رجوع متأخر:** نفس اليوم لكن الرجوع `14:12` ← **دقائق التأخير للتقرير فقط، دون خصم عمولة: 12** (دقايق كاملة بعد نهاية البريك،
   من غير خصم السماح). `14:10` بالظبط ← صفر. `14:11` ← 11.
3. **رجوع بدري:** الرجوع `13:45` (قبل نهاية البريك) ← صفر.
4. **أول حضور بعد بداية البريك مش رجوع:** هبة ما حضرتش الصبح وبصمت أول مرة `13:30` ← بتتحسب متأخرة من بداية الوردية (270 دقيقة)،
   مش من نهاية البريك. محدش يخبي تأخير وراء البريك.
5. **من غير بريك:** نفس الوردية من غير بريك، ورجوع `14:05` ← الحساب القديم زي ما هو (مقارنة بـ `09:00`).
6. **خروج ورجوع بره البريك:** خروج `11:00` ورجوع `11:20` على وردية بريكها `13:00`–`14:00` ← مش رجوع من بريك؛ الحساب القديم زي ما هو،
   والـ 20 دقيقة اللي برّه البريك مش وقت شغل. الوقت اللي سارة بتكون فيه مبصّمة خروج **جوّه** البريك بيتحسب شغل (للتقرير بعدين).
7. الجلسة اللي اتقفلت `MISSED_OUT` (نسيت تبصم خروج) مش بتعتبر رجوع. بصمة حضور من نهاية الوردية وبعد كده مش رجوع.

**الجزء التاني: تنبيه المدير**

8. سارة بصمت حضور `08:58` وخروج `13:02` وما رجعتش. الـ job بيشتغل كل 5 دقايق. قبل `14:10` (نهاية البريك + 10 دقايق)، مثلاً `14:09` ←
   مفيش حاجة. من `14:10` وقبل `17:00` ← جرس صاحب الشركة والمدير العام ومدير النشاط ومدير فرع السالمية كل واحد يظهر عليه رسالة واحدة
   **غير مقروء**:
   **لم يُسجَّل رجوع سارة من البريك المنتهي الساعة 14:00 في فرع السالمية** (بلغة واجهة اللي بيشوفها: بالإنجليزي
   **Sara has not clocked back in from the break that ended at 14:00 at Salmiya**). مدير فرع تاني ما يشوفش حاجة.
9. **مرة واحدة:** شغّل الـ job تاني أو على workerين مرة واحدة ← مفيش رسالة تانية. الرسالة اللي اتبعتت ما بتتسحبش حتى لو سارة
   رجعت بعدها.
10. **مفيش تنبيه لما:**
    - سارة ما بصمتش خروج للبريك خالص (جلسة الصبح لسه مفتوحة).
    - بصمت خروج `11:00` ومرجعتش (مش جوّه البريك). الخروج بيتحسب بريك من 10 دقايق قبل بداية البريك: `12:50` يتحسب و`12:49` لأ، والخروج بالظبط
      عند نهاية البريك لأ.
    - رجعت قبل ما الـ job يقرر (مثلاً `14:30` والـ job `14:35`)، أو رجعت في فرع تاني (لازم نفس الفرع، وإلا التنبيه يطلع).
    - الوردية خلصت (`17:00` وبعده)، أو التنبيه كان هيقع بعد نهاية الوردية (بريك `16:00`–`16:55` مثلاً).
    - إجازة معتمدة بتغطي من نهاية البريك لنهاية الوردية (الإجازة اللي بتخلص بدري بتأخر التنبيه لنهايتها + 10 دقايق). الإجازة المعلقة ما بتعفيش.
    - الموظفة اتحذفت أو عقدها خلص.
11. **لو خرجت مرتين جوّه البريك** (خروج `13:00`، رجوع `13:10`، خروج `13:20`): آخر خروج هو اللي بيتحسب، ولازم الرجوع يبقى بعده.

**ممنوع يحصل:**
- خصم عمولة أو مرتب بسبب التأخير، أو اختراع ساعات.
- تنبيه لموظفة ما بصمتش خروج للبريك، أو لموظفة رجعت قبل الـ job.
- أكتر من رسالة عن نفس الوردية، أو سحب رسالة اتبعتت.
- تنبيه يغير الحضور أو التأخير أو الجلسات أو يضيف استثناء.
- رسالة تظهر لمدير فرع تاني أو لشركة تانية.

## English

**Part 1: lateness on returning from the break**

1. **Back on time:** Sara clocks in at `08:58`, clocks out at `13:00` for the break, and clocks in again at `14:05` → the
   second clock-in shows no **Reported late minutes (no commission deduction)** line (lateness is zero), because it is
   compared with the break end `14:00`, not the shift start `09:00` (5 minutes, inside the 10-minute grace). The session's
   stored scheduled start is now the break end.
2. **Back late:** same day, return at `14:12` → **Reported late minutes (no commission deduction): 12** (whole minutes after
   the break end, grace not subtracted). Exactly `14:10` → zero. `14:11` → 11.
3. **Back early:** return at `13:45` (before the break end) → zero.
4. **A first arrival after the break start is not a return:** Heba never came in the morning and clocks in for the first time
   at `13:30` → she is late from the shift start (270 minutes), not from the break end. Nobody can hide lateness behind the break.
5. **No break on the shift:** the same shift without a break and a return at `14:05` → the old rule, unchanged (compared with `09:00`).
6. **Out and back outside the break:** out `11:00`, back `11:20` on a shift whose break is `13:00`–`14:00` → not a return
   from break; the old rule applies, and the 20 minutes out are not worked time. Time she spends clocked out **inside** the
   break counts as worked (for the report later).
7. A session closed as `MISSED_OUT` (forgot to clock out) is not a return. A clock-in at or after the shift end is not a return.

**Part 2: the manager alert**

8. Sara clocks in at `08:58`, clocks out at `13:02` and does not come back. The job runs every 5 minutes. Before `14:10`
   (break end + 10 minutes), e.g. `14:09` → nothing. From `14:10` until `17:00` → the Owner's, General Manager's, Business
   Manager's and the Salmiya Branch Manager's bells each show one **Unread** message:
   **Sara has not clocked back in from the break that ended at 14:00 at Salmiya** (in the viewer's UI language; in Arabic
   **لم يُسجَّل رجوع سارة من البريك المنتهي الساعة 14:00 في فرع السالمية**). A manager of another branch sees nothing.
9. **Once only:** run the job again, or on two workers → no second message. A message already sent is never withdrawn,
   even if Sara comes back afterwards.
10. **No alert when:**
    - Sara never clocked out for the break (the morning session is still open).
    - She clocked out at `11:00` (outside the break) and did not return. A clock-out counts as a break-out from 10 minutes
      before the break starts: `12:50` counts, `12:49` does not, and a clock-out exactly at the break end does not.
    - She is back before the job decides (back `14:30`, job at `14:35`), or came back at a different branch (it must be the
      same branch, otherwise the alert fires).
    - The shift is over (`17:00` or later), or the alert moment would fall at or after the shift end (break `16:00`–`16:55`).
    - Approved leave covers the break end to the shift end (leave ending earlier moves the alert to its end + 10 minutes).
      Pending leave does not excuse.
    - The employee was deleted or her contract ended.
11. **Two clock-outs inside the break** (out `13:00`, in `13:10`, out `13:20`): the latest clock-out counts and the return
    must come after it.

**Must NOT happen:**
- Any commission or pay deduction from lateness, or invented hours.
- An alert for someone who never clocked out for the break, or who came back before the job decided.
- More than one message for the same shift, or a sent message being withdrawn.
- The alert changing attendance, lateness, sessions or exceptions, or adding a session status or exception kind.
- The message reaching another branch's manager or another company.

## For an agent

- Clock routes are the ones in [26](26-clock-attendance.md) (`POST /v1/staff/attendance/challenge` then `/clock`) and
  [30](30-employee-cards-and-clock-by-card.md); the result carries `late_minutes`. For a return, expect `late_minutes`
  = whole minutes after `break_ends_at` (0 up to and including 10 minutes of grace → 0 at ≤ 10, 11 at 11) and the stored
  session scheduled start = the break end. Use the injected clock fixtures in `apps/api/src/modules/staff/__tests__`
  (scenarios `BW-07`, `BW-08`); curl alone cannot produce the passkey assertion.
- Alert job (worker, scenario `BW-09`): `apps/worker/src/modules/staff/use-cases/detect-break-not-returned/detect-break-not-returned.ts`.
  Decision order: stale (now ≥ shift end, or alert moment ≥ shift end) → ineligible → no break-out → excused by leave →
  returned → wait → alert. Break-out = latest `clock_out` of a `CLOSED` session at the shift's branch with this shift's
  end as its scheduled end, in `[break_start − 10 min, break_end)`. Alert moment = break end + 10 minutes. Once-only key:
  `(company_id, employee_id, shift_starts_at)` in `attendance_break_not_returned_notices`; assert one row, one
  `ShiftBreakNotReturned` event and one unread bell message per recipient after repeated runs; audit entry
  `attendance_notice` / `break_not_returned.detected` with a null actor.
- Bell: `GET /v1/me/notifications/unread-count`, the admin bell at `http://localhost:3001` ([04](04-admin-notifications-bell.md)).
  Template `break_not_returned` (IN_APP, revision 1) with parameters `employee_name_ar/en`, `branch_name_ar/en`,
  `break_end` (`HH:MM`). Rendered texts (`packages/i18n/src/in-app-catalog.ts`):
  `{{employee_name_en}} has not clocked back in from the break that ended at {{break_end}} at {{branch_name_en}}` /
  `لم يُسجَّل رجوع {{employee_name_ar}} من البريك المنتهي الساعة {{break_end}} في {{branch_name_ar}}`. Recipients (spec 036 BR-004): active
  members with role owner, general manager, business manager or branch manager whose scope is the company, the shift's
  business or the shift's branch, minus the employee's own user.
- Assertions: at `14:09` no notice, at `14:10` one; a return at `14:30` before a `14:35` run → none; other-branch return
  does not cancel the alert; the notice table has FORCE RLS, `pospay_app` SELECT + INSERT only; a not-clocked-in notice and
  a not-returned notice for the same shift never block each other.
- Sources: `docs/specs/041-staff-schedule-break-window/spec.md` (User Stories 3 and 4, FR-010, FR-013 to FR-015, BR-005,
  BR-007), `apps/worker/src/modules/staff/domain/break-not-returned.ts`,
  `apps/worker/src/modules/staff/persistence/break-not-returned.transactions.ts`,
  `packages/i18n/src/in-app-catalog.ts`, `packages/i18n/src/attendance-{ar,en}.ts`,
  `apps/admin/src/notifications/model/render-notification.ts`.
