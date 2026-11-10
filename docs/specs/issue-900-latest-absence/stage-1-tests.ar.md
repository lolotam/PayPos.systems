# #900 — تسليم اختبارات المرحلة الأولى

> سجل تاريخي لتسليم العامل ثم المرحلة الثانية، وليس حالة القبول الحالية. نتائج المدير وفشل البوابات وتصحيحات العزل موثقة في `verification.ar.md`.

الحالة: اختبارات مكتوبة، لم تُشغّل. لا تعديل إنتاجي، ولا commit أو push.
المدير يراجع المصدر ويشغّل baseline على lane `batch-20261110-900` ثم يستأنف العامل.

## الملفات الجديدة

- `apps/api/src/modules/staff/__tests__/leave-history-latest-absence.fixture.ts`
- `apps/api/src/modules/staff/__tests__/leave-history-latest-absence.spec.ts`
- `apps/api/src/modules/staff/__tests__/leave-history-latest-absence-performance.spec.ts`

لم تتغير مجموعة الأداء القديمة أو fixtures الخاصة بها. جميع الاختبارات الجديدة تستخدم PostgreSQL الحقيقي
والـharness الحالي، بلا mocks داخلية أو migration أو index جديد. Redis وحده boundary mock
داخل fixture المهمة؛ لا ينشأ اتصال Redis حقيقي ولا تتغير البنية المشتركة.

## تغطية النتائج

- تاريخ فارغ، وغياب من 2020 خارج فترة الصفحة، وفلاتر النوع والحالة والفرع والـcursor.
- انقلاب ترتيب `working_date` مقابل `starts_at` بين +14 و-12، مع بداية منتصف الليل في +14
  بالضبط عند الحد UTC، تحت جلسات DB: UTC و-12 و+14.
- انتقالا DST في New York، وردية ليلية ويوم من ورديتين، ومساواة `ends_at = as_of`.
- حدود التعيين والعقد شاملة الطرفين، وتجاهل الأيام خارجها.
- إجازة جزئية APPROVED/PENDING وجلسات OPEN/CLOSED/MISSED_OUT في فرع مخفي، والجلسة الملغاة.
- استمرار `as_of` المحفوظ في cursor بعد تقدم ساعة الطلب.

`staff_schedule_shifts_no_overlap` يمنع تساوي بدايتين لنفس الموظف والشركة:
الفترتان موجبتا المدة، وبالتالي تتداخلان. مراجعة المدير حذفت إعادة اختبار رفض القيد
طبقا لـtest-guard Rule 7؛ الاختبار المتبقي يثبت نتيجة الغياب الصحيحة مع فترتين متلامستين.
لا تعطيل لقيد، ولا ادعاء بوجود fixture متساوية البداية لنفس الموظف في البيانات القانونية.
اختبارات snapshot والـtenant/business القائمة تظل مطلوبة؛ الملفات الجديدة لا تستبدلها.

## قياس مستقل متعدد السنوات

الـfixture الجديد ثابت: موظف واحد، 358 أسبوعا، 2502 وردية يومية من `2020-01-01`
إلى `2026-11-06`، بلا إجازات. له ثلاث حالات مستقلة يعاد إعدادها قبل كل اختبار:

| الحالة | الجلسات في الفرع المخفي | آخر غياب متوقع |
| --- | ---: | --- |
| recent | 0 | 2026-11-06 |
| old | 2501، كل يوم إلا الأول | 2020-01-01 |
| none | 2502، كل الأيام | null |

اختبار EXPLAIN يعزل `historyLastTaken` من تجميع الصفحة، ويشغله على `pospay_app`
داخل `withTenant`. يسجل JSON الفعلي: rows وloops وbuffers ومدة التنفيذ وشروط الـindex.
حساب الشغل يجمع صفوف scan الورديات والصفوف المرفوضة مضروبة في loops.
في recent فقط: حد 64 صفا مفحوصا، استخدام index فعلي، وأقل من 2048 buffer.
هذه ميزانية regression للـfixture الثابت، وليست حد lookback أو ادعاء O(1).
الـbaseline المتوقع بنيويا يفشل حد الشغل لأن MAX الحالي يستهلك التاريخ كله؛
هذا توقع غير مقاس، وليس RED مثبتا أو تجاوزا مثبتا لـ200 ms.
الحالتان old وnone تسجلان الشغل بلا افتراض توقف مبكر؛ كلاهما يحتفظ بحد التنفيذ 200 ms.

كل حالة لها قياس HTTP مستقل: 5 warmups و50 عينة وp95 لا يتجاوز 200 ms، مع تحقق
النتيجة الدقيقة وأيام الصفحة الستة. القياس يشمل Fastify inject والحراس والمعاملة والتسلسل،
ولا يشمل نقل الشبكة أو Redis الحقيقي. HTTP يستخدم ساعة الـharness؛ تاريخ as_of الثابت يخص قراءة SQL المباشرة.

