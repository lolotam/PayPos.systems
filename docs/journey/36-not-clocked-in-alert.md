# 36 · Not-clocked-in alert — تنبيه "الموظف لسه ما سجّلش حضور"

**Status / الحالة:** shipped in #130 (PR 28, merge commit `b775b426`). A **worker job**, no HTTP endpoint and no new
screen: the only thing you see is a message in the admin **bell** ([04](04-admin-notifications-bell.md)), so the
admin must run locally to read it (the admin is **not deployed**, issue #54). Staging runs `api` and `worker` at commit
`6c220e4` (2026-10-11), so the job code is **live on staging**; a company is picked up by the job when its
`CompanyCreated` event is delivered, and **companies that already existed need the one controlled operator replay of
`CompanyCreated`** (spec 036) before the job covers them. Until that replay is done on staging, treat the job as
running only for new companies. The alert goes to managers only, in the app only (no email, no WhatsApp, NC-Q4).
The employee's own push notice is a later row (28b), the "your shift ends soon" reminder is 28c, and the on/off
switches and editable recipients are PR 62; today the rule is fixed. Your decisions of 2026-10-08 (NC-Q1 to NC-Q13)
apply: [owner-questions.ar.md](../specs/036-staff-not-clocked-in-alert/owner-questions.ar.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with **API, worker, Redis and admin** running, then `pnpm db:migrate` (the
  `attendance_not_clocked_in_notices` table and the index on shift starts) and `pnpm db:seed`. The company's `staff`
  feature enabled. In a local company the job is registered on `CompanyCreated`; if the company existed before, replay
  that event once (see the status above). The job runs **every 5 minutes**, so the message can come up to 5 minutes
  after the alert moment.
- One business with two branches, Salmiya (فرع السالمية) and Hawalli (فرع حولي). Synthetic employees attached to
  Salmiya:
  - منى (Mona) with a weekly schedule shift **10:00–18:00** today ([19](19-schedules.md)). To test by hand, save a
    shift that starts about 25 minutes before now (or one starting in a few minutes and wait), in the branch timezone.
  - هبة (Heba) with the same shift and **approved full-day leave** ([24](24-decide-leave.md)).
  - سارة (Sara) with the same shift who **does clock in** ([26](26-clock-attendance.md)).
- Synthetic users, each with their own session cookie and their own bell:
  - **Owner**, **General Manager**, **Business Manager**, **Branch Manager** of Salmiya (the four who get the alert).
  - **Branch Manager** of Hawalli, and a **Cashier** of Salmiya (neither gets it).
- Test data is invented. The test suite drives the clock; by hand you wait for real time.

## العربي

1. **التنبيه الأساسي:** شيفت منى 10:00 في السالمية. الساعة 10:20 وهي لسه ما سجّلتش حضور (لا بالموبايل ولا بالكارت)
   وما عندهاش إجازة معتمدة. خلال 5 دقايق بعد 10:20، جرس صاحب الشركة والمدير العام ومدير النشاط ومديرة فرع السالمية
   يظهر عليه إشعار **غير مقروء** واحد لكل واحد:
   **لم يُسجَّل حضور منى لشفت الساعة 10:00 في فرع السالمية** (والإنجليزي
   **Mona has not clocked in for the 10:00 shift at Salmiya**، حسب لغة الواجهة عند اللي بيفتح الجرس). الجملة بتتعرض
   بلغة المستخدم الحالية، مش لغة محفوظة في الإشعار.
2. **مرة واحدة بس:** المهمة اشتغلت تاني أو اتعمل restart أو اشتغل أكتر من worker ← مفيش إشعار تاني ولا مكرر. نفس
   الشيفت لو الأسبوع اتحفظ تاني بنفس ميعاد البداية ← مفيش تنبيه تاني. شيفت اتنقل من 10:00 لـ 11:00 بعد التنبيه ←
   ده شيفت مختلف، وينبّه الساعة 11:20 لو لسه غايبة.
3. **قبل 10:20:** الساعة 10:19 ← ولا حاجة بتتسجل أو تتبعت.
4. **ما بيتنبّهش مين:** مديرة فرع حولي، والكاشير، وأي عضوية اتشالت، ومنى نفسها (لو هي كمان مديرة). مفيش إيميل ولا
   واتساب.
5. **سجّلت حضور:** سارة سجّلت حضور من ساعتين قبل البداية (08:00 أو بعدها) لحد 10:20، بأي فرع، حتى لو سجّلت انصراف
   بعدها ← ولا تنبيه. حضور 07:59 ومفيش بعده ← التنبيه يطلع 10:20. جلسة لسه مفتوحة وقت التنبيه تتحسب حضور (حتى لو
   بدأت قبل نافذة الساعتين، وده الشيفت التاني من يوم مقسوم).
6. **إجازة:** هبة عندها إجازة يوم كامل معتمدة ← ولا تنبيه. إجازة **مستنية** ← التنبيه بيطلع. إجازة معتمدة 10:00–12:00
   وشيفت 10:00–18:00 ← ولا تنبيه 10:20، والتنبيه ييجي 12:20 لو ما اتسجّلش حضور. إجازة جزئية لحد نهاية الشيفت ← ولا
   تنبيه.
7. **شيفت اتمسح أو اتغير، وموظف اتشال:** شيفت اتمسح أو اتنقل قبل وقت التنبيه ← ما فيش تنبيه لميعاده القديم. موظف
   اتحذف أو عقده خلص قبل تاريخ الشيفت ← ولا تنبيه.
8. **شيفت خلص أو الدنيا وقفت:** لو المهمة كانت واقفة وشغّلت 11:00 لشيفت 10:00–18:00 ← التنبيه يطلع 11:00. شيفت خلص
   قبل ما المهمة تشتغل ← يتخطّى ولا يتبعت.
9. **شيفت بالليل:** شيفت 22:00 بتوقيت الفرع ← التنبيه 22:20، من غير ساعات هدوء. شيفتين في اليوم (09:00–13:00
   و17:00–21:00) ← كل شيفت لوحده؛ لو حضرت الأول وانصرفت وما سجّلتش بعدها، الشيفت التاني ينبّه 17:20.
10. **فرع من غير مديرين:** لو الفرع مالوش حد من الأربع أدوار، التنبيه بيتسجّل والحدث بيتبعت من غير مستلمين، وما حدش
    بيوصله حاجة.
11. **اللي ما بيتغيرش:** التنبيه ما بيغيّرش الحضور ولا التأخير ولا الساعات ولا العمولة، وبيتكتب له سطر تدقيق
    (`not_clocked_in.detected`، المنفّذ النظام). حضور اتسجّل بعد التنبيه ما بيسحبوش (مفيش إلغاء).

**ممنوع يحصل:**
- إشعارين لنفس الموظفة ولنفس ميعاد بداية الشيفت، أو إشعار مكرر لنفس المدير.
- تنبيه قبل بداية الشيفت + 20 دقيقة.
- تنبيه لموظف سجّل حضور في النافذة، أو عنده إجازة يوم كامل معتمدة، أو اتحذف، أو عقده خلص.
- إشعار لمدير فرع تاني، أو للكاشير، أو للموظفة نفسها.
- إيميل أو واتساب، أو أي رسالة للموظفة.
- أي تغيير في الحضور أو التأخير أو الساعات أو العمولة.
- تنبيه لشيفت خلص أصلاً.

## English

1. **The basic alert:** Mona's shift is 10:00 at Salmiya. At 10:20 she still has no clock-in (neither by phone nor by
   card) and no approved leave. Within 5 minutes after 10:20 the bell of the Owner, the General Manager, the Business
   Manager and the Salmiya Branch Manager each show exactly one **Unread** (غير مقروء) message:
   **Mona has not clocked in for the 10:00 shift at Salmiya** (Arabic:
   **لم يُسجَّل حضور منى لشفت الساعة 10:00 في فرع السالمية**). The sentence is rendered in the language the viewer's
   admin is using now, not a language stored on the message.
2. **Once only:** the job running again, a restart, or two workers → no second or duplicate message. Re-saving the week
   with the same shift start → no second alert. A shift moved from 10:00 to 11:00 after the alert is a different
   shift, and alerts at 11:20 if she is still absent.
3. **Before 10:20:** at 10:19 nothing is recorded or sent.
4. **Who does not get it:** the Hawalli Branch Manager, the Cashier, a removed membership, and Mona herself (if she is
   also a manager). No email, no WhatsApp.
5. **She clocked in:** Sara clocked in from 2 hours before the start (08:00 or later) up to 10:20, at any branch, even
   if she clocked out afterwards → no alert. A clock-in at 07:59 with nothing after → the alert fires at 10:20. A
   session still open at the alert moment counts as present (even when it began before the 2-hour window, the split
   day case).
6. **Leave:** Heba has approved full-day leave → no alert. **Pending** leave → the alert fires. Approved leave
   10:00–12:00 on a 10:00–18:00 shift → no alert at 10:20, and the alert comes at 12:20 if there is still no clock-in.
   Partial leave lasting to the shift end → no alert.
7. **A deleted or changed shift, a removed employee:** a shift deleted or moved before the alert moment → no alert for
   the old start. A deleted employee or one whose contract ended before the shift date → no alert.
8. **A finished shift, or an outage:** the job was down until 11:00 for a 10:00–18:00 shift → the alert goes out at
   11:00. A shift that ended before the job ran is skipped and nothing is sent.
9. **Night and split shifts:** a 22:00 shift in the branch timezone → the alert at 22:20, with no quiet hours. Two
   shifts in a day (09:00–13:00 and 17:00–21:00) → each is checked on its own; if she clocked in for the first, clocked
   out, and nothing after, the second alerts at 17:20.
10. **A branch with no managers:** the notice is recorded and the event is emitted without recipients; nobody receives
    anything.
11. **What never changes:** the alert does not change attendance, lateness, hours or commission, and writes an audit
    entry (`not_clocked_in.detected`, actor: the system). A clock-in after the alert does not retract it (no
    "cancelled" message).

**Must NOT happen:**
- Two notices for the same employee and the same shift start, or a duplicate message to one manager.
- An alert before the shift start + 20 minutes.
- An alert for an employee who clocked in within the window, has approved full-day leave, was deleted, or whose contract
  ended.
- A message to another branch's manager, a cashier, or the absent employee herself.
- Email, WhatsApp, or any message to the employee.
- Any change to attendance, lateness, hours or commission.
- An alert for a shift that has already ended.

## For an agent

- No endpoint to call. The detection runs in the worker: a BullMQ job scheduler `attendance-not-clocked-in-<companyId>`
  every 5 minutes with data `{ companyId }`, registered when `CompanyCreated` is delivered. By hand, create the shift
  through the schedules API ([19](19-schedules.md)), wait past start + 20 minutes plus up to 5 minutes, and read the
  bell: `GET /v1/me/notifications/unread-count` with `x-company-id` for each manager, and the admin bell at
  `http://localhost:3001`.
- The bell item: a notification with `template_key: "shift_not_clocked_in"` and safe parameters `employee_name_ar`,
  `employee_name_en`, `branch_name_ar`, `branch_name_en`, `shift_start` (`HH:MM`). Rendered by
  `apps/admin/src/notifications/model/render-notification.ts` from `packages/i18n/src/in-app-catalog.ts`:
  `لم يُسجَّل حضور {{employee_name_ar}} لشفت الساعة {{shift_start}} في {{branch_name_ar}}` /
  `{{employee_name_en}} has not clocked in for the {{shift_start}} shift at {{branch_name_en}}`. The Arabic value falls
  back to the English one when empty. Find the item by its visible text in the notifications list ("الإشعارات" /
  "Notifications"), with the Unread badge ("غير مقروء" / "Unread").
- Assertions: exactly one row in `attendance_not_clocked_in_notices` per `(company_id, employee_id, shift_starts_at)`;
  one `ShiftNotClockedIn` event per group of at most 100 recipients; one in-app row per recipient and `source_event_id`;
  recipients are exactly the active owner, general manager, business manager and branch manager of the shift's branch
  (membership scope company, business or that branch), minus the employee's own user, deduplicated; no email or
  WhatsApp attempt row exists; the alert moment is `starts_at + 20 minutes` and the counting window is `[starts_at - 2
  hours, alert moment]`, both ends inclusive; `attendance_sessions`, lateness and commission rows are unchanged; one
  audit row with a NULL actor; RLS hides another tenant's notices. The decision order is: stale, ineligible, excused by
  full leave, clocked in, wait, alert. Sources: `docs/specs/036-staff-not-clocked-in-alert/spec.md`,
  `apps/worker/src/modules/staff/domain/not-clocked-in.ts`, `packages/notifications/src/templates/shift-not-clocked-in.ts`,
  `packages/i18n/src/in-app-catalog.ts`, `apps/admin/src/notifications/model/render-notification.ts`.
