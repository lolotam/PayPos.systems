# 65 · «Your shift ends soon» reminder — تذكير «دوامك قرب يخلص»

**Status / الحالة:** shipped in #577 (064-1: the rules and the ledger), #585 (064-2: the `shift_ends_soon` push
template and the `ShiftEndsSoon` event) and #594 (064-3: the detector inside the worker's company job), all merged
(row 28c, spec 064). **Worker only: no screen and no route of its own.** The employee sees a phone notification; the
manager changes the lead time on the alerts screen ([62](62-alert-rules-screen.md)). **Not visible on staging yet:**
a phone must be subscribed first ([64](64-staff-web-push.md)), and that needs the personal session (OTP **OFF**).
The detector itself runs there and writes its ledger.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with API, worker and Redis; a phone subscribed to notifications as in
  [64](64-staff-web-push.md).
- Synthetic employee منى (Mona), scheduled 10:00–18:00 at Salmiya today, clocked in (an open attendance session).
- The rule **الشيفت قرب يخلص (للموظفة)** / **Shift ending soon (employee)** on, with its default of 30 minutes.

## العربي

مفيش شاشة هنا: الموظفة بتشوف إشعار، والمدير بيغيّر التوقيت من شاشة التنبيهات.

1. **التذكير:** منى شغالة 10:00–18:00 وبصمت حضور. الساعة 17:30 الـ job بيشتغل ← إشعار بعنوان **دوامك قرب يخلص**
   ونصه «دوامك بينتهي الساعة 6:00 م في السالمية.» قبل 17:30 مفيش حاجة.
2. **مرة واحدة:** الـ job اشتغل تاني، أو اتنين worker مع بعض ← برضه إشعار واحد للشيفت ده.
3. **غيّر التوقيت:** من شاشة التنبيهات خلّي **قبلها بكام دقيقة** = 45 ← التذكير بتاع الشيفت الجاي بيبقى 17:15.
   تغيير التوقيت بعد ما التذكير اتسجّل ما بيغيّرش حاجة في نفس الشيفت.
4. **قاعدة فرع:** فرع له قاعدة مختلفة ← موظفينه بيمشوا بيها، وباقي الفروع بقاعدة النشاط.
5. **مش في الشغل:** موظفة بصمت انصراف، أو ما جتش أصلًا، أو في البريك وقت التذكير ← مفيش إشعار. لو رجعت من البريك
   قبل آخر الشيفت، الإشعار بيطلع في التشغيلة اللي بعدها.
6. **إجازة معتمدة:** إجازة معتمدة واصلة لآخر الشيفت ← مفيش إشعار. إجازة لسه معلّقة أو مرفوضة ← الإشعار بيطلع.
7. **القاعدة مقفولة:** النوع مقفول، أو **كل التنبيهات شغالة** مقفول ← مفيش إشعار، ولو اتفتحت بعدين مفيش إشعار
   للشيفت ده برضه.
8. **شيفتين في اليوم:** 09:00–13:00 و17:00–21:00 ← تذكير 12:30 وتذكير 20:30، كل واحد بوقت نهايته.
9. **شيفت بالليل:** 22:00–06:00 ← التذكير 05:30 تاني يوم. مفيش ساعات هدوء.
10. **السيستم كان واقف:** الـ job رجع 17:45 لشيفت بيخلص 18:00 ← الإشعار بيطلع 17:45 بوقت النهاية الحقيقي.
11. **المدير مدّ الشيفت:** التذكير طلع لـ 18:00 وبعدين الشيفت اتمد لـ 20:00 ← تذكير جديد 19:30.
12. **توقيت أطول من الشيفت:** شيفت ساعة وتوقيت 90 دقيقة ← التذكير مع بداية الشيفت، مش قبلها.

