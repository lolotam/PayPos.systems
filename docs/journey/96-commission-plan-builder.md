# 96 · The commission plan builder — منشئ خطط العمولة

**Status / الحالة:** shipped in #1104 (PR 1: the plan editor and the shared wire validator, 48-3 PR 1 of 2) and
this PR (PR 2: the screen, the route, the sidebar entry and the version history; 48-3 PR 2 of 2, spec 059 row 48-3).
**Runs on staging** in the admin (`https://app.staging.pospay.systems`) on `/commissions/plans`. The API side (plan
versions and the plans employee list, journey [78](78-commission-plan-versions.md)) has been live since #551/#730.
Still out of scope: per-service overrides ([79](79-commission-service-overrides.md)) and monthly statements.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the admin, or staging.
- Signed in to the admin ([01](01-admin-sign-in-and-totp.md)).
- A business with at least one employee, and an admin role holding `manage:commission-plans:business` (the accountant
  role has it by default without `manage:employees:business` — that is the point of this screen).
- To test the refusal path: a second admin without `manage:commission-plans:business`.

## العربي

1. **اللينك:** افتح لوحة الإدارة ← في القائمة الجانبية بيظهر مدخل «خطط العمولة» بعد ما أول قائمة موظفين تنجح؛
   اللي مالوش صلاحية الخطط ما يشوفش اللينك خالص.
2. **الشاشة:** ادخل على `/commissions/plans` ← عنوان «منشئ خطط العمولة»، وتحته لقطة «الموظفة» منسدلة.
3. **اختار موظفة:** الخيارات شكلها «الاسم — #الرقم الوظيفي» (بالعربي على العربي، وبالإنجليزي على الإنجليزي).
   مفيش خانة كتابة حرة ولا أرقام UUID؛ لو الموظفين أكتر من صفحة فيه زرار «حمّل أكتر» بيلحق بالترتيب.
4. **البلوكات التلاتة:** بعد ما تختار موظفة، النموذج بيطلع بثلاث بلوكات بمفاتيح تشغيل: الأساسي، الشرائح، بيع الباقة.
   مفيش أي معادلة ظاهرة؛ النسبة بنقاط أساس والمبالغ بالدينار بثلاث خانات.
5. **التحقق قبل الحفظ:** شغّل «الشرائح» من غير ما تضيف شريحة ← رسالة «بلوك الشرائح المفعّل لازم فيه شريحة واحدة على
   الأقل» تظهر جوّه بلوك الشرائح نفسه، وزرار الحفظ متعطّل.
6. **الشريحة الصحيحة:** اضغط «إضافة شريحة» واملأ الحد والنسبة ← الرسالة تختفي والحفظ يتفتح.
7. **التاريخ:** تاريخ «تسري من» بيبدأ بيوم النشاط في توقيت النشاط نفسه (مش يوم جهازك).
8. **الحفظ:** احفظ ← النسخة الجديدة تطلع أول سطر في «نسخ الخطة»، والنموذج يتأسّس عليها، وكل بلوك معطّل حافظ
   إعداده بيظهر «معطّل» والإعدادات جنبه.
9. **صفحات التاريخ:** لو التاريخ أطول من صفحة، «حمّل أكتر» بيلحق الصفحات بالترتيب من الأحدث للأقدم.
10. **مدير من غير صلاحية:** سجّل دخول بمدير ماعندوش صلاحية الخطط ← مدخل «خطط العمولة» مختفي من القائمة، وأي زيارة
    مباشرة لـ `/commissions/plans` بتجيب شاشة «مفيش صلاحية لمنشئ الخطط» مع زرار «جرّب تاني» بس، ومن غير أي أسماء.
11. **رفض بعد أول صفحة:** لو الصلاحية اتشالت والشاشة مفتوحة (أول صفحة ناجحة وبعدها رفض 403 في أي قراءة أو حفظ) ←
    الأسماء والأرقام واللينك والنموذج كلهم بيختفوا فورًا، وزرار «جرّب تاني» بيرجّع الشاشة فاضية من غير استعادة
    الاختيار القديم.
12. **جلسة ملغاة:** اخرج من الجلسة (أو اتلغت من تاني) ← مفيش بيانات بتطلع، والشاشة بتفضل فاضية.

