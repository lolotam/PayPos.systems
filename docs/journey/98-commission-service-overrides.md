# 98 · The special-commission screen — شاشة العمولة الخاصة للخدمات

**Status / الحالة:** shipped in this PR (49-2c: the admin screen for the dated per-employee, per-service overrides;
spec 059 row 49-2). **Staging:** the admin route `/commissions/overrides` becomes available at
`https://app.staging.pospay.systems` after the staging batch that includes this merge. The API side (the override table and the routes) has been live since #762 (49-1) — the rules
themselves are [79](79-commission-service-overrides.md), and the plan versions and the employee list come from
[78](78-commission-plan-versions.md) and the plan builder ([97](97-commission-plan-builder.md)). Like a plan version,
an override changes no payslip until monthly statements are built ([80](80-commission-statements-groundwork.md)).

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the admin, or staging.
- Signed in to the admin ([01](01-admin-sign-in-and-totp.md)).
- A business with at least one employee and at least one service, and an admin role holding
  `manage:commission-plans:business` (the accountant role has it by default without `manage:employees:business` —
  that is the point of this screen).
- To test the refusal path: a second admin without `manage:commission-plans:business`.

## العربي

1. **اللينك:** افتح لوحة الإدارة ← في القائمة الجانبية بيظهر مدخل «عمولة خاصة للخدمات» بعد ما أول قائمة موظفين
   تنجح؛ اللي مالوش صلاحية الخطط ما يشوفش اللينك خالص.
2. **الشاشة:** ادخل على `/commissions/overrides` ← عنوان «عمولة خاصة لكل خدمة»، وتحته لقطة «الموظفة» منسدلة.
3. **اختار موظفة:** الخيارات شكلها «الاسم — #الرقم الوظيفي» (بالعربي على العربي، وبالإنجليزي على الإنجليزي)،
   وبعد الاختيار يطلع جدول خدمات النشاط.
4. **الجدول:** كل سطر فيه الخدمة وسعرها («السعر») وعمولة الخدمة («عمولة الخدمة») والعمولة الخاصة («العمولة
   الخاصة»).
5. **خدمة من غير عمولة خاصة:** العمود «العمولة الخاصة» يقول «مفيش عمولة خاصة» — مش صفر ومش «حسب الخطة».
6. **خدمة مقفولة:** الخدمة المقفولة عليها شارة «مقفولة»، وزرار «تعديل» موجود زي أي خدمة تانية.
7. **الحوار:** اضغط «تعديل» ← حوار «عمولة خاصة للخدمة دي»، وفيه «قاعدة العمولة» بأربع اختيارات بالترتيب: «حسب
   الخطة»، «بدون عمولة»، «نسبة مئوية»، «مبلغ ثابت (دينار كويتي)».
8. **القيمة:** خانة القيمة («النسبة (نقطة أساس)» للنسبة، «المبلغ بالدينار» للمبلغ الثابت) بتظهر مع الاختيار
   ده بس؛ «حسب الخطة» و«بدون عمولة» من غير خانة قيمة.
9. **تاريخ البداية:** «تسري من» بيبدأ بيوم النشاط في توقيت النشاط نفسه (مش يوم جهازك)، والتاريخ لازم يكون النهارده
   أو بعده.
10. **الحفظ:** احفظ ← «العمولة الخاصة اتحفظت.» تظهر، والحوار بيفضل مفتوح، وسطر الخدمة في الجدول بيتحدّث بالقاعدة
    الجديدة، وأول سطر في «تاريخ العمولة الخاصة» هو السطر الجديد وعليه علامة «سارية».
11. **تاريخ مستقبلي:** لو «تسري من» بكرة ← سطر الخدمة في الجدول ما بيتغيرش، وسطر التاريخ ماعندوش «سارية».
12. **تاريخ ماضي أو شهر معتمد:** الرفض بيظهر برسالته («أدخل تاريخ بداية صحيح.» أو رسالة الشهر المعتمد)، والقيم
    اللي كتبتها بتفضل زي ما هي.
13. **مدير من غير صلاحية:** سجّل دخول بمدير ماعندوش صلاحية الخطط ← مدخل «عمولة خاصة للخدمات» مختفي، وأي زيارة
    مباشرة لـ `/commissions/overrides` بتجيب شاشة «مفيش صلاحية لمنشئ الخطط» مع زرار «جرّب تاني» بس، ومن غير أي
    أسماء.
14. **صلاحية اتشالت والشاشة مفتوحة:** أول 403 في أي قراءة أو حفظ بيقفل النطاق كله ← الأسماء والجدول والحوار
    كلهم بيختفوا فورًا، وزرار «جرّب تاني» بيرجّع الشاشة فاضية من غير استعادة الاختيار القديم.

**ممنوع يحصل:**
- عمولة خاصة ناقصة تظهر «صفر» أو «حسب الخطة».
- ضغطة واحدة على الحفظ تعمل قاعدتين.
- علامة «سارية» على سطر بتاريخ مستقبلي، أو على سطر مش هو الأحدث من السيرفر.
- مبلغ بدون تلات خانات عشرية، أو نسبة مكتوبة برمز.
- أسماء أو أرقام موظفين فضلية تفضل ظاهرة بعد رفض 403، أو حلقة طلبات بعد الرفض.
- طلب لقائمة خدمات الكتالوج: الشاشة بتقرأ «خدمات النشاط مع التجاوز الحالي» بس.
- نوع قاعدة تانٍ خامس، ولا زرار حذف ولا زرار رجوع للقاعدة الأصلية.
- تاريخ البداية يبقى في يوم جهازك بدل يوم النشاط.

