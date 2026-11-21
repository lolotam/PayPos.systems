# 100 — مفتاح مرتجع الباقات المستوردة — Imported-package refunds switch

**Status / الحالة:** shipped in this PR (46-2a-S: activating `manage:imported-refunds:business` — catalog,
owner default, seed migration, display name — plus the read/write routes with their audit and the admin
switch; spec 058 row 46-2a). **Staging:** the route `/imported-refunds` becomes available at
`https://app.staging.pospay.systems` after the staging batch that includes this merge, and only after the
migration runs there — which waits for the manager's U gate. The refund use case that reads the switch has
been live since PR #999 (46); before this PR no product surface could turn the switch on, so imported
refunds were impossible.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md) with the admin, or staging.
- Signed in as the company owner ([01](01-admin-sign-in-and-totp.md)) — the switch is the owner's by default
  (PK-Q26), and only the owner grants it onward.
- A customer holding an imported package (open packages imported at go-live), to test the refund effect.
- To test the grantee path: a second admin (for example a branch manager) the owner grants the permission to.
- To test the refusal path: a general manager holding `manage:settings:business` but not this switch.

## العربية

1. **القايمة:** سجّل كمالك → في القايمة الجانبية يظهر «مرتجع الباقات المستوردة» بعد هوية النشاط → افتحه.
2. **الحالة الافتراضية:** المفتاح مقفول وتحت شارة المفتاح جملة: «المفتاح مقفول: مرتجع الباقات المستوردة
   بيرفض. المرتجعات المسجلة قبلها بتفضل مسجلة، ومرتجع الباقات المباعة هنا مش متأثر.»
3. **التشغيل:** اضغط المفتاح → بعد تأكيد الخادم يبقى مفتوحًا وتختفي الجملة.
4. **الأثر:** مرتجع باقة مستوردة يُقبل الآن من حائزي `refund:packages:branch` بنفس قواعد الاسترداد الموجودة.
5. **التدقيق:** كل تغيير فعلي يسجّل مدخل تدقيق واحد بالفاعل والوقت والقيمة قبل وبعد (`settings.imported_refunds_switched`).
6. **التكرار:** إعادة ضبط نفس القيمة الفعلية لا تكتب شيئًا ولا تضيف تدقيقًا — الرد 200 بدون تغيير.
7. **الإيقاف:** أطفئ المفتاح → أول مرتجع مستورد بعده يُرفض برسالة `IMPORTED_REFUND_DISABLED`، والمرتجعات
   المسجلة تفضل، ومرتجع الباقات المباعة هنا مش متأثر.
8. **التفويض:** من شاشة الصلاحيات المالك يمنح الكود «إدارة مرتجع الباقات المستوردة» لأي دور بشري →
   الممنوح يرى القايمة ويقدر يبدّل المفتاح، لكن محاولته منح الكود أو منعه أو سحبه لأي شخص ترجع
   «الصلاحية بتعدلها المالك لوحده» (`PERMISSION_OWNER_ONLY`).
9. **الجهاز ممنوع:** محاولة منح الكود لعضوية جهاز ترجع «لا يمكن منح الصلاحية لدور الأجهزة»
   (`PERMISSION_ROLE_FORBIDDEN`).
10. **السحب:** المالك يسحب المنحة → مفتاح النشاط يفضل على آخر قيمة، والقارئ السابق يفقد القايمة والصفحة
    (403) من أول طلب جديد.
11. **حامل الإعدادات فقط:** مدير عام معه `manage:settings:business` فقط لا يرى عنصر القايمة ولا يفتح
    الصفحة ببيانات — «لا تملك صلاحية إدارة المفتاح ده.»

**ما لا يجب أن يحدث:**
- المفتاح لا يظهر أبدًا لجهاز، ولا لحامل `manage:settings:business` وحده.
- تشغيل المفتاح ما يمنحش `refund:packages:branch` ولا يتجاوز ميزة الـ orders ولا يغير أي قاعدة مرتجع.
- فشل حفظ يرجّع المفتاح لآخر قيمة أكدها الخادم مع رسالة خطأ، من غير ما يبان إنه اتغير.
- تدقيقين في نفس التغيير، أو تدقيق بدون تغيير فعلي، أو قيمة اتغيرت من غير تدقيق.
- رفض قراءة ما يخفيش رسالة «لا تملك صلاحية إدارة المفتاح ده.» — الصفحة لا تعرض مفتاحًا بلا قراءة ناجحة.

## English

1. **Navigation:** sign in as the owner → the sidebar shows «مرتجع الباقات المستوردة» / "Imported-package
   refunds" after Business identity → open it.
2. **Default state:** the switch is off with the off-state note explaining refunds of imported packages are
   refused while off.
3. **Turn on:** press the switch → after the server confirms it stays on and the note disappears.
4. **Effect:** a refund of an imported package is now accepted under every existing refund rule.
5. **Audit:** every effective change writes exactly one audit entry (actor, time, before, after) with the
   action `settings.imported_refunds_switched`.
6. **Repeat:** setting the same effective value again answers 200, stores nothing and audits nothing.
7. **Turn off:** the next imported refund is refused with `IMPORTED_REFUND_DISABLED`; recorded refunds stay
   and refunds of packages sold here are unaffected.
8. **Grant:** on the permissions screen the owner grants «إدارة مرتجع الباقات المستوردة» / "Manage
   imported-package refunds" to any human role → the grantee sees the navigation entry and may switch, but
   any grant/deny/revoke of this code by them is refused with `PERMISSION_OWNER_ONLY`.
9. **Devices:** granting the code to a device membership is refused with `PERMISSION_ROLE_FORBIDDEN`.
10. **Revoke:** after the owner revokes, the business's stored value stays as it is and the former grantee's
    next read or write is 403.
11. **Settings-only holder:** a general manager with `manage:settings:business` alone sees no navigation
    entry and gets «لا تملك صلاحية إدارة المفتاح ده.» / "You are not allowed to manage this switch." with no
    control.

## For an agent / للـ agent

- Address: `https://app.staging.pospay.systems/imported-refunds`.
- Read: `GET /v1/businesses/{businessId}/settings/imported-refunds` →
  `{ "imported_refunds_enabled": boolean }`.
- Write: `PUT` with `{ "imported_refunds_enabled": boolean }` (no Idempotency-Key; a repeated value is a
  no-op).
- Page assertions: `role=switch` named "Refunds of imported packages"; `role=status` carries the off note
  (`importedRefunds.offNote`); `role=alert` carries «لا تملك صلاحية إدارة المفتاح ده.» on a refused read;
  the navigation entry (`link` "Imported-package refunds") renders only after a 200 read.
- Audit assertion (API): `SELECT` on `audit_log WHERE action='settings.imported_refunds_switched'` returns
  exactly one row per effective change, none for a repeat.