**ممنوع يحصل:**
- موظفة تظهر باسمها بالعربي لما اللغة إنجليزي، أو رقم وظيفي ناقص من الخيار.
- حفظ بيتكرر بنسختين بعد ضغطة واحدة على الحفظ (حتى لو الشبكة قطعت والرد ضاع، نفس الجسم بيستعمل نفس المفتاح).
- كود خطأ السيرفر يظهر في بلوك غلط، أو الحفظ يتفتح والخطة مش صالحة.
- أسماء أو أرقام موظفين فضلية تفضل ظاهرة بعد رفض 403، أو حلقة طلبات بعد الرفض.
- بلوك معطّل إعداداته المحفوظة تضيع أو تتقري غلط في التاريخ.
- الموظفة اللي اتشالت تفضل تظهر، أو رسالة «الموظفة غير موجودة» تمسح باقي القائمة.
- مدخل «خطط العمولة» يظهر لحد ما صفحة موظفين ناجحة تتأكد، أو يفضل ظاهر بعد رفض 403.

## English

1. **The link:** open the admin → the sidebar shows the «Commission plans» entry once the first employees page
   succeeds; an admin without the plans permission never sees the link.
2. **The screen:** open `/commissions/plans` → the «Plan builder» title and an «Employee» picker below it.
3. **Pick an employee:** every option reads «name — #employee_number» (Arabic name in Arabic, English name in
   English). No free-text or UUID field; with more employees than one page a «Load more» button appends in order.
4. **The three blocks:** after picking an employee the form shows three switch blocks: Base, Tiers, Package sale. No
   formula anywhere; percentages in basis points and amounts in KWD with three decimals.
5. **Validation before save:** switch Tiers on without a step → «An active tiers block needs at least one step.» shows
   inside the tiers block itself and Save is disabled.
6. **A valid step:** press «Add step» and fill the threshold and percentage → the message clears and Save enables.
7. **The date:** «Effective from» starts on the business's own day in the business time zone (not your device's day).
8. **Save:** save → the new version tops «Plan versions», the form re-bases on it, and every disabled block that kept
   its settings shows them beside «Off».
9. **History pages:** with more versions than one page, «Load more» appends pages newest first.
10. **An admin without the permission:** sign in with an admin that lacks `manage:commission-plans:business` → the
    sidebar entry is hidden and a direct visit to `/commissions/plans` shows «No access to the plan builder» with only
    a «Try again» button and no names at all.
11. **A refusal after the first page:** if the permission is revoked while the screen is open (a first page succeeded,
    then a 403 on any read or save) → names, numbers, link, picker and form all disappear at once; «Try again» brings
    the screen back empty without restoring the old selection.
12. **A revoked session:** sign out (or have the session revoked) → no data renders and the screen stays empty.

**Must NOT happen:**
- An employee shown with her Arabic name in the English locale, or a missing employee number in the option.
- A single save creating two versions (even after a network failure lost the response, the same body reuses the same
  idempotency key).
- A server error code shown in the wrong block, or Save enabled on an invalid plan.
- Employee names or numbers lingering after a 403, or a request loop after the refusal.
- A disabled block's retained settings disappearing or being read as enabled in the history.
- A deleted employee staying selectable, or her «not found» message wiping the rest of the list.
- The «Commission plans» entry appearing before a successful employees page, or surviving a 403.

## For an agent

- **Screens:** the admin at `/commissions/plans` (local `http://localhost:3001`). The route mounts
  `CommissionPlansPage` (`apps/admin/src/commissions/pages/commission-plans-page.tsx`) through
  `apps/admin/app/(dashboard)/_frame/commission-plans-route.tsx`; the sidebar entry is
  `apps/admin/app/(dashboard)/_frame/commission-plans-nav-item.tsx`.
- **Selectors:** sidebar link «خطط العمولة» / «Commission plans» (`commissionPlanBuilder.navTitle`); picker label
  «الموظفة» / «Employee» with the placeholder «اختار موظفة» / «Choose an employee»; the three blocks named
  «الأساسي» / «Base», «الشرائح» / «Tiers», «بيع الباقة» / «Package sale» (group role); Save «احفظ الخطة» / «Save plan»
  (disabled while invalid); history card «نسخ الخطة» / «Plan versions».
- **State:** the screen keys everything by `company:business:user`; a 403 on any employee page, version read or save
  closes the whole scope (denied state with «جرّب تاني» / «Try again»); the save key is remembered per employee until
  a save with that key succeeds.
- **Assertions:** the option text is `name — #employee_number`; the default effective date equals today in the
  business time zone from the list's `time_zone`; the denied state renders no employee names; after a successful save
  the new version is the first history row.
- **Sources:** `docs/specs/059-commissions-statements/48-3-plan.md` (§3.5–§3.6, §4),
  `docs/specs/059-commissions-statements/spec.md` row 48-3, journeys [78](78-commission-plan-versions.md) and
  [79](79-commission-service-overrides.md).
