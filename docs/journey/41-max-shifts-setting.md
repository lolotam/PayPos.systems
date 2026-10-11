# 41 · Maximum shifts per day (owner setting) — أقصى عدد ورديات في اليوم (إعداد المالك)

**Status / الحالة:** shipped in #143 (PR 16c, merged). The API (settings routes and the new day-limit check on schedule
saves and template apply) is **live on staging** (api + worker at commit `6c220e4`, 2026-10-11); the **admin is not deployed**
(issue #54), so the settings panel and the "Add shift" button run locally only. No OTP involved. This journey describes
the setting **as #143 shipped it: one number per business**. **It was later made per branch by PR 16c-2 (#151):** a
branch can now have its own number that overrides the business number. That part, and the extra "This branch" fields you
will see in the same panel today, are in [45](45-max-shifts-per-branch.md); the business-wide steps below still hold and are
the fallback every branch inherits. Your decisions of 2026-10-10 (MS-Q1 to MS-Q6) apply: default **3** (was a fixed 2), range
**1 to 4**, owner-only by default and grantable by the owner, lowering never rewrites stored schedules, no minimum gap
between back-to-back shifts, and one shift stays at most 16 hours.
[owner-questions.ar.md](../specs/042-staff-max-shifts-setting/owner-questions.ar.md). Builds on [19](19-schedules.md), which
described the old fixed limit of two.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then `pnpm db:migrate` (the `staff_schedule_settings` table) and `pnpm db:seed`
  (the new permission). API and admin running; the company's `staff` feature enabled.
- A business that never touched the setting (so the default 3 applies), with two branches: Salmiya and Hawalli. Synthetic
  employees: **Sara** attached to **both** branches, **Heba** attached to Salmiya ([13](13-create-employee.md)).
- Users with their own sessions: the **Owner**, a **Business Manager** who can edit schedules but does **not** hold the
  setting permission, and a **General Manager** to receive a granted permission ([12](12-permissions-screen.md)).
- A future Saturday week in Salmiya ([19](19-schedules.md)). Use future days so the past-day reason is not needed.

## العربي

1. **الافتراضي 3:** افتح `/schedules` لفرع سالمية ← أسبوع مستقبلي. دوس **تعديل اليوم** على خلية الخميس لسارة ←
   **تعديل جدول الموظف**. دوس **إضافة وردية** تلات مرات واضبط `09:00`–`13:00` و`14:00`–`18:00` و`19:00`–`23:00` ←
   **حفظ الجدول**. اتحفظ (قبل #143 التالتة كانت بتترفض). زرار **إضافة وردية** بيتقفل لما اليوم يوصل للحد (3).
2. **الرابعة بتتقفل:** من الـ API ابعت وردية رابعة لنفس يوم الخميس (`06:00`–`08:00` مثلاً) ← **422**
   **عدد الورديات تجاوز الحد اليومي للنشاط** (`SCHEDULE_DAY_LIMIT_EXCEEDED`)، و`details` فيها
   `max_shifts_per_day: 3` و`working_dates` بتاريخ الخميس. ومفيش حاجة اتكتبت. لو الرفض جه في الشاشة (مثلاً الحد اتنزّل من
   تاب تاني والحوار مفتوح)، رسالة الحفظ بتكمل بـ **— الحد 3 ورديات في اليوم: 2026-…** بتاريخ اليوم المرفوض.
3. **من #151 العد بقى لكل فرع لوحده:** وقت #143 الحد كان بيتعد لكل موظفة عبر كل الفروع. من بعد #151 بيتعد على ورديات
   الفرع اللي بتحفظ فيه بس: سارة عندها وردية خميس في سالمية، وفي حولي تقدر تحفظ لها تلات ورديات خميس ← يتحفظوا. التداخل
   بين الورديات لسه بيتفحص عبر كل الفروع. التفاصيل في [45](45-max-shifts-per-branch.md). وردية بتبدأ ليلاً وتخلص اليوم
   التاني بتتعد في يوم بدايتها.
4. **المالك يغيّر الحد:** كمالك افتح `/schedules` ← فوق الجدول لوحة **إعدادات الورديات** فيها **الافتراضي: 3 ورديات في
   اليوم** وحقل **أقصى عدد ورديات تبدأ في اليوم** (من 1 لـ 4) وزرار **حفظ إعدادات الورديات**. اكتب `4` ← **حفظ إعدادات
   الورديات**. الرسالة الافتراضية تختفي. الوردية الرابعة دلوقتي بتتحفظ، وزرار **إضافة وردية** بيتقفل عند 4. سطر تدقيق واحد
   بقبل/بعد (3 افتراضي ← 4) وبالمستخدم.
5. **قيم مرفوضة:** `0` أو `5` أو `2.5` ← **البيانات المرسلة غير صحيحة** (`VALIDATION_FAILED`، 400)، ومفيش تغيير.
   إرسال نفس القيمة الحالية ← يرجع القيمة من غير أي سطر تدقيق.
6. **مين يقدر يغيّر:** المدير اللي مالوش الصلاحية ما بتظهرلوش اللوحة، ولو ضرب الـ API بـ `PUT` أو `GET` على
   `/schedule-settings` ← **المسار غير موجود** (`NOT_FOUND`، 404)، نفس رد أي مسار جداول ممنوع عليه، ومن غير ما يتأكد إن
   الإعداد موجود. الصلاحية اسمها **تغيير أقصى عدد ورديات في اليوم** (`manage:schedule-settings:business`): صاحب الشركة بس
   افتراضيًا. من شاشة الصلاحيات ([12](12-permissions-screen.md)) صاحب الشركة يديها لمدير عام كسماح شخصي ← المدير العام
   بقى يشوف اللوحة ويغيّر. أي حد غير صاحب الشركة يحاول يديها ← **صاحب الشركة فقط يقدر يمنح الصلاحية دي**
   (`PERMISSION_OWNER_ONLY`، 403). جهاز الكاشير ما ياخدهاش أبدًا.
7. **تنزيل الحد (MS-Q4):** خلّي أسبوع فيه 4 ورديات يوم الخميس (والحد 4)، وبعدين نزّل الحد لـ 3 ← التنزيل بيتقبل، والأسبوع
   المحفوظ ما بيتلمسش. عدّل يوم السبت بس في الأسبوع ده ← بيتحفظ (الخميس ما اتغيّرش). عدّل أي وردية خميس والخميس لسه 4 ←
   **عدد الورديات تجاوز الحد اليومي للنشاط** (422). الرفض بيتفحص على الأيام اللي الحفظ غيّرها بس.
8. **قالب فيه يوم زيادة:** قالب اتحفظ بـ 4 ورديات في يوم، وبعد تنزيل الحد لـ 3 ← تطبيقه (`apply`) على موظفات بيتعاد بنفس
   الرفض **قبل أي كتابة**؛ تعديل اسم القالب بس بيتقبل؛ وتعديل اليوم الزيادة لازم يحترم الحد الجديد. قراءة القالب وأرشفته
   شغالين. رفض القالب في الإنشاء والتعديل بيرجع `details` فيها `max_shifts_per_day` و`days` (رقم اليوم، 0 = السبت).
9. **72 ساعة في العيد (MS-Q5 والـ16 ساعة):** الحد 4. احفظ على أسبوعين: الخميس `08:00`–`00:00`، الجمعة `03:00`–`19:00`
   و`21:00`–`13:00`، والسبت اللي بعده `16:00`–`08:00` (النهاية قبل البداية معناها اليوم التالي). كل وردية 16 ساعة، وبينهم
   فواصل، واتحفظوا. وردية واحدة من الخميس `08:00` للجمعة `08:00` (24 ساعة) ← **استخدم أوقات ورديات صحيحة، بحد أقصى 16 ساعة
   للوردية** (`SCHEDULE_SHIFT_INVALID`، 400). ورديتين بيلمسوا بعض (نهاية الأولى = بداية التانية) متقبلين، ومفيش حد أدنى
   للفاصل.
10. **المسار من غير الشاشة:** ملف الـ POS ما اتغيّرش، ومفيش حاجة أوفلاين. الحضور والعمولة ما اتأثروش بعدد الورديات.

**ممنوع يحصل:**
- وردية رابعة تتحفظ والحد 3، أو يوم يعدّي الحد في موظفة اتعدّت ورديتها عبر فرعين.
- تنزيل الحد يعدّل أو يمسح جداول أو قوالب محفوظة.
- مدير من غير الصلاحية يشوف اللوحة أو يغيّر الرقم، أو الرد يكشف إن الإعداد أو النشاط موجود.
- حد غير صاحب الشركة يدي صلاحية الإعداد.
- قيمة برّه 1 لـ 4 تتحفظ، أو تغيير فعلي بدون سطر تدقيق، أو حفظ بنفس القيمة يكتب تدقيق.
- وردية أطول من 16 ساعة، أو تطبيق قالب بعد التنزيل يكتب جزء من النسخ قبل الرفض.

## English

1. **Default 3:** open `/schedules` for Salmiya → a future week. Press **Edit day** on Sara's Thursday cell → **Edit
   employee schedule**. Press **Add shift** three times and set `09:00`–`13:00`, `14:00`–`18:00` and `19:00`–`23:00` →
   **Save schedule**. It saves (before #143 the third was refused). The **Add shift** button disables when the day reaches
   the limit (3).
2. **The fourth is refused:** through the API send a fourth shift for the same Thursday (for example `06:00`–`08:00`) →
   **422** "The number of shifts exceeds the business daily limit" (`SCHEDULE_DAY_LIMIT_EXCEEDED`), with `details`
   `max_shifts_per_day: 3` and `working_dates` holding Thursday. Nothing is written. If the refusal reaches the dialog (for example the limit was lowered in another tab while it was open) the save message
   continues with "— Limit 3 shifts per day: 2026-…" naming the refused day.
3. **Since #151 the count is per branch:** as #143 shipped, the limit counted per employee across every branch. Since #151 it
   counts only the shifts in the branch being saved: Sara has a Thursday shift in Salmiya; in Hawalli add three Thursday shifts
   for her → they save. Overlap is still checked across all branches. See [45](45-max-shifts-per-branch.md). A shift that
   starts at night and ends the next day counts on its start day.
4. **The Owner changes it:** as the Owner open `/schedules` → above the grid is the **Schedule settings** panel with
   "Default: 3 shifts per day", the field **Maximum shifts starting per day** (1 to 4) and **Save schedule settings**.
   Type `4` → **Save schedule settings**. The default note disappears. The fourth shift now saves, and **Add shift**
   disables at 4. One audit entry holds before/after (3 default → 4) and the actor.
5. **Refused values:** `0`, `5` or `2.5` → "The request is not valid" (`VALIDATION_FAILED`, 400) and nothing changes.
   Submitting the current value returns it with no audit entry.
6. **Who may change it:** the manager without the permission does not see the panel, and calling `PUT` or `GET` on
   `/schedule-settings` through the API → "Not found" (`NOT_FOUND`, 404), the same answer as any refused schedule route,
   never confirming the setting exists. The permission is "Change the maximum shifts per day"
   (`manage:schedule-settings:business`): the company Owner only by default. On the permissions screen
   ([12](12-permissions-screen.md)) the Owner gives it to a General Manager as a personal Allow → he now sees the panel
   and can change the number. Anyone but the Owner trying to grant it → "Only the company owner can grant this
   permission" (`PERMISSION_OWNER_ONLY`, 403). A cashier device never receives it.
7. **Lowering the limit (MS-Q4):** have a week with 4 Thursday shifts (limit 4), then lower the limit to 3 → the change is
   accepted and the stored week is untouched. Edit only Saturday of that week → saves (Thursday did not change). Edit any
   Thursday shift while Thursday still holds 4 → "The number of shifts exceeds the business daily limit" (422). The check
   covers only the start days the save changes.
8. **A template with an excess day:** a template saved with 4 shifts on one day, after the limit drops to 3 → applying it
   (`apply`) to employees is refused with the same error **before any write**; editing only the template name is
   accepted; editing the excess day must respect the new limit. Reading and archiving the template still work. Template
   create/update refusals return `details` with `max_shifts_per_day` and `days` (day number, 0 = Saturday).
9. **A 72-hour Eid stretch (MS-Q5 and the 16 h cap):** limit 4. Save across two weeks: Thursday `08:00`–`00:00`, Friday
   `03:00`–`19:00` and `21:00`–`13:00`, and the following Saturday `16:00`–`08:00` (an end at or before the start means
   the next day). Each shift is 16 hours with gaps between them, and all save. A single shift from Thursday `08:00` to
   Friday `08:00` (24 hours) → "Use valid shift times, with each shift at most 16 hours" (`SCHEDULE_SHIFT_INVALID`, 400).
   Two shifts that touch (the first ends when the second starts) are accepted; there is no minimum gap.
10. **Outside the screen:** the POS is unchanged and nothing is offline. Attendance and commission do not depend on the
    number of shifts.

**Must NOT happen:**
- A fourth shift saving at limit 3, or an employee exceeding the limit by working in two branches.
- Lowering the limit editing or deleting stored schedules or templates.
- A manager without the permission seeing the panel or changing the number, or a reply that reveals the setting or business
  exists.
- Anyone but the Owner granting the setting permission.
- A value outside 1 to 4 being saved; an actual change without an audit entry; a same-value save writing audit.
- A shift over 16 hours; a template apply after lowering that writes some copies before refusing.

## For an agent

- Admin at `http://localhost:3001/schedules` (a branch must be selected). Panel heading "Schedule settings" / «إعدادات
  الورديات»; the field is `#schedule-max-shifts` (`type=number`, `min=1`, `max=4`); button **Save schedule settings** /
  **حفظ إعدادات الورديات**. The edit dialog opens from **Edit day** / **تعديل اليوم**; **Add shift** / **إضافة وردية**
  disables when the day's shift count equals the effective limit; **Save schedule** / **حفظ الجدول**. Today the same
  panel also shows the per-branch fields of [45](45-max-shifts-per-branch.md) (`#branch-max-shifts`); for the business
  steps use `#schedule-max-shifts` only.
- API (session cookie + `x-company-id`; no `Idempotency-Key` on the settings routes):
  - `GET /v1/businesses/{businessId}/schedule-settings` → 200 `{ business_id, max_shifts_per_day: 3, is_default: true,
    updated_at: null }` (the response today also carries per-branch rows from #151).
  - `PUT /v1/businesses/{businessId}/schedule-settings` body `{ "max_shifts_per_day": 4 }` (strict, integer 1 to 4) → 200
    with the new row. Both need `manage:schedule-settings:business`; without it, 404 `NOT_FOUND`; staff feature off →
    `FEATURE_DISABLED`; bad value or extra key → 400 `VALIDATION_FAILED`.
  - The schedule grid (`GET /v1/businesses/{businessId}/branches/{branchId}/schedules`) and the template list
    (`GET /v1/businesses/{businessId}/shift-templates`) now carry `max_shifts_per_day`; the contract's shift array bound
    went from 14 to 28 (7 days times 4).
  - Saving a week: `PUT /v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}`; applying a template:
    `POST /v1/businesses/{businessId}/shift-templates/{templateId}/apply`. Refusal: **422** `SCHEDULE_DAY_LIMIT_EXCEEDED`
    with `details: { max_shifts_per_day, working_dates: ["YYYY-MM-DD"] }`; for template create/update
    `details: { max_shifts_per_day, days: [0..6] }`. `SCHEDULE_SHIFT_INVALID` (400) now means bad times or over 16 hours only.
- Assertions: after the refusal no shift row is written; the audit has exactly one entry per actual change; after lowering,
  the stored week reads back unchanged. A 20-copy template apply at the maximum (28 shifts per copy) takes about 180 to
  345 ms, slightly over the 200 ms rule; you chose to keep the cap of 20 and track the speed-up in issue #145 (MS-Q6).
- Sources: `docs/specs/042-staff-max-shifts-setting/spec.md` and `contracts/schedule-settings-api.md`,
  `apps/admin/src/staff/ui/schedule-settings-panel.tsx`, `apps/admin/src/staff/model/schedule-save-error.ts`,
  `apps/api/src/modules/staff/http/schedule-settings.controller.ts`, `apps/api/src/modules/staff/domain/schedule-settings.ts`,
  `packages/i18n/src/schedule-shell-catalog.ts`.