## English

1. **The link:** open the admin → the sidebar shows the «Special service commissions» entry once the first employees
   page succeeds; an admin without the plans permission never sees the link.
2. **The screen:** open `/commissions/overrides` → the «Special commission for one service» title and an «Employee»
   picker below it.
3. **Pick an employee:** every option reads «name — #employee_number» (Arabic name in Arabic, English name in
   English); the business's services show after the pick.
4. **The table:** every row carries the service, its price («Price»), the service commission («Service commission»)
   and the special commission («Special commission»).
5. **A service with no special commission:** the «Special commission» column reads «No special commission» — never
   zero and never «follow the plan».
6. **A closed service:** the closed service carries a «closed» badge, and its «Edit» button is there like any other.
7. **The dialog:** press «Edit» → the «Special commission for this service» dialog, with «Commission rule» and
   exactly four options in this order: «Follow plan», «No commission», «Percentage», «Fixed amount (KWD)».
8. **The value:** the value field («Percentage (basis points)» for a percentage, «Amount in KWD» for a fixed amount)
   shows only for those two kinds; «Follow plan» and «No commission» carry no value field.
9. **The date:** «Starts on» begins on the business's own day in the business time zone (not your device's day), and
   the date must be today or later.
10. **Save:** save → «Override saved.» shows, the dialog stays open, the service row in the table takes the new
    rule, and the first row of «Override history» is the new one with the «current» mark.
11. **A future date:** with «Starts on» tomorrow → the table row does not change and the history row carries no
    «current» mark.
12. **A past date or an approved month:** the refusal shows its message («Enter a valid start date.» or the
    approved-month message) and the typed values stay.
13. **An admin without the permission:** sign in with an admin that lacks `manage:commission-plans:business` → the
    sidebar entry is hidden and a direct visit to `/commissions/overrides` shows «No access to the plan builder» with
    only a «Try again» button and no names at all.
14. **A permission removed while the screen is open:** the first 403 on any read or save closes the whole scope →
    names, table and dialog all disappear at once; «Try again» brings the screen back empty without restoring the
    old selection.

**Must NOT happen:**
- A missing override shown as zero or as «follow the plan».
- One press saving two overrides.
- A «current» mark on a future-dated row, or on a row that is not the server's newest.
- An amount without three decimals, or a percentage written with a symbol.
- Employee names or numbers lingering after a 403, or a request loop after the refusal.
- A request to the catalog services list: the screen reads the business's services with their current override only.
- A fifth rule kind, a delete control or a reset-to-service control.
- A start date on your device's day instead of the business's day.

## For an agent

- **Screens:** the admin at `/commissions/overrides` (local `http://localhost:3001`). The route mounts
  `CommissionOverridesPage` (`apps/admin/src/commissions/pages/commission-overrides-page.tsx`) through
  `apps/admin/app/(dashboard)/_frame/commission-overrides-route.tsx`; the employee picker is the shared board
  (`apps/admin/src/commissions/ui/commission-plans-board.tsx`); the table is
  `apps/admin/src/commissions/ui/override-services-table.tsx`; the dialog is
  `apps/admin/src/commissions/ui/override-edit-dialog.tsx`; the sidebar entry is
  `apps/admin/app/(dashboard)/_frame/commission-plans-nav-item.tsx` (one shared probe for both entries).
- **Selectors:** sidebar link «عمولة خاصة للخدمات» / «Special service commissions» (`commissionOverrides.navTitle`);
  title «عمولة خاصة لكل خدمة» / «Special commission for one service» (`commissionOverrides.pageTitle`); picker
  label «الموظفة» / «Employee» (`commissionPlanBuilder.pickerLabel`); columns «الخدمة» / «Service»,
  «عمولة الخدمة» / «Service commission», «العمولة الخاصة» / «Special commission»; the row button «تعديل» / «Edit»
  (`commissionOverrides.edit`); the dialog «قاعدة العمولة» / «Commission rule», «النسبة (نقطة أساس)» /
  «Percentage (basis points)», «المبلغ بالدينار» / «Amount in KWD», «تسري من» / «Starts on»; Save «احفظ العمولة
  الخاصة» / «Save override»; the status «العمولة الخاصة اتحفظت.» / «Override saved.»; the history «تاريخ العمولة
  الخاصة» / «Override history» with the «سارية» / «current» badge.
- **State:** the screen keys everything by `company:business:user`; a 403 on any employees page, services read,
  history read or save closes the whole scope (denied state with «جرّب تاني» / «Try again»); the save key is held
  per employee and service until a save with that key succeeds, so it survives closing the dialog and switching
  employee.
- **Assertions:** the only GET paths are the plan employee list, `commission-override-services` and
  `commission-overrides` — never the catalog `/services` list; the «current» mark comes only from `is_current`; a
  missing override reads «No special commission»; the default start date equals today in the business time zone
  from the list's `time_zone`; the saved body is `{ service_id, rule, effective_from }` with the amount as a string.
- **Sources:** `docs/specs/059-commissions-statements/plan-49-2.md`, journeys
  [79](79-commission-service-overrides.md) and [97](97-commission-plan-builder.md).