**ممنوع يحصل:**
- إشعارين لنفس الشيفت ونفس وقت النهاية.
- إشعار لموظفة مش في الشغل (انصرفت، ما جتش، في البريك، أو في إجازة معتمدة).
- إشعار قبل بداية الشيفت.
- تذكير يطلع متأخر لشيفت كان مقفول وقت ميعاده، بعد ما القاعدة تتفتح.
- المدير أو حد تاني يوصله الإشعار ده (للموظفة بس).

## English

No screen here: the employee sees a notification, and the manager changes the lead on the alerts screen.

1. **The reminder:** Mona works 10:00–18:00 and has clocked in. At 17:30 the job runs → a notification titled **Shift
   ending soon** reading "Your shift ends at 6:00 PM at Salmiya." Before 17:30 nothing happens.
2. **Exactly once:** the job runs again, or two workers run it → still one notification for that shift.
3. **Change the lead:** on the alerts screen set **How many minutes before** to 45 → the next shift's reminder is due
   at 17:15. Changing the lead after a reminder was recorded changes nothing for that shift.
4. **A branch rule:** a branch with its own rule → its employees follow it, the other branches the business rule.
5. **Not at work:** an employee who clocked out, never came, or is on her break at the reminder moment → no
   notification. If she comes back from the break before the shift ends, it goes out at the next run.
6. **Approved leave:** approved leave reaching the shift end → no notification. Pending or rejected leave → the
   notification goes out.
7. **Rule off:** the kind off, or **All team alerts on** off → no notification, and switching it back on later never
   sends one for that shift.
8. **Two shifts in a day:** 09:00–13:00 and 17:00–21:00 → one reminder at 12:30 and one at 20:30, each with its own
   end time.
9. **Overnight shift:** 22:00–06:00 → the reminder is due at 05:30 the next day. There are no quiet hours.
10. **The system was down:** the job comes back at 17:45 for an 18:00 end → it sends at 17:45 with the real end time.
11. **The manager extends the shift:** the reminder went out for 18:00, then the end moves to 20:00 → a new reminder
    at 19:30.
12. **A lead longer than the shift:** a 1-hour shift and a 90-minute lead → the reminder is due at the shift start,
    never before it.

**Must NOT happen:**
- Two notifications for the same shift and the same end time.
- A notification to an employee who is not at work (clocked out, absent, on a break, or on approved leave).
- A notification before the shift starts.
- A late reminder for a shift whose moment passed while the rule was off, after the rule is switched on.
- A manager or anyone else receiving this notification (the employee only).

## For an agent

- **Screens:** none. Lead and switches: the `SHIFT_ENDS_SOON` row on `/alert-rules`
  ([62](62-alert-rules-screen.md)), `lead_minutes` default 30, branch override allowed.
- **Worker:** `apps/worker/src/modules/staff/use-cases/detect-shift-ending-soon/detect-shift-ending-soon.ts`, wired
  in `apps/worker/src/modules/staff/staff.module.ts`; writes in
  `apps/worker/src/modules/staff/persistence/shift-ending-soon-writes.ts`.
- **Rule:** `remindAt = max(shift end − lead, shift start)`; a suppressed moment writes a ledger row with
  `suppressed_at` and no event (spec 064 BR-001, BR-005, User Story 2 scenario 5).
- **Push:** template `shift_ends_soon` in `packages/notifications/src/push/templates.ts`: title **دوامك قرب يخلص** /
  **Shift ending soon**, body «دوامك بينتهي الساعة {shift_end} في {branch_name}.» / "Your shift ends at {shift_end}
  at {branch_name}." The time is shown in 12-hour form.
- **Assertions:** one ledger row and one `ShiftEndsSoon` event per shift end, the employee as the only recipient; a
  re-run adds nothing.
- **Sources:** `docs/specs/064-shift-ending-reminder/spec.md` (User Stories 1–3), `docs/adr/0037-not-clocked-in-alert-discovery-and-recipients.md`,
  journeys [62](62-alert-rules-screen.md) and [64](64-staff-web-push.md).