## أوامر للمدير بعد مراجعة المصدر

من جذر worktree وبإعداد lane الخاص به، من غير طباعة أو نسخ credentials:

```text
pnpm --filter @pospay/api exec vitest run src/modules/staff/__tests__/leave-history-latest-absence.spec.ts
pnpm --filter @pospay/api exec vitest run src/modules/staff/__tests__/leave-history-latest-absence-performance.spec.ts --maxWorkers=1
pnpm --filter @pospay/api typecheck
pnpm --filter @pospay/api exec eslint src/modules/staff/__tests__/leave-history-latest-absence*.ts
```

لا قياسات ولا مخرجات تشغيل متاحة من العامل. أي فشل إعداد أو lint أو typecheck يحتاج تصحيحا
قبل تفسير النتائج كفشل منتج. لو كل اختبارات baseline نجحت، تسجل القياسات الحقيقية ولا يُختلق RED.

## متابعة المدير والمرحلة الثانية

المدير أبلغ بنتيجة baseline: 22/25 ناجحة. الفشلان المقصودان: recent يفحص 2502 وردية
مقابل الحد 64، وHTTP p95 = `272.41959999999744 ms` مقابل 200 ms، مع 5 warmups و50 عينة.
احتمال تأثير checks متزامنة على التوقيت لا يحول القياس إلى نجاح ولا يغير الحد.
الفشل الثالث كان خطأ fixture: جلستان OPEN؛ صُححا إلى CLOSED بالـhelper الحالي، ثم أبلغ
المدير بنجاح اختبارات النتائج 19/19 على الإنتاج القديم قبل السماح بالمرحلة الثانية.

تعديل الإنتاج محصور في `leave-history-last.sql.ts` والـhelper الجديد
`leave-history-last-absence.sql.ts`. الصفحة والإجازات والفلاتر والـcursor لا تتغير.

### برهان التكافؤ والتوقف

1. اليوم المؤهل سابقا مجموعة ورديات لها `bool_or(ends_at <= as_of)`. مع ثبات تغطية
   الإجازات والجلسات على employee/date، وجود وردية منتهية مؤهلة مكافئ تماما لهذا الشرط؛
   آخر غياب لا يحتاج JSON أو IDs أو تجميع تفاصيل اليوم. حدود الموظف والعقد والفرع تحفظ كما هي.
2. seed يطلب أول وردية غياب مؤهلة بترتيب `starts_at DESC` بلا أي حد تاريخ أدنى.
   شرط `starts_at < as_of` مستنتج من قيد المدة الموجبة و`ends_at <= as_of`.
   `MATERIALIZED` يمنع إعادة البحث. عدم وجود seed يعيد null وقد يستنفد التاريخ كله.
3. لو seed تاريخه S ولحظته T، فكل مرشح يبدأ بعد T إما غير مؤهل أو كان اختير قبله.
   لا نستنتج من هذا أن S هو أكبر يوم، لأن ترتيب الأيام المحلية مختلف عن ترتيب اللحظات.
4. `materializeSchedule` في `domain/schedules.ts` يشتق `working_date` من يوم بداية الوردية
   ويشتق `starts_at` عبر `scheduleInstant`. هذه علاقة بيانات محفوظة بواسطة مسار الكتابة؛
   ليست CHECK جديدة في DB. كل offset مدعوم أقل من 24 ساعة، بما يشمل القيم التاريخية.
   لذلك أي يوم W>S يبدأ محليا بعد أو عند منتصف ليل S+1، ولحظته UTC لا تسبق
   `((S+1)::timestamp AT TIME ZONE 'UTC') - interval '24 hours'`.
5. refinement يفحص فقط starts_at بين هذا الحد وT، شامل الطرفين، مع W>S، ثم يأخذ MAX
   ويقارنه بـS. شمول T يحفظ ties؛ الصياغة UTC والساعات الثابتة لا تعتمد على DB timezone أو DST.
   24 ساعة غلاف offset محافظ، وليس lookback ولا افتراضا أن الغياب حديث.
6. البحثان يعيدان استخدام `historyCoverage` نفسه: company/business/employee، حالات
   APPROVED/PENDING، وكل جلسة غير voided؛ الفرع المخفي يظل يغطي اليوم ولا يكشف بياناته.
   كل هذا جزء scalar من جملة الصفحة نفسها، بنفس snapshot ونفس as_of المحفوظ.

الخطة المتوقعة، وليست نتيجة تشغيل: backward index scan على
`staff_schedule_shifts_employee_idx(company_id,employee_id,starts_at)` مع LIMIT في seed،
ثم range scan محدد بالحدين في refinement. الحالة recent تلمس عددا صغيرا من الورديات؛
old وnone لا يحملان وعد O(1). نتيجة EXPLAIN والـ200 ms تظل بانتظار مراجعة وتشغيل المدير.
لم يشغّل العامل أي اختبار أو أمر، ولم يغير اختبارات الأداء أو thresholds في المرحلة الثانية.
