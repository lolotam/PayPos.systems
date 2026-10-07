# 29 · Services — الخدمات

**Status / الحالة:** shipped in #114 (PR 32, merged). Local only (admin not deployed, issue #54). The business's service
menu: name, price, commission rule and whether the service counts toward the commission tiers. Nothing uses a service
yet. Recording a service session comes in PR 35 and services import in PR 32b. There is **no delete** and no
"stop selling" yet (SV-Q3). Two services may share a name for now (SV-Q2).

**Before you start / قبل ما تبدأ:**
- `pnpm db:migrate` (the `services` table, its RLS and grants) and `pnpm db:seed` (the new permission defaults), then
  the API and the admin running.
- The `catalog` feature enabled for the company. Without it every services route answers like a disabled feature.
- Who can use it by default: **Owner**, **General Manager** and **Business Manager** (`read:services:business` and
  `manage:services:business`). Any other role needs an explicit **Allow** ([12](12-permissions-screen.md)). A paired
  Device never holds these codes. Synthetic data only.

## العربي

1. من القائمة الجانبية دوس **الخدمات** ← `/catalog`. هتشوف **قائمة خدمات النشاط: السعر وقاعدة العمولة وهل تُحتسب في
   مجمّع الشرائح.** والجدول فيه الاسم والسعر والقاعدة وزرار **تعديل**. (**تُحتسب في المجمّع** بتظهر في شاشة الإضافة والتعديل بس، مش في
   الجدول.) لو مفيش: **لا توجد خدمات في هذه الصفحة.**
   للقوائم الطويلة **الصفحة التالية** و**الصفحة الأولى**.
2. **إضافة:** دوس **إضافة خدمة** ← `/catalog/create`. املأ **الاسم بالإنجليزية** (إلزامي)، **الاسم بالعربية (اختياري)**،
   **السعر (دينار كويتي، ٣ خانات عشرية)**، و**قاعدة العمولة**، و**تُحتسب في المجمّع** (الافتراضي **تُحتسب**) ← احفظ ←
   **تمت إضافة الخدمة:** واسمها.
3. **السعر:** اكتب `7.5` وسيب الحقل، يتظبط لـ `7.500`. المبلغ بيتحفظ بالفلس من غير أي أرقام عشرية تقريبية. سعر صفر
   مسموح. سعر سالب أو بأكتر من 3 خانات ← الشاشة بترفضه قبل ما تبعت حاجة وتعرض **راجع الأسماء والسعر (٣ خانات عشرية) وقيمة قاعدة
   العمولة.** رسالة **السعر لازم يكون مبلغ غير سالب بالدينار الكويتي وبثلاث خانات عشرية بالظبط.** بتيجي من الـ API بس، لو
   الطلب اتبعت له مباشرة.
4. **قاعدة العمولة:** **حسب الخطة** (الخدمة تتبع خطة الموظف)، **بدون عمولة**، **نسبة مئوية** بحقل **النسبة (نقاط أساس،
   0–10000)** (يعني 2500 = 25٪)، أو **مبلغ ثابت (دينار كويتي)**. حقل النسبة بيقبل أرقام صحيحة بس؛ لو كتبت حروف بيفضل
   على آخر قيمة صحيحة. نسبة 0 مختلفة عن **بدون عمولة**. المبلغ الثابت ممكن يكون أكبر من سعر الخدمة. قيمة برّه الحدود ←
   الشاشة بتعرض نفس الرسالة العامة؛ **قاعدة العمولة غير صحيحة…** بتيجي من الـ API بس.
5. **التعديل:** في الجدول دوس **تعديل** على الخدمة ← يظهر **تعديل الخدمة** بالقيم الحالية ← غيّر ← **حفظ التعديلات** ←
   **تم تعديل الخدمة.** الحفظ بيستبدل كل الحقول مرة واحدة. لو حفظت من غير ما تغيّر حاجة، مفيش نسخة جديدة ولا سجل تدقيق.
6. **مديرين في نفس الوقت:** افتح نفس الخدمة في تبويبين، واحفظ من الأول، وبعدين من التاني ← **عدّل مدير آخر هذه الخدمة.
   أعد تحميل أحدث سجل قبل الحفظ.** دوس **إعادة تحميل الخدمة** وكمّل. ما ينفعش الاتنين ينجحوا على نفس النسخة.
7. **التدقيق:** كل إضافة بتتكتب في سجل التدقيق بالقيمة الجديدة بس (من غير قيمة قبل). كل تعديل في السعر أو القاعدة أو
   الاسم أو **تُحتسب في المجمّع** بيتكتب بالقيمة قبل وبعد. الاتنين في نفس المعاملة.
8. **النطاق:** خدمات كل نشاط منفصلة. خدمة نشاط تاني (حتى في نفس الشركة) أو شركة تانية ← **الخدمة غير موجودة في هذا
   النشاط.** زي الخدمة اللي مش موجودة بالظبط. نشاط برّه صلاحياتك ← نفس رفض الصلاحية سواء النشاط موجود أو لا.

