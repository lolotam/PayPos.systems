## الميزة

**شريحة 059 — كشوف العمولات: أدوات تفعيل الاعتماد — إصدار إثبات التغطية وفتح المفتاح (53-2 B1)**

## ملخص بسيط

يستطيع المشغّل تفعيل الاعتماد لشركة واحدة بأمرين موثّقين: مفتاح صريح مع تدقيق هوية المشغّل، وإصدار إثبات جديد من تقرير تغطية كامل. المفتاح وحده لا يفتح الاعتماد، والإثبات السابق لفتح المفتاح لا يبقى حاليًا؛ الترتيب الصحيح: **enable → dry-run → issue → approve**. الإغلاق يرفع جيل التغطية ويقفل المسار فور انتهاء المعاملات التي سبقت قفله.

**فلوس: لا (لا يغيّر مبالغ؛ يفتح مسار الاعتماد) / صلاحيات: نعم / migration: لا**

## الأوامر وحدود الصلاحية

- `pnpm platform:commission-approval --company <uuid> --enable|--disable --reason <reason> --operator-email <email> [--expires <ISO-instant>]`؛ اتصال `MIGRATION_DATABASE_URL` كـ`pospay_owner`، بنفس نمط `platform:grant`. لا اسم حر للمشغّل. `set_by` هو UUID المستخدم المحلول؛ التدقيق `actor = user:<id>` و`details = {company_id, reason, operator_user_id}`، و`target_user_id = NULL`، بلا بريد.
- `pnpm platform:commission-approval --company <uuid> --show`؛ قراءة فقط تعرض المفتاح والإثبات وحدوده وجيله. `SWITCH_ON_NO_CURRENT_PROOF` يوضح أن المفتاح المفتوح لم يكفِ بعد.
- `pnpm platform:commission-coverage --company <uuid> --businesses <uuid>[,<uuid>...] --from YYYY-MM-DD --to YYYY-MM-DD --run-id <label> --release <label> [--dry-run]`؛ يشغّل artifact العامل المبني. القراءات كـ`pospay_app` داخل `withTenant`، والإصدار كـ`pospay_dispatcher` عبر دوال 0250 فقط. لا اتصال Redis.
- النطاق يجب أن يضم كل الأنشطة. التقرير والأمر في نفس العملية. لا إصدار عند فجوة أو قراءة غير موثوقة أو اختلاف قاعدة/نسخة/جيل/حد. فحص بقشيش Orders هو وجود مراجعة بعد حد PostgreSQL، بلا سقف سنة 9999. خطأ انتقال الحد أسبق من رفض وجود البقشيش. التجربة الجافة والرفض يتراجعان حتى عن صف ensure؛ إعادة ناجحة تتحقق مجددًا وتصدر على الجيل التالي.
- لا دور runtime اكتسب منحًا، ولا migration ولا import arrow جديد. ربطا Orders وtenancy عبر ports موثّقان في module-map وADR-0054.

## بنود #1223 المغطّاة هنا

| البند | الدليل |
| --- | --- |
| 4 — أدوات المفتاح | `packages/db/scripts/platform-commission-approval.ts` ومعاملة `platform-commission-approval.ts` واختبار الأوامر |
| 12 — هوية التدقيق | اختبار UUID المحلول و`actor` و`details` وغياب البريد و`target_user_id` الفارغ |
| 13 — أمر الإصدار وقراءة الوجود عبر Orders | `issue-commission-coverage` و`CoverageTipExistenceReader`؛ اختبارات عند U وبعده، فوق 9999، نشاط مجهول ومستأجر آخر؛ اختبار EXPLAIN |

## التحقق

نتائج التشغيل النهائية يملؤها المنفّذ بعد تسليم DB slot؛ لا يُعدّ هذا السطر إثبات نجاح.

**CI-only, not run locally:** `commission-activation-http.spec.ts` يستخدم fixture HTTP الأصلية لإثبات enable ثم إصدار ثم اعتماد حقيقي 200، وبعد disable يرفض شهرًا REVIEWED آخر بـ403. لم يُشغّل محليًا لأن الـharness يتصل بـRedis حقيقي، ومدير المسار منع أي اتصال Redis محلي.

## بوابة staging قبل التفعيل

قياس اعتماد حقيقي واحد على staging بتاريخ كبير مستهلك بالكامل وتسجيل الزمن. **التفعيل لشركة مسموح فقط إذا كان أقل من 200 ms**؛ وإلا يبقى مفتاحها مقفولًا ويُرفع القرار للمالك. لا يدّعي هذا PR تنفيذ القياس أو تفعيل شركة حقيقية.

## المتبقي لـB2

بنود #1223: 3 و6 و9 و10 و14، إجراءات التشغيل الكاملة، إعلانات data-step ومسحها، تراجع العامل، السباقات الخمسة المسماة، وتنبيه الحدث الموقوف. بند 5 مؤجّل. لا يغلق هذا PR issue #1223 بالكامل.
