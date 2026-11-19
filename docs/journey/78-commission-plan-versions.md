# 78 · Commission plan versions — نسخ خطة العمولة

**Status / الحالة:** shipped in #551 (48a-1: the engine moved to `packages/commissions-engine`), #695 (48-1: plan
storage, contracts and the plan permission), #730 (48-2: create and list plan versions) and #793 (48-2b: the plan
screens' employee list), all merged (spec 059 row 48, ADR-0054). **API only, no screen:** the plan builder screen is
row 48-3 and is not built (deferred, PP-169.1). The routes are on staging and need the `commissions` feature. A saved
plan changes **no payslip yet**: generating, reviewing and approving a monthly statement (rows 51–54) are not built
([80](80-commission-statements-groundwork.md)). The plan's maths is [06](06-commission-engine-i.md).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the API, then `pnpm db:migrate` and `pnpm db:seed`; or staging with the
  demo company «صالون الأميرة (تجريبي)». The `commissions` feature on.
- The **Owner** or an **Accountant** (both hold **إدارة خطط العمولة** / **Manage commission plans** by default), and
  a Branch Manager without it.
- A synthetic employee منى (Mona) of the business.

## العربي

API بس، لسه مفيش شاشة.

1. **قائمة الموظفين:** صاحب الشركة يطلب قائمة موظفين الخطط للنشاط ← موظفين النشاط بأسمائهم، في صفحات.
2. **خطة جديدة:** يبعت لمنى نسخة خطة: `effective_from` = النهارده، `whole_period: false`، و`base` نسبة 10%
   (`PCT`، `bps: 1000`)، والشرائح و`package_sale` مقفولين ← 201 والنسخة رقمها `version: 1`.
3. **نسخة تانية:** نسخة جديدة بتاريخ بكرة بنسبة 12% ← `version: 2`. النسخ بتتضاف بس، عمرها ما بتتعدّل ولا تتمسح.
4. **السجل:** يطلب نسخ خطة منى ← الأحدث الأول، وكل واحدة بتاريخها ومين عملها.
5. **تاريخ قديم:** نسخة عادية بتاريخ امبارح ← **تاريخ البداية لازم يكون النهارده أو بعده.**
6. **خطة مش صالحة:** نسبة أكبر من 100%، أو شرائح مش مترتبة ← **الخطة دي مش صالحة، راجع إعداداتها.** (422، ومعاها
   `details.code` من المحرك).
7. **شهر كامل:** نسخة بـ `whole_period: true` لشهر فات ولسه مسودة ← بتتقبل (كده بتتصلح موظفة اتلاقت من غير خطة بعد
   آخر الشهر). لو الشهر ده اتراجع ← **الشهر ده اتراجع، رجّعه للمسودة الأول.** ولو اتعمد ← **الشهر ده اتعمد خلاص، أي
   تغيير هيتسجّل تصحيح في الشهر الجاي.**
8. **قبل بداية النشاط:** شهر قبل ما النشاط يبدأ على PosPay ← **الشهر ده قبل ما النشاط يبدأ على PosPay، اختار شهر بعد
   بداية النشاط.**
9. **موظفة مش من النشاط:** ← **الموظفة غير موجودة في النشاط ده.**
10. **من غير صلاحية:** مدير الفرع يحاول ← 403.
11. **نفس الطلب مرتين:** نفس `Idempotency-Key` ← نفس النسخة، من غير نسخة تانية.

**ممنوع يحصل:**
- نسخة خطة تتعدّل أو تتمسح.
- نسخة توصل لشهر اتعمد.
- رقمين `version` متكررين لنفس الموظفة.
- رقم الراتب يظهر في نص سجل التدقيق.
- مستخدم من غير **إدارة خطط العمولة** يقرا خطة أو يكتبها.

## English

API only, no screen yet.

1. **The employee list:** the Owner asks for the plan screens' employee list of the business → the business's
   employees with their names, in pages.
2. **A new plan:** he posts a plan version for Mona: `effective_from` = today, `whole_period: false`, `base` 10%
   (`PCT`, `bps: 1000`), tiers and `package_sale` off → 201, and the version is `version: 1`.
3. **A second version:** a new version dated tomorrow at 12% → `version: 2`. Versions are only added; they are never
   edited or deleted.
4. **History:** he lists Mona's plan versions → newest first, each with its date and who created it.
5. **A past date:** an ordinary version dated yesterday → **The start date must be today or later.**
6. **An invalid plan:** a percentage above 100%, or tiers out of order → **The commission plan is invalid. Check its
   settings.** (422, with the engine's `details.code`).
7. **A whole month:** a version with `whole_period: true` for a past month that is still a draft → accepted (this is
   how an employee found without a plan after the month ended is fixed). If that month was reviewed → **This month
   has been reviewed; return it to draft first.**; if it was approved → **This month is already approved; changes
   become corrections in the next month.**
8. **Before the business started:** a month before the business started on PosPay → **This month is before the
   business started on PosPay; choose a later month.**
9. **An employee of another business:** → **The employee was not found in this business.**
10. **No permission:** the Branch Manager tries → 403.
11. **The same request twice:** the same `Idempotency-Key` → the same version, no second one.

**Must NOT happen:**
- A plan version edited or deleted.
- A version reaching an approved month.
- Two equal `version` numbers for one employee.
- The salary figure in the audit text.
- A user without **Manage commission plans** reading or writing a plan.

## For an agent

- **Screens:** none (row 48-3). No `commissions` folder exists in `apps/admin/src`.
- **API** (`apps/api/src/modules/commissions/http/`, all `manage:commission-plans:business` + the `commissions`
  feature, `x-company-id`):
  `GET /v1/businesses/<BUSINESS_ID>/commission-plan-employees` ·
  `POST|GET /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/commission-plan-versions` (the `POST` needs an
  `Idempotency-Key`).
- **Body** (`packages/contracts/src/commissions/plan-versions.ts`, `createCommissionPlanVersionInput`):
  `effective_from` (a date), `whole_period`, `base`, `tiers`, `package_sale`. A percentage is integer `bps`; a
  `FIXED` amount and an `AMOUNT` threshold are KWD strings; `SALARY_MULTIPLE` is a two-decimal string.
- **Permission defaults:** `owner`, `accountant` (`packages/db/src/role-defaults.ts`).
- **Errors** (`packages/i18n/src/commission-plan-errors.ts`): `COMMISSION_PLAN_INVALID` 422 ·
  `COMMISSION_EFFECTIVE_FROM_PAST` · `COMMISSION_PERIOD_NOT_DRAFT` 409 · `COMMISSION_PERIOD_CLOSED` 409 ·
  `COMMISSION_PERIOD_BEFORE_BUSINESS` · `EMPLOYEE_NOT_FOUND`.
- **Assertions:** `commission_plan_versions` is insert-only with `ENABLE` + `FORCE` RLS; one audit entry
  `commission_plan.version_created` per version.
- **Sources:** `docs/specs/059-commissions-statements/spec.md` (FR-005 … FR-010a, rows 48-1, 48-2, 48-2b),
  `docs/adr/0054-commissions-engine-package-recovery-flags-and-read-path.md`.
