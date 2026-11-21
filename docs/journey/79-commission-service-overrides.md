# 79 · A special commission for one employee on one service — عمولة خاصة لموظفة على خدمة واحدة

**Status / الحالة:** shipped in #762 (49-1: dated per-service employee overrides: contracts, table, use case, routes
and list), merged (spec 059 row 49). **The screen is row 49-2 and ships with this PR (49-2c):** the admin screen for
the overrides is [98](98-commission-service-overrides.md) on `/commissions/overrides`. The routes are on staging and
need the `commissions` feature. Like a plan version ([78](78-commission-plan-versions.md)), an override changes no
payslip until monthly statements are built ([80](80-commission-statements-groundwork.md)).

**Before you start / قبل ما تبدأ:**
- Everything of [78](78-commission-plan-versions.md): the Owner or an Accountant, the employee منى (Mona), the
  `commissions` and `catalog` features on.
- A service of the same business, e.g. «قص شعر» ([29](29-services.md)).

## العربي

القواعد نفسها عن طريق الـ API، وشاشة الأدمن في الرحلة [98](98-commission-service-overrides.md).

1. **عمولة خاصة:** صاحب الشركة يبعت لمنى قاعدة خاصة على «قص شعر»: نسبة 20% (`PCT`، `bps: 2000`) من النهارده ← 201.
   من التاريخ ده، سطور «قص شعر» اللي منى عملتها بتتحسب بـ 20% بدل قاعدة الخطة.
2. **الأنواع الأربعة بس:** القاعدة واحدة من: **اتبع الخطة** (`FOLLOW_PLAN`)، **من غير عمولة** (`ZERO`)، **نسبة**
   (`PCT`)، **مبلغ ثابت** (`FIXED` بالدينار). مفيش نوع خامس.
3. **قاعدة جديدة بتاريخ جديد:** قاعدة تانية لنفس الخدمة بتاريخ بكرة ← القديمة بتفضل في السجل، والجديدة هي السارية من
   بكرة. القواعد بتتضاف بس.
4. **السجل:** يطلب قواعد منى ← الحالية والتاريخ لكل خدمة، وكل صف عليه `is_current` و`effective_from`. ممكن يفلتر
   بـ `service_id`.
5. **رجّعها للخطة:** قاعدة `FOLLOW_PLAN` على نفس الخدمة ← منى ترجع لقاعدة خطتها في الخدمة دي.
6. **تاريخ قديم:** تاريخ امبارح ← **تاريخ البداية لازم يكون النهارده أو بعده.**
7. **خدمة مش من النشاط:** خدمة من نشاط تاني أو مش موجودة ← بيترفض ومفيش حاجة بتتكتب.
8. **شهر معتمد:** لو التاريخ يمس شهر اتعمد ← **الشهر ده اتعمد خلاص، أي تغيير هيتسجّل تصحيح في الشهر الجاي.**
9. **من غير صلاحية:** مستخدم من غير **إدارة خطط العمولة** ← 403.

**ممنوع يحصل:**
- قاعدة خاصة تتعدّل أو تتمسح (بتتضاف واحدة جديدة بس).
- قاعدة موظفة تأثر على موظفة تانية، أو على خدمة تانية.
- قاعدة على خدمة من نشاط تاني.
- سطر اتحفظ قبل تاريخ القاعدة يتغيّر حسابه.
- نوع قاعدة غير الأربعة يتقبل.

## English

The rules themselves are API only; the admin screen is [98](98-commission-service-overrides.md).

1. **A special commission:** the Owner posts an override for Mona on «قص شعر»: 20% (`PCT`, `bps: 2000`) from today →
   201. From that date, the «قص شعر» lines Mona performs are computed at 20% instead of the plan's rule.
2. **Only four kinds:** the rule is one of **follow the plan** (`FOLLOW_PLAN`), **no commission** (`ZERO`), a
   **percentage** (`PCT`) or a **fixed amount** (`FIXED`, in KWD). There is no fifth kind.
3. **A new rule with a new date:** a second override for the same service dated tomorrow → the old one stays in the
   history, and the new one applies from tomorrow. Overrides are only added.
4. **History:** he lists Mona's overrides → the current one and the history per service; every row carries
   `is_current` and its `effective_from`. He can filter by `service_id`.
5. **Back to the plan:** a `FOLLOW_PLAN` override on the same service → Mona follows her plan's rule for it again.
6. **A past date:** yesterday's date → **The start date must be today or later.**
7. **A service of another business:** a service of another business, or an unknown one → refused, and nothing is
   written.
8. **An approved month:** if the date touches an approved month → **This month is already approved; changes become
   corrections in the next month.**
9. **No permission:** a user without **Manage commission plans** → 403.

**Must NOT happen:**
- An override edited or deleted (only a new one is added).
- One employee's override affecting another employee or another service.
- An override on a service of another business.
- A line saved before the override's date computed differently.
- A rule kind outside the four accepted.

## For an agent

- **Screens:** the admin screen for the same rules is [98](98-commission-service-overrides.md) (row 49-2); this
  journey stays on the API.
- **API** (`apps/api/src/modules/commissions/http/commission-service-overrides.controller.ts`,
  `manage:commission-plans:business` + the `commissions` feature):
  `POST|GET /v1/businesses/<BUSINESS_ID>/employees/<EMPLOYEE_ID>/commission-overrides`; the `POST` needs an
  `Idempotency-Key`; the `GET` takes `service_id`, `cursor` and `limit` (1–100, default 20).
- **Body** (`packages/contracts/src/commissions/service-overrides.ts`): `{ service_id, rule, effective_from }`.
- **Errors:** `COMMISSION_EFFECTIVE_FROM_PAST` · `COMMISSION_PERIOD_NOT_DRAFT` 409 · `COMMISSION_PERIOD_CLOSED` 409 ·
  `EMPLOYEE_NOT_FOUND`.
- **Assertions:** `commission_service_overrides` is insert-only with `ENABLE` + `FORCE` RLS; audit entry
  `commission_override.created`; "current" = eligible on the business-local date and latest by `(created_at, id)`
  (spec 059 FR-013).
- **Sources:** `docs/specs/059-commissions-statements/spec.md` (FR-011 … FR-013, CS-Q39),
  `docs/specs/059-commissions-statements/plan-49-1.md`.