**ممنوع يحصل:**
- سعر أو مبلغ ثابت يتحفظ كرقم عشري تقريبي، أو سعر سالب، أو أكتر من 3 خانات.
- نسبة برّه 0–10000، أو قيمة مع **حسب الخطة** أو **بدون عمولة**.
- تعديل يمسح الاسم العربي أو يقلب **تُحتسب في المجمّع** لأن الحقل اتساب.
- حفظين متزامنين ينجحوا على نفس النسخة، أو تعديل من غير سجل تدقيق.
- خدمة نشاط أو شركة تانية تبان أو تتعدل، أو رد يفرّق بين "مش موجودة" و"مش بتاعتك".
- Device يقرأ أو يعدل الخدمات، أو حذف خدمة.

## English

1. Sidebar **Services** → `/catalog`, showing "The business menu: price, commission rule and whether the service counts
   toward tiers." The table shows name, price, rule and an **Edit** button; **Counts toward accumulation** appears only on the add and
   edit forms. With none: "No services on this
   page." Long lists page with **Next page** and **First page**.
2. **Add:** press **Add service** → `/catalog/create`. Fill **English name** (required), **Arabic name (optional)**,
   **Price (KWD, 3 decimals)**, **Commission rule** and **Counts toward accumulation** (default **Counts**) → save →
   "Service created:" with its name.
3. **Price:** type `7.5` and leave the field; it becomes `7.500`. The amount is stored in fils with no floating-point
   rounding. A zero price is allowed. A negative price or more than 3 decimals → the form refuses it before sending and shows "Check the names, the
   price (3 decimals) and the commission rule value." The API's "The price must be a nonnegative KWD amount with exactly
   3 decimals." appears only when the request reaches the API directly.
4. **Commission rule:** **Follow plan** (the employee's plan decides), **No commission**, **Percentage** with
   **Percentage (basis points, 0–10000)** (2500 = 25 %), or **Fixed amount (KWD)**. The percentage field accepts digits
   only; typing letters keeps the last valid value. Percentage 0 is different from **No commission**. A fixed amount may
   exceed the service price. A value out of range → the same generic form message; "The commission rule is not valid…" comes from
   the API only.
5. **Edit:** press **Edit** on a row → **Edit service** opens with the current values → change them → **Save changes**
   → "Service updated." Saving replaces every field at once. Saving with no change creates no new version and no audit
   row.
6. **Two managers at once:** open the same service in two tabs, save in the first, then in the second → "Another manager
   changed this service. Reload the latest record before saving." Press **Reload service** and continue. Both can never
   succeed on the same version.
7. **Audit:** every create is written to the audit log with the new record only (no before value). Every change to
   price, rule, name or **Counts toward accumulation** is written with before and after values. Both in the same
   transaction.
8. **Scope:** each business has its own services. A service of another business (even in the same company) or of
   another company → "The service does not exist in this business.", exactly like a service that does not exist. A
   business outside your permissions → the same permission refusal whether it exists or not.

**Must NOT happen:**
- A price or fixed amount stored as a floating-point value, a negative price, or more than 3 decimals.
- A percentage outside 0–10000, or a value attached to **Follow plan** or **No commission**.
- An edit that wipes the Arabic name or flips **Counts toward accumulation** because a field was left out.
- Two concurrent saves both succeeding on the same version, or an edit with no audit row.
- Another business's or company's service being visible or editable, or a response that tells "does not exist" apart
  from "not yours".
- A Device reading or editing services, or a service being deleted.

## For an agent

- Admin: `http://localhost:3001/catalog` (list, **Edit** per row opens the edit panel), `http://localhost:3001/catalog/create`.
  Price input `#service-price`; rule value `#service-rule-value`. Buttons by exact text.
- API (session cookie + `x-company-id`; feature `catalog`):
  - `GET /v1/businesses/<BUSINESS_ID>/services?limit=20&cursor=<CURSOR>` → `{ items, next_cursor }` (cursor by `id`).
  - `GET /v1/businesses/<BUSINESS_ID>/services/<SERVICE_ID>` → one service or 404 `SERVICE_NOT_FOUND`.
  - `POST /v1/businesses/<BUSINESS_ID>/services` with `{ name_en, name_ar?, price: "7.500", commission_rule, counts_toward_threshold? }`.
  - `PATCH /v1/businesses/<BUSINESS_ID>/services/<SERVICE_ID>` with **all** of `{ expected_revision, name_en, name_ar (string or null), price, commission_rule, counts_toward_threshold }`. Omitting `name_ar` or `counts_toward_threshold` → 400 `VALIDATION_FAILED`; a stale revision → 409 `SERVICE_REVISION_CONFLICT`.
  - `commission_rule`: `{ "kind": "FOLLOW_PLAN" }`, `{ "kind": "ZERO" }`, `{ "kind": "PCT", "value": 2500 }` or `{ "kind": "FIXED", "value": "1.500" }`.
- Assertions: `revision` starts at 1 and increments only on a real change; one `audit_log` row per change with `before`/`after`
  containing `price` and `commission_rule`; a failed audit rolls back the change; another business's id returns the
  same 404 as an unknown id; a Device token is refused; `pospay_app` has no DELETE on `services`.
- Sources: `docs/specs/031-catalog-services/spec.md`, `docs/adr/0035-commission-rule-kinds-owned-per-context.md`,
  `apps/api/src/modules/catalog/**`, `apps/admin/src/catalog/**`, `packages/contracts/src/catalog/service.ts`,
  `packages/i18n/src/{catalog-services,kwd-input}.ts`, migrations `0083`/`0084`.
