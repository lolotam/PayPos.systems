# 45 · Maximum shifts per day, per branch — أقصى عدد ورديات في اليوم لكل فرع

**Status / الحالة:** shipped in #151 (PR 16c-2, merged). It **replaces the company-wide setting of PR 16c (#143, [41](41-max-shifts-setting.md))**: the
business number stays, but any branch may now have its own number. The API is live on staging (api + worker at commit
`6c220e4`, 2026-10-11); the admin app is **not** deployed yet (issue #54), so the settings panel runs locally only.
Your decisions MS-Q1 (changed on 2026-10-10 to the partner's pick, «كل فرع لوحده»), MS-Q2 to MS-Q6 and MB-Q1 to MB-Q3 apply
([owner-questions.ar.md](../specs/047-staff-branch-max-shifts/owner-questions.ar.md),
[spec 042](../specs/042-staff-max-shifts-setting/spec.md)): allowed values **1 to 4**, default **3**, **owner only by
default and the owner can grant it to anyone**, lowering keeps stored rows, no minimum gap between shifts, the 20-copy
cap on applying a template stays. If the partner's pick differs from yours, the partner's pick wins (your ruling).

**Before you start / قبل ما تبدأ:**
- [19 Schedules](19-schedules.md) done (migration, seed, synthetic employees attached on the test days), plus
  `pnpm db:migrate` for the `staff_branch_schedule_settings` table and `pnpm db:seed` for the permission.
- One business with branches Salmiya (فرع السالمية), Hawalli (فرع حولي) and a new branch Fahaheel (فرع الفحيحيل). Employee
  هبة (Heba) attached to Salmiya and Hawalli; سارة (Sara) attached to Salmiya.
- No business number has been saved (the effective number is the default **3**) and no branch has its own number yet.
- Synthetic users: the **Owner** (holds `manage:schedule-settings:business` by default, "تغيير أقصى عدد ورديات في اليوم" /
  "Change the maximum shifts per day"), a **Branch Manager** of Salmiya who may edit schedules but has no settings
  permission, and a **General Manager** to receive a grant.

## العربي

1. **اللوحة:** الأونر يفتح `/schedules` على فرع حولي ← فوق الجدول لوحة **إعدادات الورديات**: **أقصى عدد ورديات تبدأ في اليوم**
   (رقم النشاط) ومكتوب **الافتراضي: 3 ورديات في اليوم** طالما محدش غيّره، وتحتها **الفرع ده: 3 ورديات في اليوم** و**الرقم
   الافتراضي**، وحقل **أقصى عدد ورديات يومياً للفرع ده**، وزرارين **حفظ رقم الفرع** و**استخدام رقم النشاط**، وتحت قائمة
   **الفروع النشطة** بكل فرع ورقمه ومصدره. مدير فرع السالمية اللي معهوش الصلاحية ما يشوفش اللوحة خالص.
2. **رقم للفرع:** على حولي اكتب `4` في **أقصى عدد ورديات يومياً للفرع ده** ← **حفظ رقم الفرع** ← **الفرع ده: 4 ورديات في اليوم**
   و**رقم خاص بالفرع**. روح فرع السالمية واكتب `2` ← **رقم خاص بالفرع** كمان. فرع الفحيحيل في القائمة بـ `3` و**الرقم الافتراضي**.
   كل تغيير بيتكتب له سطر تدقيق واحد (القبل والبعد والفرع واللي عمله). حفظ نفس الرقم بالظبط ما بيكتبش سطر.
3. **كل فرع بيمشي على رقمه:** في حولي احفظ لهبة 4 ورديات يوم الخميس ← يتحفظ. في السالمية احفظ لسارة 3 ورديات يوم الخميس ← يترفض بـ
   **عدد الورديات تجاوز الحد اليومي للنشاط** (`SCHEDULE_DAY_LIMIT_EXCEEDED`، 422) ومعاها **الحد 2 ورديات في اليوم: <التواريخ>**،
   ومفيش حاجة اتكتبت. في الفحيحيل (من غير رقم خاص) الحد 3.
4. **زرار الإضافة:** في السالمية، لما اليوم يوصل لـ 2 ورديات زرار **إضافة وردية** يتعطل. في حولي يتعطل عند 4.
5. **موظفة في فرعين (MB-Q1):** هبة عندها وردتين الخميس في حولي. مدير السالمية يضيف لها وردية مسائية في السالمية ← تتقبل، لأن كل فرع
   بيعد ورديات فرعه بس (1 ≤ 2). مجموعها اليوم 3. لكن لو ضفت وردية لسه جوّه نفس وقت وردية في حولي ← **ورديات الموظف متداخلة.**
   (`SCHEDULE_SHIFT_OVERLAP`، 409)؛ التداخل بيتفحص على كل الفروع دايماً.
6. **مسح رقم الفرع:** على حولي دوس **استخدام رقم النشاط** (مفعّل بس لو للفرع رقم خاص) ← **الفرع ده: 3 ورديات في اليوم** و**الرقم الافتراضي**
   (لسه ما حفظتش رقم نشاط)، ويتكتب سطر تدقيق. مسح فرع من غير رقم خاص ما يكتبش حاجة.
7. **رقم النشاط:** غيّر **أقصى عدد ورديات تبدأ في اليوم** لـ `2` ← **حفظ إعدادات الورديات** ← الفروع اللي من غير رقم خاص (الفحيحيل، وبقت **رقم النشاط**) تمشي
   على 2، والفروع اللي ليها رقم خاص (حولي 4، السالمية 2) ما تتغيرش.
8. **قيم غلط:** `0` أو `5` أو `2.5` ← **البيانات المرسلة غير صحيحة** (`VALIDATION_FAILED`، 400). المتصفح نفسه بيمنع بره المدى 1 لـ 4.
9. **ما فيش مسح للقديم (MS-Q4):** نزّل حولي من 4 لـ 3 ← الأسابيع المحفوظة اللي فيها 4 ورديات في يوم تفضل زي ما هي، وتعديل يوم تاني يتحفظ،
   لكن تغيير اليوم اللي فيه 4 وهو لسه 4 يترفض بنفس رسالة الحد.
10. **القالب (API فقط):** الأول رجّع حولي لـ `4` (زي الخطوة 2)، لأن الخطوتين 6 و7 خلّوا كل الفروع على 2. بعدين قالب فيه 4 ورديات يوم الخميس ← يتحفظ لأن أكبر رقم فعلي في فروع النشاط 4. لو كل الفروع النشطة رقمها 2 ← يترفض
    بـ **عدد الورديات تجاوز الحد اليومي للنشاط** ومعاه الحد 2. تطبيق القالب على السالمية (2) ← يترفض قبل أي كتابة؛ على حولي (4) ← ينجح.
11. **من غير صلاحية:** مدير السالمية يحاول يغير أي رقم بالـ API ← **المسار غير موجود** (`NOT_FOUND`، 404) ومفيش حاجة اتكتبت.
    الأونر يديله صلاحية "تغيير أقصى عدد ورديات في اليوم" من شاشة الصلاحيات ([12](12-permissions-screen.md))، فيقدر يغير أي رقم في أي فرع
    في النشاط. الجهاز المقترن (device) عمره ما ياخدها.

**ممنوع يحصل:**
- رقم فرع يأثر على فرع تاني، أو رقم النشاط يغير فرع ليه رقم خاص.
- أي تغيير في الإعدادات يمسح أو يعدل وردية أو قالب محفوظ.
- حفظ رقم 0 أو 5 أو كسر، أو حفظ جزئي لما يترفض الأسبوع.
- حد لحد اليوم يعد ورديات فرع تاني، أو فحص التداخل يتجاهل فرع تاني.
- مدير من غير الصلاحية يشوف اللوحة أو يغير رقم، أو تغيير مكرر يكتب سطر تدقيق.

## English

1. **The panel:** the Owner opens `/schedules` on Hawalli → above the grid sits the **Schedule settings** panel: **Maximum shifts
   starting per day** (the business number) with **Default: 3 shifts per day** while nobody changed it; below it **This branch: 3
   shifts per day** and **Default number**, the field **This branch's maximum shifts per day**, the buttons **Save branch number**
   and **Use the business number**, and an **Active branches** list with each branch, its number and its source. The Salmiya
   manager without the permission does not see the panel at all.
2. **A number for a branch:** on Hawalli enter `4` in **This branch's maximum shifts per day** → **Save branch number** →
   **This branch: 4 shifts per day** and **Branch number**. Go to Salmiya and enter `2` → **Branch number** too. Fahaheel is in the
   list with `3` and **Default number**. Each change writes one audit row (before, after, branch, actor). Saving the same
   number again writes none.
3. **Each branch follows its own number:** in Hawalli save 4 Thursday shifts for Heba → saved. In Salmiya save 3 Thursday shifts for
   Sara → refused with **The number of shifts exceeds the business daily limit** (`SCHEDULE_DAY_LIMIT_EXCEEDED`, 422) plus
   **Limit 2 shifts per day: <dates>**, and nothing is written. In Fahaheel (no own number) the limit is 3.
4. **The add button:** in Salmiya, once a day holds 2 shifts the **Add shift** button is disabled. In Hawalli it disables at 4.
5. **One employee in two branches (MB-Q1):** Heba has two Thursday shifts in Hawalli. The Salmiya manager adds an evening shift for
   her in Salmiya → accepted, because each branch counts only its own shifts (1 ≤ 2). Her total that day is 3. But a shift that
   overlaps one in Hawalli → **The employee has overlapping shifts.** (`SCHEDULE_SHIFT_OVERLAP`, 409); overlap is always checked across all branches.
6. **Clearing a branch number:** on Hawalli press **Use the business number** (enabled only when the branch has its own number) →
   **This branch: 3 shifts per day** and **Default number** (no business number saved yet), and one audit row. Clearing a branch with no own number writes nothing.
7. **The business number:** change **Maximum shifts starting per day** to `2` → **Save schedule settings** → branches without their
   own number (Fahaheel, now showing **Business number**) follow 2; branches with their own number (Hawalli 4, Salmiya 2) do not change.
8. **Bad values:** `0`, `5` or `2.5` → **The request is not valid** (`VALIDATION_FAILED`, 400). The browser input itself also limits 1 to 4.
9. **Stored rows are never rewritten (MS-Q4):** lower Hawalli from 4 to 3 → saved weeks that have 4 shifts on a day stay as they
   are, editing another day saves, but changing the day that still holds 4 is refused with the same limit message.
10. **Templates (API only):** first set Hawalli back to `4` (as in step 2), since steps 6–7 left every branch at 2. Then a template with 4 shifts on Thursday → saved, because the largest effective number among the business's
    branches is 4. If every active branch is at 2 → refused with **The number of shifts exceeds the business daily limit** and the
    limit 2. Applying it to Salmiya (2) → refused before any write; to Hawalli (4) → succeeds.
11. **Without the permission:** the Salmiya manager tries to change a number through the API → **Not found** (`NOT_FOUND`, 404) and
    nothing is written. The Owner grants "Change the maximum shifts per day" on the permissions screen ([12](12-permissions-screen.md)),
    and the holder can then change any number in any branch of the business. A paired device never receives it.

**Must NOT happen:**
- One branch's number affecting another branch, or the business number changing a branch that has its own.
- A settings change deleting or editing any stored schedule or template.
- Saving 0, 5 or a fraction, or a partial write when a week is refused.
- The limit counting another branch's shifts, or the overlap check ignoring another branch.
- A non-holder seeing the panel or changing a number, or a repeated change writing an audit row.

## For an agent

- Admin: `http://localhost:3001/schedules` (branch selected). Panel ids: business input `#schedule-max-shifts`, branch input
  `#branch-max-shifts`. Buttons by visible text: **Save schedule settings** / **حفظ إعدادات الورديات**, **Save branch number** /
  **حفظ رقم الفرع**, **Use the business number** / **استخدام رقم النشاط**. Source labels: **Branch number** / **رقم خاص بالفرع**,
  **Business number** / **رقم النشاط**, **Default number** / **الرقم الافتراضي**. The panel renders nothing when the settings
  read answers `FORBIDDEN` or `NOT_FOUND`. A save refusal shows the envelope message followed by ` — Limit {limit} shifts per day: {dates}`
  (Arabic: `الحد {limit} ورديات في اليوم: {dates}`).
- API (session cookie + `x-company-id`; no `Idempotency-Key`; repeating the same value is a no-op):
  - `GET /v1/businesses/<BUSINESS_ID>/schedule-settings` → `{ business_id, max_shifts_per_day, is_default, updated_at,
    branches: [{ branch_id, max_shifts_per_day, source: "branch" | "business" | "default", updated_at }] }` (every active branch).
  - `PUT /v1/businesses/<BUSINESS_ID>/schedule-settings` with `{ "max_shifts_per_day": 2 }` sets the business number.
  - `PUT /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/schedule-settings` with `{ "max_shifts_per_day": 4 }` →
    `{ branch_id, max_shifts_per_day, source, updated_at }`; `DELETE` on the same path clears it (`source` becomes `business` or `default`).
  - Permission `manage:schedule-settings:business` (owner by default). Grant: `POST
    /v1/permissions/memberships/<GM_MEMBERSHIP_ID>/overrides` with `{ "permission_code": "manage:schedule-settings:business",
    "effect": "ALLOW", "scope_type": "COMPANY", "scope_id": "<COMPANY_ID>", "reason": "<SYNTHETIC_REASON>", "expires_at": null }`
    from the Owner's session only (a non-owner gets `PERMISSION_OWNER_ONLY`, 403).
  - The grid response carries `max_shifts_per_day` = the branch's effective number (own, else business, else 3); the template page
    carries the largest effective number among active branches.
- Errors: `SCHEDULE_DAY_LIMIT_EXCEEDED` 422 with `details: { max_shifts_per_day, working_dates }` · `SCHEDULE_SHIFT_OVERLAP` 409 ·
  `VALIDATION_FAILED` 400 · `NOT_FOUND` 404 · `FORBIDDEN` 403 · `FEATURE_DISABLED` · `NOT_READY` 503.
- Assertions: set / change / clear each write exactly one audit row (entity `staff_branch_schedule_settings`, entity id = branch id)
  and a no-op none; no `staff_schedule_shifts` or template row changes after any settings call; a refused week leaves revisions and
  audit unchanged; branch A's count ignores branch B's shifts but overlap is global; concurrent "owner lowers Salmiya" and
  "manager saves a third Salmiya shift" are serialized by the company lock; RLS hides another tenant's rows.
- Sources: `docs/specs/047-staff-branch-max-shifts/spec.md`, `docs/specs/042-staff-max-shifts-setting/spec.md`,
  `apps/api/src/modules/staff/http/{branch-schedule-settings,schedule-settings}.controller.ts`,
  `apps/admin/src/staff/ui/schedule-settings-panel.tsx`, `apps/admin/src/staff/model/schedule-save-error.ts`,
  `packages/contracts/src/staff/schedule-settings.ts`, `packages/i18n/src/schedule-shell-catalog.ts`,
  `packages/i18n/src/permission-codes-catalog.ts`, `apps/api/src/shared/errors.ts`.
