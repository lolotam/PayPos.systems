# 43 · Break window on a shift — البريك الثابت داخل الوردية

**Status / الحالة:** shipped in #146 (PR 16b-1, merged). The API is live on staging (api + worker at commit `6c220e4`,
2026-10-11); the admin and POS apps are **not** deployed yet (issue #54), so the screen steps run locally only.
Your decisions BW-Q1 to BW-Q9 of 2026-10-10 apply ([owner-questions.ar.md](../specs/041-staff-schedule-break-window/owner-questions.ar.md)):
the break lives **on each shift**, is **optional**, **at most one** per shift, lies **strictly inside** the shift, and
**counts as working hours** (BW-Q4, not the recommended option: Sara 09:00–17:00 with a break 13:00–14:00 is **8 hours**).
What the break does at the clock (lateness on return, the manager alert) is in [44](44-return-from-break-lateness.md).

**Before you start / قبل ما تبدأ:**
- Everything in [19 Schedules](19-schedules.md) (migration, seed, a branch selected, two synthetic employees attached
  on the test days, a future Saturday week and an eligible past day), plus `pnpm db:migrate` for the four break columns.
- Branch Salmiya (فرع السالمية) with synthetic employees سارة (Sara) and هبة (Heba). A user with
  `manage:schedules:branch` on Salmiya, and one with `manage:schedules:business` for the template steps.
- Break times are **branch-local `HH:mm`**, like shift times. Synthetic reasons only.

## العربي

1. افتح `/schedules` وفرع السالمية مختار، وافتح يوم السبت لسارة (**تعديل اليوم**) ← **تعديل جدول الموظف**.
   ضيف وردية **البداية** `09:00` و**النهاية** `17:00`. تحت الوردية زرار **إضافة بريك**؛ دوس عليه ← يظهر **بداية البريك**
   و**نهاية البريك** ومعاهم زرار **إزالة البريك**. اكتب `13:00` و`14:00` ← **حفظ الجدول**.
2. الجدول يرجع وفي خانة السبت لسارة: `09:00–17:00` وتحتها **البريك** `13:00–14:00`. الوردية لسه **8 ساعات**
   (من 09:00 لـ 17:00)؛ البريك مش بيتخصم من أي رقم ساعات.
3. افتح اليوم تاني واحفظ من غير ما تلمس البريك ← البريك يفضل `13:00–14:00` (النموذج بيرجّعه زي ما هو، مش بيمسحه).
4. **بريك مرفوض:** غيّر البريك لـ `16:30`–`17:30`، أو `08:30`–`09:30`، أو `13:00`–`17:00` (لازق في نهاية الوردية) ← الحفظ يترفض
   بـ **وقت البريك لازم يكون جوّه الشيفت** (`SCHEDULE_BREAK_INVALID`، 400) ومعاها اسم الوردية: **وردية يوم السبت اللي بتبدأ 09:00**، ومفيش حاجة اتكتبت. نهاية البريك مش بعد بدايته
   (في وردية نهارية) ← نفس الرفض. وقت واحد من الاتنين بس ← **البيانات المرسلة غير صحيحة** (`VALIDATION_FAILED`، 400).
5. **وردية من غير بريك:** احفظ وردية `09:00`–`13:00` من غير بريك (دوس **إزالة البريك**) ← تتحفظ عادي (البريك اختياري).
6. **وردية بعد نص الليل:** وردية `20:00`–`04:00` وبريك `00:30`–`01:00` ← تتحفظ، والبريك تابع ليوم بداية الوردية (حتى لو وقته
   في اليوم اللي بعده). بريك `03:30`–`04:30` على نفس الوردية ← **وقت البريك لازم يكون جوّه الشيفت**.
7. **يوم فات:** إضافة بريك أو تغييره أو إزالته على يوم فات من غير سبب ← **سبب التعديل مطلوب لتغيير يوم سابق.**
   (`SCHEDULE_PAST_REASON_REQUIRED`، 400). اكتب **السبب** ← يتحفظ، وسطر التدقيق فيه القبل والبعد. إعادة حفظ نفس البريك
   بالظبط ما بتطلبش سبب.
8. **القالب (API فقط، مفيش شاشة قوالب):** اعمل قالب فيه وردية السبت `09:00`–`17:00` وبريك `13:00`–`14:00` وطبّقه على سارة وهبة
   لأسبوعين (الخطوات في [19](19-schedules.md)، البنود 11 لـ 13) ← الأربع نسخ كلها فيها البريك. غيّر بريك الاثنين لسارة بس لـ `14:00`–`15:00` ←
   بريك هبة والقالب ما يتغيروش. تعديل القالب بعد كده ما بيغيرش النسخ اللي اتعملت.
9. **قديم قبل الميزة:** أي جدول أو قالب اتحفظ قبل ميزة البريك يتقرا ويتعدل ويتطبق من غير بريك، من غير أي خطوة ترحيل.
10. **مفيش فحص لو الكل في بريك مع بعض:** اعمل بريك `13:00`–`14:00` لسارة وهبة في نفس اليوم ← يتحفظ (BW-Q7: مفيش فحص).

**ممنوع يحصل:**
- بريك خارج الوردية أو لازق في بدايتها أو نهايتها، أو طوله صفر، أو بوقت واحد بس، أو أكتر من بريك في الوردية.
- البريك يقلل ساعات الوردية في أي قراءة.
- حفظ جزئي: أي رفض لازم ما يسيبش أثر في الجداول ولا التدقيق.
- جدول أو قالب قديم يبوظ، أو تعديل القالب يغيّر نسخ اتعملت قبله.

## English

1. Open `/schedules` with Salmiya selected and open Sara's Saturday (**Edit day**) → **Edit employee schedule**. Add a
   shift with **Start** `09:00` and **End** `17:00`. Under the shift there is an **Add break** button; press it → **Break
   start** and **Break end** appear with a **Remove break** button. Enter `13:00` and `14:00` → **Save schedule**.
2. The grid returns; Sara's Saturday cell shows `09:00–17:00` with **Break** `13:00–14:00` underneath. The shift is still
   **8 hours** (09:00 to 17:00); the break is never subtracted from any hours figure.
3. Reopen the day and save without touching the break → the break stays `13:00–14:00` (the form round-trips it, it does
   not erase it).
4. **Refused breaks:** set the break to `16:30`–`17:30`, or `08:30`–`09:30`, or `13:00`–`17:00` (touching the shift end) →
   the save is refused with **The break must be inside the shift** (`SCHEDULE_BREAK_INVALID`, 400) followed by the shift's name (**Shift on Saturday starting 09:00**), and nothing is
   written. A break whose end is not after its start (on a day shift) → the same refusal. Only one of the two times →
   **The request is not valid** (`VALIDATION_FAILED`, 400).
5. **A shift with no break:** save a `09:00`–`13:00` shift with no break (press **Remove break**) → saved (a break is optional).
6. **Overnight:** a `20:00`–`04:00` shift with break `00:30`–`01:00` → saved; the break belongs to the start day even
   though its time falls on the next calendar day. Break `03:30`–`04:30` on the same shift → **The break must be inside
   the shift**.
7. **A past day:** adding, changing or removing a break on a past day without a reason → **A reason is required to edit a
   past day.** (`SCHEDULE_PAST_REASON_REQUIRED`, 400). Fill **Reason** → saved; the audit row holds before and after.
   Re-saving the identical break asks for no reason.
8. **Templates (API only, there is no template screen):** create a template whose Saturday has `09:00`–`17:00` with break
   `13:00`–`14:00` and apply it to Sara and Heba for two weeks (steps in [19](19-schedules.md), items 11 to 13) → all four
   copies carry the break. Change only Sara's Monday break to `14:00`–`15:00` → Heba's Monday and the template stay
   unchanged. Editing the template later never changes copies already made.
9. **Old data:** any schedule or template saved before this feature reads, edits and applies with no break; no data step.
10. **No clash check:** give Sara and Heba the same break `13:00`–`14:00` on the same day → saved (BW-Q7: no check).

**Must NOT happen:**
- A break outside the shift, touching its start or end, of zero length, with one time only, or more than one per shift.
- The break shortening a shift in any read or hours figure.
- A partial write: every refusal leaves schedules and audit untouched.
- A pre-existing schedule or template breaking, or a template edit changing copies made earlier.

## For an agent

- Admin: `http://localhost:3001/schedules`. Day button accessible name starts with **Edit day** / **تعديل اليوم** plus the
  employee's English name and weekday. Dialog **Edit employee schedule** / **تعديل جدول الموظف**. Buttons **Add break** /
  **إضافة بريك**, **Remove break** / **إزالة البريك**; labels **Break start** / **بداية البريك** and **Break end** /
  **نهاية البريك** (`input type="time"`, ids `break_start-{index}` / `break_end-{index}`); grid label **Break** / **البريك**
  followed by `HH:mm–HH:mm` in a `dir="ltr"` span.
- API (session cookie + `x-company-id`, no `Idempotency-Key` on schedule commands): `PUT
  /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/schedules/<EMPLOYEE_ID>` with
  `{ "week_start": "<SATURDAY>", "expected_revision": 0, "shifts": [ { "day": 0, "start": "09:00", "end": "17:00",
  "break_start": "13:00", "break_end": "14:00" } ], "reason": "<SYNTHETIC_REASON>" }` → 200. `break_start` / `break_end` are
  both set or both `null`/absent. Reads (`GET .../schedules`, `GET .../schedules/<EMPLOYEE_ID>?week_start=`, `GET
  /v1/staff/my-schedule`, template routes, the `apply` result) return `break_start`, `break_end` (`HH:mm | null`) and, on a
  concrete shift, `break_starts_at`, `break_ends_at` (ISO instants `| null`).
- Templates: `POST /v1/businesses/<BUSINESS_ID>/shift-templates` with `shifts: [{ day, start, end, break_start,
  break_end }]`; `PATCH` and `POST .../apply` as in [19](19-schedules.md).
- Errors: `SCHEDULE_BREAK_INVALID` 400 · `SCHEDULE_PAST_REASON_REQUIRED` 400 · `SCHEDULE_LOCAL_TIME_INVALID` 400 (a
  break time with no unique occurrence in the branch timezone) · `VALIDATION_FAILED` 400 (one-sided break) · `NOT_FOUND` 404.
- Assertions: the shift's `ends_at − starts_at` is unchanged by the break; a refused save changes no `revision`, row or
  audit entry; an identical re-save of a past day without a reason succeeds; the database also rejects a direct insert of
  a break outside its shift or a half-filled pair (CHECK constraints).
- Sources: `docs/specs/041-staff-schedule-break-window/spec.md`,
  `apps/admin/src/staff/ui/schedule-shift-break-fields.tsx`, `apps/admin/src/staff/ui/schedule-grid.tsx`,
  `packages/contracts/src/staff/schedules.ts`, `packages/i18n/src/schedule-shell-catalog.ts`,
  `packages/i18n/src/{ar,en}.ts` (`SCHEDULE_BREAK_INVALID`).
