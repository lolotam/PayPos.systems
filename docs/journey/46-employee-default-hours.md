# 46 · Default working hours per employee — الدوام الافتراضي للموظفة

**Status / الحالة:** shipped in #154 (PR 16d, merged). The API is live on staging (api + worker at commit `6c220e4`,
2026-10-11); the admin and POS apps are **not** deployed yet (issue #54), so the screens run locally only. Your decisions
DH-Q1 to DH-Q7 of 2026-10-10 apply, and rules a and b were confirmed on 2026-10-11
([owner-questions.ar.md](../specs/048-staff-employee-default-hours/owner-questions.ar.md)): each employee has, **for every branch
she is linked to** and **for every weekday**, a start time, an end time and an optional break; it **pre-fills** the schedule and
**warns** when a saved shift differs (the warning never blocks saving); **owner only by default, and the owner can grant it**;
optional, but the profile says «دوامها مش مكتوب» when nothing is recorded. If the partner's pick differs from yours, the
partner's pick wins (your ruling). **Day 0 is Saturday.** The "contracted hours this month" figure (DH-Q4) is stored and
computable but has **no screen or endpoint yet**: it appears in the monthly report with row 27. Builds on [43](43-schedule-break-window.md)
(the break) and [19](19-schedules.md) (the schedule editor).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), `pnpm db:migrate` (the `employee_default_shifts` table) and `pnpm db:seed`
  (the new permission `manage:employee-hours:business`, "إدارة الدوام الافتراضي للموظفات" / "Manage employee default working
  hours"). Sign in and select a company and business ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md)); `staff` is enabled.
- Branches Salmiya (فرع السالمية) and Hawalli (فرع حولي). Synthetic employees: سارة (Sara) linked to **both** branches, هبة (Heba)
  linked to Salmiya only ([13](13-create-employee.md), [16](16-update-employee.md)). A future Saturday week.
- Synthetic users: the **Owner** (holds the permission by default); a **Hawalli Branch Manager** with a **branch-scoped grant** of
  the permission on Hawalli (the grant steps are in the agent section); a **Salmiya Branch Manager** with no grant.

## العربي

1. **افتح الملف:** من القائمة الجانبية **الموظفون** ← `/staff` ← **تعديل** على سارة. تحت الراتب والـ IBAN قسم **الدوام الافتراضي**،
   وفيه كارت لكل فرع هي مرتبطة بيه: **فرع السالمية** و**فرع حولي**. كل كارت لسه فاضي فيه **دوامها مش مكتوب**. هبة ليها كارت السالمية بس.
2. **اكتب أسبوع السالمية:** (الأونر) في كارت السالمية علّم **السبت** ← يظهر **البداية** `09:00` و**النهاية** `17:00` جاهزين،
   ودوس **إضافة بريك** واكتب **بداية البريك** `13:00` و**نهاية البريك** `14:00`؛ بيظهر جنبهم **480 دقيقة شاملة البريك** (البريك
   محسوب من ساعات الدوام). علّم الأحد والاثنين والثلاثاء والأربعاء بنفس الشكل، والخميس `09:00`–`21:00` وبريك `14:00`–`15:00`
   (**720 دقيقة شاملة البريك**). الجمعة سيبه من غير علامة ← **حفظ الدوام الافتراضي** ← **اتحفظ الدوام الافتراضي**. أعد فتح الملف ← الأسبوع
   زي ما هو، ومفيش **دوامها مش مكتوب** على كارت السالمية. سطر تدقيق واحد (القبل والبعد والفرع واللي عمل).
3. **كل فرع لوحده (DH-Q7):** في كارت حولي علّم **الجمعة** `14:00`–`22:00` من غير بريك ← **حفظ الدوام الافتراضي**. أسبوع السالمية ما يتغيرش،
   وكارت حولي محفوظ لوحده.
4. **حفظ نفس الأسبوع تاني:** ما يكتبش سطر تدقيق (مفيش تغيير). **مسح الدوام الافتراضي** ← الكارت يرجع **دوامها مش مكتوب** ويتكتب سطر تدقيق.
5. **دوام ليلي:** `22:00`–`06:00` ← يتقبل (8 ساعات). يوم أطول من 16 ساعة ← الحفظ يترفض بـ **استخدم أوقات ورديات صحيحة، بحد أقصى
   16 ساعة للوردية** (`SCHEDULE_SHIFT_INVALID`، 400) ومفيش حاجة اتكتبت. بريك لازق في أول اليوم أو آخره أو برّاه ← **وقت البريك لازم يكون
   جوّه الشيفت** (`SCHEDULE_BREAK_INVALID`، 400). يوم من غير بريك يتقبل (البريك اختياري).
6. **فرع مش مرتبطة بيه:** اطلب بالـ API دوام لسارة في فرع هي مش مرتبطة بيه النهارده ← **الموظفة مش مرتبطة بالفرع المختار**
   (`EMPLOYEE_BRANCH_NOT_LINKED`، 422). لو الارتباط انتهى بعد ما الدوام اتحفظ، الكارت يفضل ومكتوب عليه **مش مرتبطة بالفرع دلوقتي**
   من غير تعديل، ومبيدخلش في الجدول.
7. **الجدول بيتملي لوحده (DH-Q3):** افتح `/schedules` على السالمية ← **تعديل اليوم** لسارة يوم الخميس ← **إضافة وردية** ← أول وردية بتظهر
   `09:00`–`21:00` وبريك `14:00`–`15:00` (دوامها)، وتقدر تعدّلها قبل الحفظ. وردية تانية في نفس اليوم، أو يوم من غير دوام افتراضي في الفرع،
   بيستخدموا الاقتراح العادي. على حولي: **إضافة وردية** للجمعة تدي `14:00`–`22:00` بدون بريك — عمره ما بيستخدم دوام السالمية في حولي.
   التعبئة لوحدها ما بتكتبش حاجة؛ الحفظ هو حفظ الأسبوع العادي بكل فحوصاته (الحد اليومي للفرع [45](45-max-shifts-per-branch.md)، التداخل، السبب لليوم الفات).
8. **التحذير:** غيّر خميس سارة لـ `09:00`–`20:00` ← تحت اليوم تظهر **ده مختلف عن دوام سارة**. الحفظ لسه شغال.
   نفس اليوم مطابق للدوام (بداية ونهاية وبريك) ← مفيش تحذير. يوم فيه ورديتين، أو بريك مختلف، أو من غير بريك والدوام ليه بريك ← التحذير يظهر.
   يوم من غير ورديات ← مفيش تحذير. يوم أسبوع مفيش ليه دوام افتراضي في الفرع ده ← مفيش تحذير.
9. **تغيير الدوام بعدين:** عدّل أسبوع السالمية لسارة ← أي أسبوع أو قالب محفوظ ما يتغيرش؛ الورديات اللي بتتضاف بعد كده بس بتتملي بالدوام الجديد،
   والتحذير بيقارن بالدوام الجديد.
10. **الصلاحية (DH-Q5):** مدير فرع السالمية من غير صلاحية يفتح الملف (لو يقدر يشوفه) ← يشوف الدوام مكتوب كنص (**السبت · 09:00–17:00 · البريك 13:00–14:00 ·
    480 دقيقة شاملة البريك**) من غير أي حقل تعديل، وأي محاولة بالـ API ← **غير مسموح بهذا الإجراء** (`FORBIDDEN`، 403) ومفيش حاجة اتكتبت.
    مدير حولي اللي معاه صلاحية على حولي بس يقدر يعدّل كارت حولي بس، وكارت السالمية عنده قراءة فقط. لو صلاحية الفرع اتمنعت (Deny) على فرع، تغلب أي سماح على
    مستوى النشاط. الجهاز المقترن عمره ما ياخد الصلاحية.
11. **هبة:** افتح ملفها ← كارت السالمية فيه **دوامها مش مكتوب** (ومحدش يتمنع من حاجة بسببه). موظفة جديدة تتعمل من غير دوام ← بتتعمل عادي
    وملفها فيه نفس الجملة.

**ممنوع يحصل:**
- دوام فرع يتملى في فرع تاني، أو التحذير يمنع الحفظ، أو التعبئة تكتب حاجة قبل ما المدير يدوس **حفظ الجدول**.
- أي تغيير في الدوام الافتراضي يمس أسبوع أو قالب محفوظ.
- دوام لفرع الموظفة مش مرتبطة بيه، أو يوم أطول من 16 ساعة، أو أكتر من سطر ليوم واحد، أو بريك خارج اليوم.
- مدير من غير صلاحية يعدّل، أو صلاحية فرع تعدّل فرع تاني، أو سطر تدقيق لتغيير ما حصلش.
- ظهور «دوامها مش مكتوب» بيمنع إنشاء الموظفة أو حفظ جدولها.

## English

1. **Open the profile:** from the sidebar open **Employees** → `/staff` → **Edit** on Sara. Under salary and IBAN there is a
   **Default working hours** section with one card per branch she is linked to: **Salmiya** and **Hawalli**. Both are still empty and
   say **Her default hours are not recorded**. Heba has the Salmiya card only.
2. **Write the Salmiya week:** (as the Owner) in the Salmiya card tick **Saturday** → **Start** `09:00` and **End** `17:00` appear ready;
   press **Add break** and enter **Break start** `13:00` and **Break end** `14:00`; **480 minutes including break** shows beside them (the break is
   counted in the hours). Tick Sunday to Wednesday the same way, and Thursday `09:00`–`21:00` with break `14:00`–`15:00`
   (**720 minutes including break**). Leave Friday unticked → **Save default hours** → **Default hours saved**. Reopen the profile → the week is
   as saved and the Salmiya card no longer says **Her default hours are not recorded**. One audit row (before, after, branch, actor).
3. **Each branch on its own (DH-Q7):** in the Hawalli card tick **Friday** `14:00`–`22:00` with no break → **Save default hours**. Sara's Salmiya week is
   unchanged; the Hawalli card is stored separately.
4. **Saving the same week again** writes no audit row (nothing changed). **Clear default hours** → the card goes back to **Her default hours are not
   recorded** and one audit row is written.
5. **Overnight:** `22:00`–`06:00` is accepted (8 hours). A day longer than 16 hours → refused with **Use valid shift times, with each shift at most 16
   hours** (`SCHEDULE_SHIFT_INVALID`, 400) and nothing is written. A break touching the start or end of the day, or outside it → **The break must be
   inside the shift** (`SCHEDULE_BREAK_INVALID`, 400). A day without a break is accepted (a break is optional).
6. **A branch she is not linked to:** through the API, set hours for Sara in a branch she is not linked to today → **The employee is not linked to this
   branch today.** (`EMPLOYEE_BRANCH_NOT_LINKED`, 422). If a link ends after hours were saved, the card stays showing **No longer linked** without
   edit controls, and it is not used in the schedule.
7. **The schedule pre-fills (DH-Q3):** open `/schedules` on Salmiya → **Edit day** for Sara's Thursday → **Add shift** → the first shift appears as
   `09:00`–`21:00` with break `14:00`–`15:00` (her default) and can be edited before saving. A second shift on the same day, or a weekday with no default
   in this branch, uses today's normal suggestion. On Hawalli, **Add shift** on Friday gives `14:00`–`22:00` with no break; Salmiya's defaults are never used
   in Hawalli. Pre-filling writes nothing; saving is the normal week save with all its checks (the branch day limit in [45](45-max-shifts-per-branch.md),
   overlap, eligibility, past-day reason).
8. **The warning:** change Sara's Thursday to `09:00`–`20:00` → under the day appears **This differs from Sara’s default hours**; **Save schedule** still works.
   A day that matches her default exactly (start, end and break) → no warning. A day with two shifts, a different break, or no break while the default has one →
   the warning shows. A day with no shifts → no warning. A weekday with no default in this branch → no warning.
9. **Changing a default later:** edit Sara's Salmiya week → no saved week or template changes; only shifts added afterwards are pre-filled with the new hours,
   and the warning compares with the new default.
10. **Permission (DH-Q5):** the Salmiya manager without the permission opens the profile (if she may see it) → sees the hours as text (**Saturday · 09:00–17:00 ·
    Break 13:00–14:00 · 480 minutes including break**) and no edit fields; an API attempt → **This action is not allowed** (`FORBIDDEN`, 403), nothing
    written. The Hawalli manager holding a grant on Hawalli only can edit the Hawalli card only; the Salmiya card is read-only for her. A branch **Deny** beats a
    business-level Allow. A paired device never receives the permission.
11. **Heba:** open her profile → the Salmiya card says **Her default hours are not recorded** and nothing is ever blocked by it. A new employee created with no
    hours is created normally and shows the same sentence.

**Must NOT happen:**
- One branch's hours pre-filling or warning in another branch, the warning blocking a save, or pre-fill writing anything before **Save schedule**.
- A change of default hours touching any saved week or template.
- Hours saved for a branch she is not linked to, a day over 16 hours, two rows for one weekday, or a break outside the day.
- A non-holder editing, a branch grant editing another branch, or an audit row for a change that did not happen.
- "Her default hours are not recorded" blocking creating an employee or saving her schedule.

## For an agent

- Admin: `http://localhost:3001/staff` → **Edit** on the employee → section named **Default working hours** / **الدوام الافتراضي** (`<section
  aria-label>`). Per-branch `<h4>` is the branch name (Arabic name when the UI is Arabic). Weekday checkboxes are labelled with the day names
  (**Saturday** / **السبت** … **Friday** / **الجمعة**); time inputs **Start** / **البداية** and **End** / **النهاية**; **Add break** / **إضافة بريك**; duration
  text `N minutes including break` / `N دقيقة شاملة البريك`; buttons **Save default hours** / **حفظ الدوام الافتراضي** and **Clear default hours** /
  **مسح الدوام الافتراضي**; success `role="status"` **Default hours saved** / **اتحفظ الدوام الافتراضي**; empty branch **Her default hours are not recorded** /
  **دوامها مش مكتوب**; unlinked **No longer linked** / **مش مرتبطة بالفرع دلوقتي**; a client-side validation failure shows **Check the employee details, dates and user ID.**
  The section renders nothing when the read is refused. Schedule editor: `http://localhost:3001/schedules`, dialog **Edit employee schedule**; the warning is a
  `role="status"` paragraph **This differs from {name}’s default hours** / **ده مختلف عن دوام {name}**.
- API (session cookie + `x-company-id`; no `Idempotency-Key`; the same PUT twice is a no-op):
  - `GET /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/default-shifts` (same access as the employee detail) →
    `{ employee_id, can_manage, branches: [{ branch_id, linked, can_manage, shifts: [{ day, start, end, break_start, break_end }], updated_at }] }`
    (one entry per currently linked branch, plus stored branches no longer linked with `linked: false`; empty `shifts` = "not recorded").
  - `PUT /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/branches/<BRANCH_ID>/default-shifts` with
    `{ "shifts": [ { "day": 0, "start": "09:00", "end": "17:00", "break_start": "13:00", "break_end": "14:00" } ] }` (day `0` = Saturday … `6` = Friday; at most 7
    entries; `{ "shifts": [] }` clears) → the same shape as the GET. Needs `manage:employee-hours` (code `manage:employee-hours:business`, owner by default).
  - Grid: `GET /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/schedules?week_start=<SATURDAY>` rows carry `default_shifts` (that branch only).
  - Grant (Owner's session only): `POST /v1/permissions/memberships/<MEMBERSHIP_ID>/overrides` with `{ "permission_code": "manage:employee-hours:business",
    "effect": "ALLOW", "scope_type": "BRANCH", "scope_id": "<HAWALLI_BRANCH_ID>", "reason": "<SYNTHETIC_REASON>", "expires_at": null }` → 201 (use `COMPANY` /
    `<COMPANY_ID>` for a business-wide grant); a non-owner gets `PERMISSION_OWNER_ONLY` 403.
- Errors: `SCHEDULE_SHIFT_INVALID` 400 · `SCHEDULE_DAY_LIMIT_EXCEEDED` 422 (two entries for one weekday) · `SCHEDULE_BREAK_INVALID` 400 · `EMPLOYEE_BRANCH_NOT_LINKED`
  422 · `VALIDATION_FAILED` 400 · `NOT_FOUND` 404 · `FORBIDDEN` 403 · `FEATURE_DISABLED` · `NOT_READY` 503.
- Assertions: a set / change / clear writes one audit row (entity `employee_default_shifts`, entity id = employee id, branch in the snapshot) and a no-op none; the
  grid row's `default_shifts` holds only the grid branch's entries (none → `[]`); no `staff_schedule_shifts` or template row changes after any PUT; two concurrent
  PUTs for one employee are serialized and both audited; a branch grant gives `can_manage: true` on that branch only; RLS hides another tenant's rows.
- Contracted minutes (no endpoint yet): `apps/api/src/modules/staff/queries/employee-contracted-minutes.query.ts` and the pure `contractedMinutes` in
  `packages/domain`. Fixture check: Sara, Salmiya, October 2026 = 21 Saturday–Wednesday dates × 8 h + 5 Thursdays × 12 h = **228 h**; dates before hire, after
  contract end or outside her link add 0; the current default applies to the whole month; approved leave and public holidays are not subtracted yet.
- Sources: `docs/specs/048-staff-employee-default-hours/spec.md`, `apps/api/src/modules/staff/http/employee-default-shifts.controller.ts`,
  `apps/admin/src/staff/ui/{employee-default-hours-section,employee-default-hours-form,schedule-day-warning}.tsx`,
  `apps/admin/src/staff/model/schedule-form.ts`, `packages/contracts/src/staff/employee-default-shifts.ts`,
  `packages/i18n/src/{employee-default-hours-catalog,schedule-shell-catalog,permission-codes-catalog}.ts`, `apps/api/src/shared/errors.ts`.
